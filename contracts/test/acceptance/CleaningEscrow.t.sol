// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CleaningEscrow} from "../../src/CleaningEscrow.sol";
import {AcceptanceUSDC} from "./AcceptanceUSDC.sol";

contract CleaningEscrowTest is Test {
    CleaningEscrow esc;
    AcceptanceUSDC usdc;

    address committee = makeAddr("committee");
    address oracle = makeAddr("oracle");      // the Pi
    address society = makeAddr("society");    // payer
    address cleaner = makeAddr("cleaner");
    address stranger = makeAddr("stranger");

    uint96 constant FEE = 2_000_000; // 2 USDC
    bytes32 constant PROOF = keccak256("signed meter readings");
    bytes32 constant ROOT = keccak256("0g episode");
    string constant REQ = "0g-req-7f3a";

    function setUp() public {
        usdc = new AcceptanceUSDC();
        esc = new CleaningEscrow(address(usdc), oracle, committee);
        usdc.mint(society, 100e6);
        usdc.mint(oracle, 100e6);
        vm.prank(society);
        usdc.approve(address(esc), type(uint256).max);
        vm.prank(oracle);
        usdc.approve(address(esc), type(uint256).max);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(society);
        id = esc.openJob(FEE, uint64(block.timestamp + 1 hours), 52, REQ);
    }

    function _openAccepted() internal returns (uint256 id) {
        id = _open();
        vm.prank(cleaner);
        esc.accept(id);
    }

    function _status(uint256 id) internal view returns (CleaningEscrow.Status s) {
        (,,,,,, s,,,) = esc.jobs(id);
    }

    // ---- constructor / admin -----------------------------------------------------------------

    function test_constructorRejectsZero() public {
        vm.expectRevert(CleaningEscrow.ZeroAddress.selector);
        new CleaningEscrow(address(0), oracle, committee);
        vm.expectRevert(CleaningEscrow.ZeroAddress.selector);
        new CleaningEscrow(address(usdc), address(0), committee);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new CleaningEscrow(address(usdc), oracle, address(0));
    }

    function test_setOracleOnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        esc.setOracle(stranger);
        vm.expectRevert(CleaningEscrow.ZeroAddress.selector);
        vm.prank(committee);
        esc.setOracle(address(0));
        vm.prank(committee);
        esc.setOracle(stranger);
        assertEq(esc.oracle(), stranger);
    }

    // ---- the hero path -------------------------------------------------------------------------

    function test_openAcceptRelease() public {
        vm.expectEmit(true, true, false, true);
        emit CleaningEscrow.JobOpened(1, society, FEE, uint64(block.timestamp + 1 hours), 52, REQ);
        uint256 id = _open();
        assertEq(id, 1);
        assertEq(usdc.balanceOf(address(esc)), FEE);
        assertEq(esc.totalLocked(), FEE);

        vm.prank(cleaner);
        esc.accept(id);

        vm.prank(oracle);
        esc.linkEpisode(id, ROOT);

        vm.expectEmit(true, true, false, true);
        emit CleaningEscrow.JobPaid(id, cleaner, FEE, 96, PROOF);
        vm.prank(oracle);
        esc.release(id, 96, PROOF);

        assertEq(usdc.balanceOf(cleaner), FEE);
        assertEq(usdc.balanceOf(address(esc)), 0);
        assertEq(esc.totalLocked(), 0);
        (address payer, address cl, uint96 fee,, uint16 before, uint16 afterPct, CleaningEscrow.Status s, bytes32 proof, bytes32 root, string memory req) =
            esc.jobs(id);
        assertEq(payer, society);
        assertEq(cl, cleaner);
        assertEq(fee, FEE);
        assertEq(before, 52);
        assertEq(afterPct, 96);
        assertEq(uint8(s), uint8(CleaningEscrow.Status.Paid));
        assertEq(proof, PROOF);
        assertEq(root, ROOT);
        assertEq(req, REQ);
    }

    function test_releaseThreshold() public {
        uint256 id = _openAccepted();
        vm.startPrank(oracle);
        vm.expectRevert(abi.encodeWithSelector(CleaningEscrow.NotClean.selector, uint16(89)));
        esc.release(id, 89, PROOF);
        vm.expectRevert(abi.encodeWithSelector(CleaningEscrow.BadOutput.selector, uint16(101)));
        esc.release(id, 101, PROOF);
        esc.release(id, 90, PROOF);
        vm.stopPrank();
        assertEq(usdc.balanceOf(cleaner), FEE);
    }

    function test_releaseAt100() public {
        uint256 id = _openAccepted();
        vm.prank(oracle);
        esc.release(id, 100, PROOF);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Paid));
    }

    function test_releaseOnlyOracle() public {
        uint256 id = _openAccepted();
        vm.expectRevert(CleaningEscrow.NotOracle.selector);
        vm.prank(stranger);
        esc.release(id, 95, PROOF);
        vm.expectRevert(CleaningEscrow.NotOracle.selector);
        vm.prank(committee);
        esc.release(id, 95, PROOF);
    }

    function test_releaseNeedsAccepted() public {
        uint256 id = _open();
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        vm.prank(oracle);
        esc.release(id, 95, PROOF);
    }

    function test_releaseAfterDeadlineFails() public {
        uint256 id = _openAccepted();
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        vm.prank(oracle);
        esc.release(id, 95, PROOF);
    }

    function test_noDoubleRelease() public {
        uint256 id = _openAccepted();
        vm.startPrank(oracle);
        esc.release(id, 95, PROOF);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        esc.release(id, 95, PROOF);
        vm.stopPrank();
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        esc.refund(id);
    }

    // ---- opening -------------------------------------------------------------------------------

    function test_openValidation() public {
        vm.startPrank(society);
        vm.expectRevert(CleaningEscrow.BadAmount.selector);
        esc.openJob(0, uint64(block.timestamp + 1), 50, "");
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        esc.openJob(FEE, uint64(block.timestamp), 50, "");
        vm.expectRevert(abi.encodeWithSelector(CleaningEscrow.BadOutput.selector, uint16(101)));
        esc.openJob(FEE, uint64(block.timestamp + 1), 101, "");
        vm.expectRevert(CleaningEscrow.RequestIdTooLong.selector);
        esc.openJob(FEE, uint64(block.timestamp + 1), 50, string(new bytes(129)));
        esc.openJob(FEE, uint64(block.timestamp + 1), 50, string(new bytes(128)));
        vm.stopPrank();
    }

    function test_openWithoutAllowanceFails() public {
        vm.expectRevert();
        vm.prank(stranger);
        esc.openJob(FEE, uint64(block.timestamp + 1 hours), 50, "");
    }

    function test_jobIdsIncrease() public {
        assertEq(_open(), 1);
        assertEq(_open(), 2);
        assertEq(esc.nextJobId(), 3);
        assertEq(esc.totalLocked(), 2 * uint256(FEE));
    }

    // ---- accepting -----------------------------------------------------------------------------

    function test_acceptRules() public {
        uint256 id = _open();
        vm.expectRevert(CleaningEscrow.NotAllowed.selector);
        vm.prank(society);
        esc.accept(id);
        vm.expectRevert(CleaningEscrow.NotAllowed.selector);
        vm.prank(oracle);
        esc.accept(id);
        vm.prank(cleaner);
        esc.accept(id);
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        vm.prank(stranger);
        esc.accept(id);
    }

    function test_acceptAfterDeadlineFails() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        vm.prank(cleaner);
        esc.accept(id);
    }

    function test_acceptMissingJobFails() public {
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        vm.prank(cleaner);
        esc.accept(42);
    }

    // ---- cancel / refund ------------------------------------------------------------------------

    function test_cancelByPayerOrOracle() public {
        uint256 a = _open();
        uint256 b = _open();
        uint256 before = usdc.balanceOf(society);
        vm.expectRevert(CleaningEscrow.NotAllowed.selector);
        vm.prank(stranger);
        esc.cancel(a);
        vm.prank(society);
        esc.cancel(a);
        vm.prank(oracle);
        esc.cancel(b);
        assertEq(usdc.balanceOf(society), before + 2 * uint256(FEE));
        assertEq(uint8(_status(a)), uint8(CleaningEscrow.Status.Cancelled));
        assertEq(esc.totalLocked(), 0);
    }

    function test_cancelAfterAcceptFails() public {
        uint256 id = _openAccepted();
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        vm.prank(society);
        esc.cancel(id);
    }

    function test_refundAfterDeadline() public {
        uint256 id = _openAccepted();
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        esc.refund(id);
        vm.warp(block.timestamp + 1 hours); // exactly at the deadline: still too early
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        esc.refund(id);
        vm.warp(block.timestamp + 1);
        uint256 before = usdc.balanceOf(society);
        vm.prank(stranger); // anyone may trigger it; the money goes to the payer
        esc.refund(id);
        assertEq(usdc.balanceOf(society), before + FEE);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        esc.refund(id);
    }

    function test_refundOpenJobAfterDeadline() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 hours + 1);
        esc.refund(id);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
    }

    function test_refundMissingJobFails() public {
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        esc.refund(7);
    }

    // ---- disputes -----------------------------------------------------------------------------

    function test_disputeRules() public {
        uint256 id = _open();
        vm.expectRevert(CleaningEscrow.BadStatus.selector); // not accepted yet
        vm.prank(cleaner);
        esc.dispute(id, "cloudy");
        vm.prank(cleaner);
        esc.accept(id);
        vm.expectRevert(CleaningEscrow.NotCleaner.selector);
        vm.prank(stranger);
        esc.dispute(id, "cloudy");
        vm.expectEmit(true, true, false, true);
        emit CleaningEscrow.JobDisputed(id, cleaner, "cloudy");
        vm.prank(cleaner);
        esc.dispute(id, "cloudy");
        vm.expectRevert(CleaningEscrow.BadStatus.selector); // only once
        vm.prank(cleaner);
        esc.dispute(id, "again");
    }

    function test_disputeAfterDeadlineFails() public {
        uint256 id = _openAccepted();
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(CleaningEscrow.TooLate.selector);
        vm.prank(cleaner);
        esc.dispute(id, "late");
    }

    function test_disputedJobBlocksRefundUntilWindow() public {
        uint256 id = _openAccepted();
        (,,, uint64 deadline,,,,,,) = esc.jobs(id);
        vm.prank(cleaner);
        esc.dispute(id, "cloudy");
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(CleaningEscrow.TooEarly.selector);
        esc.refund(id);
        vm.warp(uint256(deadline) + 3 days);
        vm.expectRevert(CleaningEscrow.TooEarly.selector); // exactly deadline + window
        esc.refund(id);
        vm.warp(uint256(deadline) + 3 days + 1);
        esc.refund(id);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
    }

    function test_meterCanStillReleaseDisputedJob() public {
        uint256 id = _openAccepted();
        vm.prank(cleaner);
        esc.dispute(id, "cloudy");
        vm.prank(oracle);
        esc.release(id, 93, PROOF);
        assertEq(usdc.balanceOf(cleaner), FEE);
    }

    function test_resolvePaysCleaner() public {
        uint256 id = _openAccepted();
        vm.prank(cleaner);
        esc.dispute(id, "cloudy");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, oracle));
        vm.prank(oracle);
        esc.resolve(id, true);
        vm.expectEmit(true, true, false, true);
        emit CleaningEscrow.DisputeResolved(id, true, cleaner, FEE);
        vm.prank(committee);
        esc.resolve(id, true);
        assertEq(usdc.balanceOf(cleaner), FEE);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Paid));
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        vm.prank(committee);
        esc.resolve(id, false);
    }

    function test_resolveRefundsPayer() public {
        uint256 id = _openAccepted();
        vm.prank(cleaner);
        esc.dispute(id, "cloudy");
        uint256 before = usdc.balanceOf(society);
        vm.prank(committee);
        esc.resolve(id, false);
        assertEq(usdc.balanceOf(society), before + FEE);
        assertEq(uint8(_status(id)), uint8(CleaningEscrow.Status.Refunded));
    }

    function test_resolveNeedsDispute() public {
        uint256 id = _openAccepted();
        vm.expectRevert(CleaningEscrow.BadStatus.selector);
        vm.prank(committee);
        esc.resolve(id, true);
    }

    // ---- 0G episode link ------------------------------------------------------------------------

    function test_linkEpisodeOnceByOracle() public {
        uint256 id = _open();
        vm.expectRevert(CleaningEscrow.NotOracle.selector);
        vm.prank(stranger);
        esc.linkEpisode(id, ROOT);
        vm.expectRevert(CleaningEscrow.NoJob.selector);
        vm.prank(oracle);
        esc.linkEpisode(99, ROOT);
        vm.expectRevert(CleaningEscrow.BadAmount.selector);
        vm.prank(oracle);
        esc.linkEpisode(id, bytes32(0));
        vm.expectEmit(true, false, false, true);
        emit CleaningEscrow.EpisodeLinked(id, ROOT);
        vm.prank(oracle);
        esc.linkEpisode(id, ROOT);
        vm.expectRevert(CleaningEscrow.AlreadyLinked.selector);
        vm.prank(oracle);
        esc.linkEpisode(id, keccak256("other"));
    }

    // ---- the Pi is payer and oracle at once (the automatic flow) --------------------------------

    function test_piOpensAndReleases() public {
        vm.prank(oracle);
        uint256 id = esc.openJob(FEE, uint64(block.timestamp + 1 hours), 48, REQ);
        vm.prank(cleaner);
        esc.accept(id);
        vm.prank(oracle);
        esc.release(id, 94, PROOF);
        assertEq(usdc.balanceOf(cleaner), FEE);
    }

    // ---- fuzz: the escrow always holds exactly the unfinished fees -------------------------------

    function testFuzz_balanceMatchesLocked(uint8[12] calldata actions, uint96[12] calldata fees) public {
        uint256 opened;
        for (uint256 i = 0; i < actions.length; i++) {
            uint256 op = actions[i] % 6;
            uint256 id = opened == 0 ? 0 : (uint256(fees[i]) % opened) + 1;
            if (op == 0 || opened == 0) {
                uint96 fee = uint96(bound(fees[i], 1, 5e6));
                vm.prank(society);
                esc.openJob(fee, uint64(block.timestamp + 1 hours), 50, "");
                opened++;
            } else if (op == 1) {
                vm.prank(cleaner);
                try esc.accept(id) {} catch {}
            } else if (op == 2) {
                vm.prank(oracle);
                try esc.release(id, 95, PROOF) {} catch {}
            } else if (op == 3) {
                vm.prank(society);
                try esc.cancel(id) {} catch {}
            } else if (op == 4) {
                vm.prank(cleaner);
                try esc.dispute(id, "x") {} catch {}
            } else {
                vm.warp(block.timestamp + 20 minutes);
                try esc.refund(id) {} catch {}
            }
            assertEq(usdc.balanceOf(address(esc)), esc.totalLocked());
        }
        assertEq(usdc.balanceOf(society) + usdc.balanceOf(cleaner) + usdc.balanceOf(address(esc)), 100e6);
    }
}
