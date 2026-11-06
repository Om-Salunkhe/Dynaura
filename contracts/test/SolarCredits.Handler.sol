// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SolarCredits} from "../src/SolarCredits.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @dev Stateful-fuzz handler for SolarCredits. Every public function is a bounded action
///      that swallows reverts (try/catch) and keeps ghost accounting only for successful calls.
contract SolarCreditsHandler is Test {
    SolarCredits public immutable sc;
    MockUSDC public immutable usdc;
    address public immutable owner;
    address public currentOracle;

    address[] internal _actors;
    bytes32[] internal _ids;
    string[8] internal _labels = ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"];

    // ghost accounting
    uint256 public ghostIn;
    uint256 public ghostOut;
    mapping(bytes32 => uint256) public ghostPeriodIn;
    mapping(bytes32 => uint256) public ghostPostedUnused;
    mapping(bytes32 => bytes32) public ghostHash;

    // activity counters (non-vacuity)
    uint256 public nPost;
    uint256 public nRegister;
    uint256 public nFund;
    uint256 public nPayIn;
    uint256 public nClaim;
    uint256 public nClaimBlocked;

    constructor(SolarCredits sc_, MockUSDC usdc_, address owner_, address oracle_) {
        sc = sc_;
        usdc = usdc_;
        owner = owner_;
        currentOracle = oracle_;
        for (uint256 i = 0; i < 6; i++) {
            _actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
        for (uint256 i = 0; i < 4; i++) {
            _ids.push(keccak256(abi.encode("period", i)));
        }
        for (uint256 i = 0; i < 8; i++) {
            vm.prank(owner_);
            sc_.register(_labels[i], _actors[i % 6]);
        }
    }

    // ---------- views for the invariant contract ----------
    function idsLength() external view returns (uint256) {
        return _ids.length;
    }

    function idAt(uint256 i) external view returns (bytes32) {
        return _ids[i];
    }

    // Prefer already-posted periods / member flats so actions make progress.
    function _pickId(uint256 seed) internal view returns (bytes32) {
        uint256 start = seed % _ids.length;
        if (seed % 8 == 0) return _ids[start]; // occasionally hit any id (incl. unposted)
        for (uint256 k = 0; k < _ids.length; k++) {
            bytes32 id = _ids[(start + k) % _ids.length];
            (bool posted,,,,,) = sc.periodInfo(id);
            if (posted) return id;
        }
        return _ids[start];
    }

    function _pickFlat(bytes32 id, uint256 seed) internal view returns (string memory) {
        string[] memory fl = sc.flatsOf(id);
        if (fl.length == 0 || seed % 8 == 0) return _labels[seed % 8];
        return fl[seed % fl.length];
    }

    // ---------- actions ----------
    function post(uint256 idSeed, uint256 nSeed, uint256 seed) external {
        bytes32 id = _ids[idSeed % _ids.length];
        (bool posted,,,,,) = sc.periodInfo(id);
        if (posted) return;
        uint256 n = 1 + (nSeed % 8);
        string[] memory f = new string[](n);
        uint256[] memory u = new uint256[](n);
        uint256[] memory o = new uint256[](n);
        uint256 total;
        for (uint256 j = 0; j < n; j++) {
            f[j] = _labels[(seed + j) % 8];
            uint256 r = uint256(keccak256(abi.encode(seed, j)));
            uint256 kind = r % 3;
            uint256 v = 1 + ((r >> 8) % ((r >> 4) % 2 == 0 ? 1000 : 1e12));
            if (kind == 0) {
                u[j] = v;
                total += v;
            } else if (kind == 1) {
                o[j] = v;
            }
        }
        uint256 rr = uint256(keccak256(abi.encode(seed, "rate")));
        uint256 rate = rr % 2 == 0 ? (rr >> 1) % 50 : (rr >> 1) % 1_000_001;
        bytes32 h = keccak256(abi.encode(seed, id));
        vm.prank(currentOracle);
        try sc.postPeriod(id, f, u, o, rate, h) {
            nPost++;
            ghostPostedUnused[id] = total;
            ghostHash[id] = h;
        } catch {}
    }

    function register(uint256 flatSeed, uint256 actorSeed) external {
        vm.prank(owner);
        try sc.register(_labels[flatSeed % 8], _actors[actorSeed % _actors.length]) {
            nRegister++;
        } catch {}
    }

    function fund(uint256 actorSeed, uint256 idSeed, uint256 amount) external {
        address a = _actors[actorSeed % _actors.length];
        bytes32 id = _pickId(idSeed);
        amount = bound(amount, 1, 1e12);
        usdc.mint(a, amount);
        vm.startPrank(a);
        usdc.approve(address(sc), amount);
        try sc.fund(id, amount) {
            nFund++;
            ghostIn += amount;
            ghostPeriodIn[id] += amount;
        } catch {}
        vm.stopPrank();
    }

    function payIn(uint256 actorSeed, uint256 idSeed, uint256 flatSeed) external {
        address a = _actors[actorSeed % _actors.length];
        bytes32 id = _pickId(idSeed);
        string memory flat = _pickFlat(id, flatSeed);
        (, uint256 rate,,,,) = sc.periodInfo(id);
        (,, uint256 over,,) = sc.flatInfo(id, flat);
        uint256 amount = over * rate;
        usdc.mint(a, amount);
        vm.startPrank(a);
        usdc.approve(address(sc), amount);
        try sc.payIn(id, flat) {
            nPayIn++;
            ghostIn += amount;
            ghostPeriodIn[id] += amount;
        } catch {}
        vm.stopPrank();
    }

    function claim(uint256 actorSeed, uint256 idSeed, uint256 flatSeed) external {
        address a = _actors[actorSeed % _actors.length];
        bytes32 id = _pickId(idSeed);
        string memory flat = _pickFlat(id, flatSeed);
        uint256 expected = sc.claimable(id, flat);
        vm.prank(a);
        try sc.claim(id, flat) {
            nClaim++;
            ghostOut += expected;
        } catch {
            if (expected > 0) nClaimBlocked++;
        }
    }

    function setOracle(uint256 actorSeed) external {
        address a = _actors[actorSeed % _actors.length];
        vm.prank(owner);
        sc.setOracle(a);
        currentOracle = a;
    }

    function setBlocked(uint256 actorSeed, bool isBlocked) external {
        usdc.setBlocked(_actors[actorSeed % _actors.length], isBlocked);
    }
}
