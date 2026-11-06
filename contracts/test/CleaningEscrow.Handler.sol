// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CleaningEscrow} from "../src/CleaningEscrow.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice Bounded action surface for the CleaningEscrow invariant fuzzer.
/// @dev No unsolicited transfers into the escrow: the only USDC that reaches it comes from
///      openJob (transferFrom by a payer). Every action ends with `_sync`, which records status
///      transitions and flags any illegal transition / re-entered state / left terminal state.
contract CleaningEscrowHandler is Test {
    CleaningEscrow public immutable escrow;
    MockUSDC public immutable usdc;
    address public immutable oracle;
    address public immutable owner;

    address[] public payers;
    address[] public cleaners;

    bool public violation;
    string public violationReason;

    mapping(uint256 => uint8) public lastStatus;
    mapping(uint256 => uint256) public visited; // bitmask of statuses ever entered

    // coverage counters
    uint256 public nOpened;
    uint256 public nAccepted;
    uint256 public nPaid;
    uint256 public nCancelled;
    uint256 public nDisputed;
    uint256 public nResolved;
    uint256 public nRefunded;
    uint256 public nLinked;
    uint256 public nClaimed;
    uint256 public nDeferred;

    constructor(CleaningEscrow escrow_, MockUSDC usdc_, address oracle_, address owner_) {
        escrow = escrow_;
        usdc = usdc_;
        oracle = oracle_;
        owner = owner_;
        for (uint256 i; i < 3; ++i) {
            address p = makeAddr(string.concat("hPayer", vm.toString(i)));
            address c = makeAddr(string.concat("hCleaner", vm.toString(i)));
            payers.push(p);
            cleaners.push(c);
            vm.prank(p);
            usdc_.approve(address(escrow_), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- actions
    function openJob(uint256 payerSeed, uint96 fee, uint64 delay) external {
        fee = uint96(bound(fee, 1, 1_000e6));
        delay = uint64(bound(delay, 1, 3 days));
        address p = payers[payerSeed % payers.length];
        usdc.mint(p, fee);
        uint64 dl = uint64(block.timestamp) + delay;
        vm.prank(p);
        try escrow.openJob(fee, dl, uint16(payerSeed % 101), "req") returns (uint256) {
            nOpened++;
        } catch {}
        _sync();
    }

    function accept(uint256 jobSeed, uint256 cleanerSeed) external {
        uint256 id = _pickIn(jobSeed, 1, 1);
        address c = cleaners[cleanerSeed % cleaners.length];
        vm.prank(c);
        try escrow.accept(id) {
            nAccepted++;
        } catch {}
        _sync();
    }

    function release(uint256 jobSeed, uint16 pct) external {
        uint256 id = _pickIn(jobSeed, 2, 6);
        pct = uint16(bound(pct, 85, 100));
        vm.prank(oracle);
        try escrow.release(id, pct, keccak256(abi.encode(id, pct))) {
            nPaid++;
        } catch {}
        _sync();
    }

    function cancel(uint256 jobSeed, bool byOracle) external {
        uint256 id = _pickIn(jobSeed, 1, 1);
        address caller = byOracle ? oracle : _payerOf(id);
        vm.prank(caller);
        try escrow.cancel(id) {
            nCancelled++;
        } catch {}
        _sync();
    }

    function dispute(uint256 jobSeed) external {
        uint256 id = _pickIn(jobSeed, 2, 2);
        address caller = _cleanerOf(id);
        vm.prank(caller);
        try escrow.dispute(id, "dirty") {
            nDisputed++;
        } catch {}
        _sync();
    }

    function resolve(uint256 jobSeed, bool payCleaner) external {
        uint256 id = _pickIn(jobSeed, 6, 6);
        vm.prank(owner);
        try escrow.resolve(id, payCleaner) {
            nResolved++;
        } catch {}
        _sync();
    }

    function refund(uint256 jobSeed, uint256 callerSeed) external {
        uint256 id = _pickIn(jobSeed, 1, 2);
        address caller = callerSeed % 2 == 0 ? payers[callerSeed % payers.length] : cleaners[callerSeed % cleaners.length];
        vm.prank(caller);
        try escrow.refund(id) {
            nRefunded++;
        } catch {}
        _sync();
    }

    function linkEpisode(uint256 jobSeed, bytes32 root) external {
        uint256 id = _pick(jobSeed);
        vm.prank(oracle);
        try escrow.linkEpisode(id, root) {
            nLinked++;
        } catch {}
        _sync();
    }

    function claimPayout(uint256 jobSeed, bool asPayer) external {
        uint256 id = _pickPending(jobSeed);
        address caller = asPayer ? _payerOf(id) : _cleanerOf(id);
        vm.prank(caller);
        try escrow.claimPayout(id) {
            nClaimed++;
        } catch {}
        _sync();
    }

    function setBlocked(uint256 actorSeed, bool isBlocked) external {
        address a = actorSeed % 2 == 0 ? payers[actorSeed % payers.length] : cleaners[actorSeed % cleaners.length];
        usdc.setBlocked(a, isBlocked);
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 0, 12 hours);
        vm.warp(block.timestamp + dt);
    }

    // ---------------------------------------------------------------- helpers
    function _pick(uint256 seed) internal view returns (uint256) {
        uint256 n = escrow.nextJobId() - 1;
        if (n == 0) return 0;
        return bound(seed, 1, n);
    }

    /// @dev Scan from a seeded start for a job whose status is in [lo, hi] (status codes:
    ///      2..6 means Accepted/Disputed for release); falls back to a plain seeded pick so failures are exercised too.
    function _pickIn(uint256 seed, uint8 lo, uint8 hi) internal view returns (uint256) {
        uint256 n = escrow.nextJobId() - 1;
        if (n == 0) return 0;
        uint256 start = bound(seed, 1, n);
        // every 5th seed keeps the unguided pick to exercise revert paths
        if (seed % 5 == 0) return start;
        for (uint256 k; k < n; ++k) {
            uint256 id = ((start - 1 + k) % n) + 1;
            uint8 st = _statusOf(id);
            if (st >= lo && st <= hi && !(lo == 2 && hi == 6 && (st == 3 || st == 4 || st == 5))) return id;
        }
        return start;
    }

    function _pickPending(uint256 seed) internal view returns (uint256) {
        uint256 n = escrow.nextJobId() - 1;
        if (n == 0) return 0;
        uint256 start = bound(seed, 1, n);
        for (uint256 k; k < n; ++k) {
            uint256 id = ((start - 1 + k) % n) + 1;
            if (escrow.pendingPayout(id) != 0) return id;
        }
        return start;
    }

    function _payerOf(uint256 id) internal view returns (address p) {
        (p,,,,,,,,,) = escrow.jobs(id);
        if (p == address(0)) p = payers[0];
    }

    function _cleanerOf(uint256 id) internal view returns (address c) {
        (, c,,,,,,,,) = escrow.jobs(id);
        if (c == address(0)) c = cleaners[0];
    }

    function _statusOf(uint256 id) internal view returns (uint8 s) {
        (,,,,,, CleaningEscrow.Status st,,,) = escrow.jobs(id);
        s = uint8(st);
    }

    function _flag(string memory why) internal {
        violation = true;
        violationReason = why;
    }

    function _legal(uint8 from, uint8 to) internal pure returns (bool) {
        // 0 None, 1 Open, 2 Accepted, 3 Paid, 4 Refunded, 5 Cancelled, 6 Disputed
        if (from == 0) return to == 1;
        if (from == 1) return to == 2 || to == 4 || to == 5;
        if (from == 2) return to == 3 || to == 4 || to == 6;
        if (from == 6) return to == 3 || to == 4;
        return false; // Paid / Refunded / Cancelled are terminal
    }

    function _sync() internal {
        uint256 n = escrow.nextJobId() - 1;
        for (uint256 id = 1; id <= n; ++id) {
            uint8 s = _statusOf(id);
            uint8 prev = lastStatus[id];
            if (s == prev) continue;
            if (!_legal(prev, s)) _flag("illegal transition / terminal status left");
            uint256 bit = uint256(1) << s;
            if (visited[id] & bit != 0) _flag("status entered twice");
            visited[id] |= bit;
            lastStatus[id] = s;
        }
    }

    function jobCount() external view returns (uint256) {
        return escrow.nextJobId() - 1;
    }
}
