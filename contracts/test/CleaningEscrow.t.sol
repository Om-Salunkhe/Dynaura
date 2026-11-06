// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CleaningEscrowBase} from "./CleaningEscrow.Base.t.sol";
import {CleaningEscrow} from "../src/CleaningEscrow.sol";

/// @dev Deployment, openJob, accept, release, cancel.
contract CleaningEscrowTest is CleaningEscrowBase {
    // ---------------------------------------------------------------- deploy
    function test_Constructor_SetsState() public {
        vm.expectEmit(false, false, false, true);
        emit CleaningEscrow.OracleChanged(oracle);
        CleaningEscrow e = new CleaningEscrow(address(usdc), oracle, owner);
        assertEq(address(e.usdc()), address(usdc));
        assertEq(e.oracle(), oracle);
        assertEq(e.owner(), owner);
        assertEq(e.nextJobId(), 1);
        assertEq(e.totalLocked(), 0);
        assertEq(e.RELEASE_PCT(), 90);
        assertEq(e.DISPUTE_WINDOW(), 3 days);
    }

    function test_RevertWhen_Constructor_ZeroUsdc() public {
        vm.expectRevert(CleaningEscrow.ZeroAddress.selector);
        new CleaningEscrow(address(0), oracle, owner);
    }

    function test_RevertWhen_Constructor_ZeroOracle() public {
        vm.expectRevert(CleaningEscrow.ZeroAddress.selector);
        new CleaningEscrow(address(usdc), address(0), owner);
    }

    function test_RevertWhen_Constructor_ZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new CleaningEscrow(address(usdc), oracle, address(0));
    }

    // --------------------------------------------------------------- openJob
    function test_OpenJob_HappyPath() public {
        uint64 dl = uint64(block.timestamp + DURATION);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.JobOpened(1, payer, FEE, dl, 40, "req-1");
        vm.prank(payer);
        uint256 id = escrow.openJob(FEE, dl, 40, "req-1");

        assertEq(id, 1);
        assertEq(escrow.nextJobId(), 2);
        CleaningEscrow.Job memory j = _job(1);
        assertEq(j.payer, payer);
        assertEq(j.cleaner, address(0));
        assertEq(j.fee, FEE);
        assertEq(j.deadline, dl);
        assertEq(j.outputBefore, 40);
        assertEq(j.outputAfter, 0);
        assertEq(uint8(j.status), uint8(CleaningEscrow.Status.Open));
        assertEq(j.proof, bytes32(0));
        assertEq(j.ogStorageRoot, bytes32(0));
        assertEq(j.ogRequestId, "req-1");
        assertEq(usdc.balanceOf(address(escrow)), FEE);
        assertEq(usdc.balanceOf(payer), 1_000_000e6 - FEE);
        assertEq(escrow.totalLocked(), FEE);
    }

    function test_OpenJob_IdsIncrement() public {
        assertEq(_open(), 1);
        assertEq(_open(), 2);
        assertEq(_open(), 3);
        assertEq(escrow.totalLocked(), 3 * uint256(FEE));
    }

    function test_OpenJob_OutputBefore100AndEmptyRequestIdOk() public {
        vm.prank(payer);
        uint256 id = escrow.openJob(1, uint64(block.timestamp + 1), 100, "");
        assertEq(_job(id).outputBefore, 100);
        assertEq(_job(id).ogRequestId, "");
    }

    function test_OpenJob_RequestId128BytesOk() public {
        string memory s = _str(128);
        vm.prank(payer);
        uint256 id = escrow.openJob(FEE, uint64(block.timestamp + 1), 0, s);
        assertEq(_job(id).ogRequestId, s);
    }

    function test_RevertWhen_OpenJob_RequestId129Bytes() public {
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.RequestIdTooLong.selector);
        escrow.openJob(FEE, uint64(block.timestamp + 1), 0, _str(129));
    }

    function test_RevertWhen_OpenJob_ZeroFee() public {
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.BadAmount.selector);
        escrow.openJob(0, uint64(block.timestamp + 1), 0, "x");
    }

    function test_RevertWhen_OpenJob_DeadlineIsNow() public {
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        escrow.openJob(FEE, uint64(block.timestamp), 0, "x");
    }

    function test_RevertWhen_OpenJob_DeadlinePast() public {
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        escrow.openJob(FEE, uint64(block.timestamp - 1), 0, "x");
    }

    function test_RevertWhen_OpenJob_OutputBefore101() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(CleaningEscrow.BadOutput.selector, uint16(101)));
        escrow.openJob(FEE, uint64(block.timestamp + 1), 101, "x");
    }

    function test_RevertWhen_OpenJob_NoAllowance() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.openJob(FEE, uint64(block.timestamp + 1), 0, "x");
        assertEq(escrow.nextJobId(), 1);
        assertEq(escrow.totalLocked(), 0);
    }

    function test_RevertWhen_OpenJob_PayerBlocked() public {
        usdc.setBlocked(payer, true);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("Blocked(address)")), payer));
        escrow.openJob(FEE, uint64(block.timestamp + 1), 0, "x");
    }

    // ---------------------------------------------------------------- accept
    function test_Accept_HappyPath() public {
        uint256 id = _open();
        vm.expectEmit(true, true, false, false, address(escrow));
        emit CleaningEscrow.JobAccepted(id, cleaner);
        vm.prank(cleaner);
        escrow.accept(id);
        CleaningEscrow.Job memory j = _job(id);
        assertEq(j.cleaner, cleaner);
        assertEq(uint8(j.status), uint8(CleaningEscrow.Status.Accepted));
        assertEq(escrow.totalLocked(), FEE);
    }

    function test_Accept_AtDeadlineOk() public {
        uint256 id = _open();
        vm.warp(_deadline(id));
        vm.prank(cleaner);
        escrow.accept(id);
        assertEq(_job(id).cleaner, cleaner);
    }

    function test_RevertWhen_Accept_PayerAcceptsOwnJob() public {
        uint256 id = _open();
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.NotAllowed.selector);
        escrow.accept(id);
    }

    function test_RevertWhen_Accept_OracleOrOwner() public {
        uint256 id = _open();
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.NotAllowed.selector);
        escrow.accept(id);
        vm.prank(owner);
        vm.expectRevert(CleaningEscrow.NotAllowed.selector);
        escrow.accept(id);
    }

    function test_RevertWhen_Accept_SecondAccepter() public {
        uint256 id = _openAccepted();
        vm.prank(cleaner2);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.accept(id);
        assertEq(_job(id).cleaner, cleaner);
    }

    function test_RevertWhen_Accept_AfterDeadline() public {
        uint256 id = _open();
        vm.warp(_deadline(id) + 1);
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        escrow.accept(id);
    }

    function test_RevertWhen_Accept_NonOpen() public {
        uint256 id = _open();
        vm.prank(payer);
        escrow.cancel(id);
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.accept(id);
    }

    function test_RevertWhen_Accept_NoneJob() public {
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.accept(1);
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.accept(0);
    }

    // --------------------------------------------------------------- release
    function test_Release_HappyPath() public {
        uint256 id = _openAccepted();
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.JobPaid(id, cleaner, FEE, 95, PROOF);
        vm.prank(oracle);
        escrow.release(id, 95, PROOF);

        CleaningEscrow.Job memory j = _job(id);
        assertEq(uint8(j.status), uint8(CleaningEscrow.Status.Paid));
        assertEq(j.outputAfter, 95);
        assertEq(j.proof, PROOF);
        assertEq(usdc.balanceOf(cleaner), FEE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalLocked(), 0);
        assertEq(escrow.pendingPayout(id), 0);
    }

    function test_RevertWhen_Release_Output89() public {
        uint256 id = _openAccepted();
        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(CleaningEscrow.NotClean.selector, uint16(89)));
        escrow.release(id, 89, PROOF);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Accepted));
    }

    function test_Release_Output90Pays() public {
        uint256 id = _openAccepted();
        _release(id, 90);
        assertEq(usdc.balanceOf(cleaner), FEE);
        assertEq(_job(id).outputAfter, 90);
    }

    function test_Release_Output100Pays() public {
        uint256 id = _openAccepted();
        _release(id, 100);
        assertEq(usdc.balanceOf(cleaner), FEE);
        assertEq(_job(id).outputAfter, 100);
    }

    function test_RevertWhen_Release_Output101() public {
        uint256 id = _openAccepted();
        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(CleaningEscrow.BadOutput.selector, uint16(101)));
        escrow.release(id, 101, PROOF);
    }

    function testFuzz_Release_PaysIffOutputIn90To100(uint16 pct) public {
        uint256 id = _openAccepted();
        vm.prank(oracle);
        if (pct < 90 || pct > 100) {
            vm.expectRevert(abi.encodeWithSelector(pct > 100 ? CleaningEscrow.BadOutput.selector : CleaningEscrow.NotClean.selector, pct));
            escrow.release(id, pct, PROOF);
            assertEq(usdc.balanceOf(cleaner), 0);
        } else {
            escrow.release(id, pct, PROOF);
            assertEq(usdc.balanceOf(cleaner), FEE);
        }
    }

    function test_RevertWhen_Release_NotOracle() public {
        uint256 id = _openAccepted();
        address[4] memory callers = [owner, cleaner, payer, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(CleaningEscrow.NotOracle.selector);
            escrow.release(id, 95, PROOF);
        }
    }

    function test_RevertWhen_Release_AfterDeadline() public {
        uint256 id = _openAccepted();
        vm.warp(_deadline(id) + 1);
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        escrow.release(id, 95, PROOF);
    }

    function test_Release_AtDeadlineOk() public {
        uint256 id = _openAccepted();
        vm.warp(_deadline(id));
        _release(id, 95);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Paid));
    }

    function test_RevertWhen_Release_StatusOpen() public {
        uint256 id = _open();
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.release(id, 95, PROOF);
    }

    function test_RevertWhen_Release_NoneJob() public {
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.release(7, 95, PROOF);
    }

    function test_RevertWhen_Release_Twice() public {
        uint256 id = _openAccepted();
        _release(id, 95);
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.release(id, 95, PROOF);
        assertEq(usdc.balanceOf(cleaner), FEE);
    }

    function test_Release_FromDisputedWorks() public {
        uint256 id = _openDisputed();
        _release(id, 92);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Paid));
        assertEq(usdc.balanceOf(cleaner), FEE);
        assertEq(escrow.totalLocked(), 0);
    }

    // ---------------------------------------------------------------- cancel
    function test_Cancel_ByPayer() public {
        uint256 id = _open();
        uint256 before = usdc.balanceOf(payer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.JobCancelled(id, payer, FEE);
        vm.prank(payer);
        escrow.cancel(id);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Cancelled));
        assertEq(usdc.balanceOf(payer), before + FEE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalLocked(), 0);
    }

    function test_Cancel_ByOracleRefundsPayer() public {
        uint256 id = _open();
        uint256 before = usdc.balanceOf(payer);
        vm.prank(oracle);
        escrow.cancel(id);
        assertEq(usdc.balanceOf(payer), before + FEE);
        assertEq(usdc.balanceOf(oracle), 0);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Cancelled));
    }

    function test_RevertWhen_Cancel_Stranger() public {
        uint256 id = _open();
        address[3] memory callers = [stranger, owner, cleaner];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(CleaningEscrow.NotAllowed.selector);
            escrow.cancel(id);
        }
    }

    function test_RevertWhen_Cancel_AcceptedJob() public {
        uint256 id = _openAccepted();
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.cancel(id);
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.cancel(id);
    }

    function test_RevertWhen_Cancel_Twice() public {
        uint256 id = _open();
        vm.prank(payer);
        escrow.cancel(id);
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.cancel(id);
    }

    function test_RevertWhen_Cancel_NoneJob() public {
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.cancel(42);
    }
}
