// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CleaningEscrowBase} from "./CleaningEscrow.Base.t.sol";
import {CleaningEscrowHandler} from "./CleaningEscrow.Handler.sol";
import {CleaningEscrow} from "../src/CleaningEscrow.sol";

contract CleaningEscrowInvariantTest is CleaningEscrowBase {
    CleaningEscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new CleaningEscrowHandler(escrow, usdc, oracle, owner);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](11);
        sels[0] = handler.openJob.selector;
        sels[1] = handler.accept.selector;
        sels[2] = handler.release.selector;
        sels[3] = handler.cancel.selector;
        sels[4] = handler.dispute.selector;
        sels[5] = handler.resolve.selector;
        sels[6] = handler.refund.selector;
        sels[7] = handler.linkEpisode.selector;
        sels[8] = handler.claimPayout.selector;
        sels[9] = handler.setBlocked.selector;
        sels[10] = handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// @dev Expected locked amount from the per-job ledger.
    function _ledger() internal view returns (uint256 sum) {
        uint256 n = escrow.nextJobId();
        for (uint256 id = 1; id < n; ++id) {
            CleaningEscrow.Job memory j = _job(id);
            if (
                j.status == CleaningEscrow.Status.Open || j.status == CleaningEscrow.Status.Accepted
                    || j.status == CleaningEscrow.Status.Disputed
            ) sum += j.fee;
            sum += escrow.pendingPayout(id);
        }
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_BalanceEqualsTotalLockedEqualsLedger() public view {
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalLocked(), "balance != totalLocked");
        assertEq(escrow.totalLocked(), _ledger(), "totalLocked != ledger");
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_NoStateEnteredTwiceAndTerminalNeverLeft() public view {
        assertFalse(handler.violation(), handler.violationReason());
        // directly cross-check terminal statuses recorded by the handler against chain state
        uint256 n = escrow.nextJobId();
        for (uint256 id = 1; id < n; ++id) {
            uint8 last = handler.lastStatus(id);
            if (last == 3 || last == 4 || last == 5) {
                assertEq(uint8(_status(id)), last, "terminal status changed");
            }
        }
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_PendingPayoutOnlyOnTerminalJobs() public view {
        uint256 n = escrow.nextJobId();
        for (uint256 id = 1; id < n; ++id) {
            if (escrow.pendingPayout(id) != 0) {
                CleaningEscrow.Status s = _status(id);
                assertTrue(
                    s == CleaningEscrow.Status.Paid || s == CleaningEscrow.Status.Refunded
                        || s == CleaningEscrow.Status.Cancelled,
                    "pending payout on non-terminal job"
                );
                assertEq(escrow.pendingPayout(id), _job(id).fee, "pending != fee");
            }
        }
    }

    // ------------------------------------------------------------ plain tests
    /// @dev Scripted run through the handler: proves the handler reaches deep states.
    function test_HandlerSmoke_ReachesTerminalStates() public {
        handler.openJob(0, 10e6, 1 days);
        handler.accept(1, 0);
        handler.release(1, 95);
        assertEq(handler.nPaid(), 1);
        handler.openJob(1, 10e6, 1 days);
        handler.cancel(2, true);
        assertEq(handler.nCancelled(), 1);
        handler.openJob(2, 10e6, 1 days);
        handler.accept(3, 1);
        handler.dispute(3);
        handler.resolve(3, false);
        assertEq(handler.nDisputed(), 1);
        assertEq(handler.nResolved(), 1);
        handler.openJob(0, 10e6, 1 days);
        vm.warp(block.timestamp + 2 days);
        handler.refund(4, 0);
        assertEq(handler.nRefunded(), 1);
        assertFalse(handler.violation());
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalLocked(), 0);
    }

    /// @dev An unsolicited donation can only add surplus: balance >= totalLocked, and the escrow
    ///      keeps working with the surplus untouched.
    function test_Donation_KeepsBalanceAtLeastTotalLocked() public {
        uint256 donation = 7e6;
        usdc.mint(stranger, donation);
        vm.prank(stranger);
        usdc.transfer(address(escrow), donation);
        assertEq(escrow.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(escrow)), donation);

        uint256 a = _openAccepted();
        assertEq(escrow.totalLocked(), FEE);
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalLocked());

        _release(a, 95);
        assertEq(escrow.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(escrow)), donation);

        // deferred payout with a donation present
        uint256 b = _openAccepted();
        usdc.setBlocked(cleaner, true);
        _release(b, 95);
        assertEq(escrow.totalLocked(), FEE);
        assertEq(usdc.balanceOf(address(escrow)), uint256(FEE) + donation);
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalLocked());
        usdc.setBlocked(cleaner, false);
        vm.prank(cleaner);
        escrow.claimPayout(b);
        assertEq(escrow.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(escrow)), donation);

        uint256 c = _open();
        vm.prank(payer);
        escrow.cancel(c);
        assertEq(usdc.balanceOf(address(escrow)), donation);
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalLocked());
    }
}
