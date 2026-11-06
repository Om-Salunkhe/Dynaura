// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CleaningEscrowBase} from "./CleaningEscrow.Base.t.sol";
import {CleaningEscrow} from "../src/CleaningEscrow.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @dev Deferred payouts when USDC blocklists the recipient.
contract CleaningEscrowDeferredTest is CleaningEscrowBase {
    function _blockedErr(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(MockUSDC.Blocked.selector, who);
    }

    /// @dev After a deferred terminal payout of FEE to `recipient`: funds stay counted, only the
    ///      recipient can claim, claim fails while blocked, succeeds after unblock, only once.
    function _assertDeferredThenClaim(uint256 id, address recipient, address wrongClaimer) internal {
        assertEq(escrow.pendingPayout(id), FEE);
        assertEq(escrow.totalLocked(), FEE);
        assertEq(usdc.balanceOf(address(escrow)), FEE);
        assertEq(usdc.balanceOf(recipient), recipient == payer ? 1_000_000e6 - FEE : 0);

        // wrong claimers
        vm.prank(wrongClaimer);
        vm.expectRevert(CleaningEscrow.NotRecipient.selector);
        escrow.claimPayout(id);
        vm.prank(stranger);
        vm.expectRevert(CleaningEscrow.NotRecipient.selector);
        escrow.claimPayout(id);
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.NotRecipient.selector);
        escrow.claimPayout(id);

        // still blocked
        vm.prank(recipient);
        vm.expectRevert(_blockedErr(recipient));
        escrow.claimPayout(id);
        assertEq(escrow.pendingPayout(id), FEE);
        assertEq(escrow.totalLocked(), FEE);

        // unblock then claim
        usdc.setBlocked(recipient, false);
        uint256 before = usdc.balanceOf(recipient);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.PayoutClaimed(id, recipient, FEE);
        vm.prank(recipient);
        escrow.claimPayout(id);
        assertEq(usdc.balanceOf(recipient), before + FEE);
        assertEq(escrow.pendingPayout(id), 0);
        assertEq(escrow.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);

        // no double claim
        vm.prank(recipient);
        vm.expectRevert(CleaningEscrow.NothingPending.selector);
        escrow.claimPayout(id);
    }

    function test_Release_BlockedCleaner_Deferred() public {
        uint256 id = _openAccepted();
        usdc.setBlocked(cleaner, true);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.PayoutDeferred(id, cleaner, FEE);
        _release(id, 95);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Paid));
        assertEq(_job(id).outputAfter, 95);
        assertEq(_job(id).proof, PROOF);
        _assertDeferredThenClaim(id, cleaner, payer);
    }

    function test_Refund_BlockedPayer_Deferred() public {
        uint256 id = _open();
        vm.warp(_deadline(id) + 1);
        usdc.setBlocked(payer, true);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.PayoutDeferred(id, payer, FEE);
        vm.prank(stranger);
        escrow.refund(id);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
        _assertDeferredThenClaim(id, payer, cleaner);
    }

    function test_Cancel_BlockedPayer_Deferred() public {
        uint256 id = _open();
        usdc.setBlocked(payer, true);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.PayoutDeferred(id, payer, FEE);
        vm.prank(oracle);
        escrow.cancel(id);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Cancelled));
        _assertDeferredThenClaim(id, payer, cleaner);
    }

    function test_Resolve_RefundBlockedPayer_Deferred() public {
        uint256 id = _openDisputed();
        usdc.setBlocked(payer, true);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.PayoutDeferred(id, payer, FEE);
        vm.prank(owner);
        escrow.resolve(id, false);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
        _assertDeferredThenClaim(id, payer, cleaner);
    }

    function test_Resolve_PayBlockedCleaner_Deferred() public {
        uint256 id = _openDisputed();
        usdc.setBlocked(cleaner, true);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit CleaningEscrow.PayoutDeferred(id, cleaner, FEE);
        vm.prank(owner);
        escrow.resolve(id, true);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Paid));
        _assertDeferredThenClaim(id, cleaner, payer);
    }

    function test_DeferredPayout_StatusStaysTerminal() public {
        uint256 id = _openAccepted();
        usdc.setBlocked(cleaner, true);
        _release(id, 95);
        vm.warp(_deadline(id) + 10 days);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.refund(id);
        vm.prank(oracle);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.release(id, 95, PROOF);
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        escrow.cancel(id);
        assertEq(escrow.totalLocked(), FEE);
    }

    function test_DeferredPayout_MultipleJobsAccounting() public {
        uint256 a = _openAccepted();
        uint256 b = _openAccepted();
        uint256 c = _open();
        usdc.setBlocked(cleaner, true);
        _release(a, 95); // deferred
        usdc.setBlocked(cleaner, false);
        _release(b, 95); // paid out
        // a deferred (FEE) + c open (FEE)
        assertEq(escrow.totalLocked(), 2 * uint256(FEE));
        assertEq(usdc.balanceOf(address(escrow)), 2 * uint256(FEE));
        vm.prank(cleaner);
        escrow.claimPayout(a);
        assertEq(escrow.totalLocked(), FEE);
        assertEq(usdc.balanceOf(cleaner), 2 * uint256(FEE));
        vm.prank(payer);
        escrow.cancel(c);
        assertEq(escrow.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RevertWhen_Claim_NothingPending() public {
        uint256 id = _openAccepted();
        _release(id, 95); // transferred normally
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.NothingPending.selector);
        escrow.claimPayout(id);
    }

    function test_RevertWhen_Claim_NonTerminalOrNoneJob() public {
        uint256 open = _open();
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.NotRecipient.selector);
        escrow.claimPayout(open);
        uint256 accepted = _openAccepted();
        vm.prank(cleaner);
        vm.expectRevert(CleaningEscrow.NotRecipient.selector);
        escrow.claimPayout(accepted);
        vm.prank(payer);
        vm.expectRevert(CleaningEscrow.NotRecipient.selector);
        escrow.claimPayout(9999);
    }
}
