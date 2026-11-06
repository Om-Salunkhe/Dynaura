// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CleaningEscrowBase} from "./CleaningEscrow.Base.t.sol";
import {CleaningEscrow} from "../src/CleaningEscrow.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev dispute, refund, resolve, linkEpisode, admin.
contract CleaningEscrowLifecycleTest is CleaningEscrowBase {
    // --------------------------------------------------------------- dispute
    function test_Dispute_HappyPath() public {
        uint256 id = _openAccepted();
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.JobDisputed(id, cleaner, "panel still dirty");
        vm.prank(cleaner);
        escrow.dispute(id, "panel still dirty");
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Disputed));
        assertEq(escrow.totalLocked(), FEE);
        assertEq(usdc.balanceOf(address(escrow)), FEE);
    }

    function test_Dispute_AtDeadlineOk() public {
        uint256 id = _openAccepted();
        vm.warp(_deadline(id));
        vm.prank(cleaner);
        escrow.dispute(id, "r");
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Disputed));
    }

    function test_RevertWhen_Dispute_NotCleaner() public {
        uint256 id = _openAccepted();
        address[4] memory callers = [payer, stranger, oracle, owner];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(CleaningEscrow.NotCleaner.selector);
            escrow.dispute(id, "r");
        }
        vm.prank(cleaner2);
        vm.expectRevert(CleaningEscrow.NotCleaner.selector);
        escrow.dispute(id, "r");
    }

    function test_RevertWhen_Dispute_AfterDeadline() public {
        uint256 id = _openAccepted();
        vm.warp(_deadline(id) + 1);
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        escrow.dispute(id, "r");
    }

    function test_Dispute_Reason256Ok() public {
        uint256 id = _openAccepted();
        vm.prank(cleaner);
        escrow.dispute(id, _str(256));
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Disputed));
    }

    function test_RevertWhen_Dispute_ReasonTooLong() public {
        uint256 id = _openAccepted();
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.ReasonTooLong.selector);
        escrow.dispute(id, _str(257));
    }

    function test_RevertWhen_Dispute_NotAccepted() public {
        uint256 open = _open();
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.dispute(open, "r");

        uint256 disputed = _openDisputed();
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.dispute(disputed, "again");

        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.dispute(999, "none");
    }

    // ---------------------------------------------------------------- refund
    function test_RevertWhen_Refund_BeforeDeadline_Open() public {
        uint256 id = _open();
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        escrow.refund(id);
        vm.warp(_deadline(id)); // exactly at deadline is still too early
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        escrow.refund(id);
    }

    function test_RevertWhen_Refund_BeforeDeadline_Accepted() public {
        uint256 id = _openAccepted();
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        escrow.refund(id);
        vm.warp(_deadline(id));
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        escrow.refund(id);
    }

    function test_Refund_OpenAfterDeadlineByStranger() public {
        uint256 id = _open();
        uint256 before = usdc.balanceOf(payer);
        vm.warp(_deadline(id) + 1);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.JobRefunded(id, payer, FEE);
        vm.prank(stranger);
        escrow.refund(id);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
        assertEq(usdc.balanceOf(payer), before + FEE);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(escrow.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Refund_AcceptedAfterDeadlineByStranger() public {
        uint256 id = _openAccepted();
        uint256 before = usdc.balanceOf(payer);
        vm.warp(_deadline(id) + 1);
        vm.prank(stranger);
        escrow.refund(id);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
        assertEq(usdc.balanceOf(payer), before + FEE);
        assertEq(usdc.balanceOf(cleaner), 0);
    }

    function test_Refund_DisputedOnlyAfterDisputeWindow() public {
        uint256 id = _openDisputed();
        uint256 dl = _deadline(id);
        vm.warp(dl + 1);
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        escrow.refund(id);
        vm.warp(dl + 3 days);
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        escrow.refund(id);
        vm.warp(dl + 3 days + 1);
        uint256 before = usdc.balanceOf(payer);
        vm.prank(stranger);
        escrow.refund(id);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
        assertEq(usdc.balanceOf(payer), before + FEE);
        assertEq(escrow.totalLocked(), 0);
    }

    function test_RevertWhen_Refund_Twice() public {
        uint256 id = _open();
        vm.warp(_deadline(id) + 1);
        escrow.refund(id);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.refund(id);
    }

    function test_RevertWhen_Refund_AfterPaid() public {
        uint256 id = _openAccepted();
        _release(id, 95);
        vm.warp(_deadline(id) + 10 days);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.refund(id);
        assertEq(usdc.balanceOf(cleaner), FEE);
    }

    function test_RevertWhen_Refund_CancelledOrNone() public {
        uint256 id = _open();
        vm.prank(payer);
        escrow.cancel(id);
        vm.warp(_deadline(id) + 10 days);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.refund(id);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.refund(777);
    }

    // --------------------------------------------------------------- resolve
    function test_Resolve_PayCleaner() public {
        uint256 id = _openDisputed();
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.DisputeResolved(id, true, cleaner, FEE);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.JobPaid(id, cleaner, FEE, 0, bytes32(0));
        vm.prank(owner);
        escrow.resolve(id, true);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Paid));
        assertEq(usdc.balanceOf(cleaner), FEE);
        assertEq(escrow.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Resolve_RefundPayer() public {
        uint256 id = _openDisputed();
        uint256 before = usdc.balanceOf(payer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.DisputeResolved(id, false, payer, FEE);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.JobRefunded(id, payer, FEE);
        vm.prank(owner);
        escrow.resolve(id, false);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
        assertEq(usdc.balanceOf(payer), before + FEE);
        assertEq(usdc.balanceOf(cleaner), 0);
        assertEq(escrow.totalLocked(), 0);
    }

    function test_RevertWhen_Resolve_NonOwner() public {
        uint256 id = _openDisputed();
        address[4] memory callers = [oracle, cleaner, payer, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(_notOwner(callers[i]));
            escrow.resolve(id, true);
        }
    }

    function test_RevertWhen_Resolve_NotDisputed() public {
        uint256 open = _open();
        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.resolve(open, true);

        uint256 accepted = _openAccepted();
        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.resolve(accepted, false);

        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.resolve(12345, false);
    }

    function test_RevertWhen_Resolve_Twice() public {
        uint256 id = _openDisputed();
        vm.prank(owner);
        escrow.resolve(id, true);
        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.resolve(id, false);
        assertEq(usdc.balanceOf(cleaner), FEE);
    }

    function test_Resolve_WorksAfterDisputeWindow() public {
        uint256 id = _openDisputed();
        vm.warp(_deadline(id) + 30 days);
        vm.prank(owner);
        escrow.resolve(id, false);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
    }

    // ----------------------------------------------------------- linkEpisode
    function test_LinkEpisode_OnceByOracle() public {
        uint256 id = _open();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit CleaningEscrow.EpisodeLinked(id, ROOT);
        vm.prank(oracle);
        escrow.linkEpisode(id, ROOT);
        assertEq(_job(id).ogStorageRoot, ROOT);

        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.AlreadyLinked.selector);
        escrow.linkEpisode(id, keccak256("other"));
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.AlreadyLinked.selector);
        escrow.linkEpisode(id, ROOT);
        assertEq(_job(id).ogStorageRoot, ROOT);
    }

    function test_RevertWhen_LinkEpisode_NotOracle() public {
        uint256 id = _open();
        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.NotOracle.selector);
        escrow.linkEpisode(id, ROOT);
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.NotOracle.selector);
        escrow.linkEpisode(id, ROOT);
    }

    function test_RevertWhen_LinkEpisode_ZeroRoot() public {
        uint256 id = _open();
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.BadAmount.selector);
        escrow.linkEpisode(id, bytes32(0));
    }

    function test_RevertWhen_LinkEpisode_NoneJob() public {
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.NoJob.selector);
        escrow.linkEpisode(1, ROOT);
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.NoJob.selector);
        escrow.linkEpisode(0, ROOT);
    }

    function test_LinkEpisode_WorksInEveryNonNoneStatus() public {
        uint256 open = _open();
        uint256 accepted = _openAccepted();
        uint256 disputed = _openDisputed();
        uint256 paid = _openAccepted();
        _release(paid, 95);
        uint256 cancelled = _open();
        vm.prank(payer);
        escrow.cancel(cancelled);
        uint256 refunded = _openDisputed();
        vm.prank(owner);
        escrow.resolve(refunded, false);

        uint256[6] memory ids = [open, accepted, disputed, paid, cancelled, refunded];
        for (uint256 i; i < ids.length; ++i) {
            vm.prank(oracle);
            escrow.linkEpisode(ids[i], ROOT);
            assertEq(_job(ids[i]).ogStorageRoot, ROOT);
        }
    }

    // ------------------------------------------------------------ setOracle
    function test_SetOracle_OwnerOnly() public {
        address newOracle = makeAddr("newOracle");
        vm.expectEmit(false, false, false, true, address(escrow));
        emit CleaningEscrow.OracleChanged(newOracle);
        vm.prank(owner);
        escrow.setOracle(newOracle);
        assertEq(escrow.oracle(), newOracle);

        // old oracle lost power, new oracle has it
        uint256 id = _openAccepted();
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.NotOracle.selector);
        escrow.release(id, 95, PROOF);
        vm.prank(newOracle);
        escrow.release(id, 95, PROOF);
    }

    function test_RevertWhen_SetOracle_NonOwner() public {
        vm.prank(oracle);
        vm.expectRevert(_notOwner(oracle));
        escrow.setOracle(makeAddr("x"));
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        escrow.setOracle(makeAddr("x"));
    }

    function test_RevertWhen_SetOracle_Zero() public {
        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.ZeroAddress.selector);
        escrow.setOracle(address(0));
    }

    // ------------------------------------------------------------ Ownable2Step
    function test_Ownership_TwoStepTransfer() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        escrow.transferOwnership(newOwner);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), newOwner);

        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        escrow.acceptOwnership();

        vm.prank(newOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newOwner);
        assertEq(escrow.pendingOwner(), address(0));

        // new owner can resolve, old cannot
        uint256 id = _openDisputed();
        vm.prank(owner);
        vm.expectRevert(_notOwner(owner));
        escrow.resolve(id, true);
        vm.prank(newOwner);
        escrow.resolve(id, true);
    }

    function test_RevertWhen_TransferOwnership_NonOwnerOrZero() public {
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        escrow.transferOwnership(stranger);
        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.ZeroAddress.selector);
        escrow.transferOwnership(address(0));
    }

    function test_RenounceOwnership_Disabled() public {
        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.ZeroAddress.selector);
        escrow.renounceOwnership();
        assertEq(escrow.owner(), owner);
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        escrow.renounceOwnership();
    }
}
