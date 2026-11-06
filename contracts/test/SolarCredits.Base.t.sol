// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SolarCredits} from "../src/SolarCredits.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @dev Shared fixture + helpers for the SolarCredits suites. Contains no test functions.
abstract contract SolarCreditsTestBase is Test {
    SolarCredits internal sc;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal oracle = makeAddr("oracle");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");
    address internal funder = makeAddr("funder");

    bytes32 internal constant P1 = keccak256("period-1");
    bytes32 internal constant P2 = keccak256("period-2");
    bytes32 internal constant HASH = keccak256("readings");

    function setUp() public virtual {
        usdc = new MockUSDC();
        sc = new SolarCredits(address(usdc), oracle, owner);
    }

    // ---------- array builders ----------
    function _s(string memory a) internal pure returns (string[] memory r) {
        r = new string[](1);
        r[0] = a;
    }

    function _s(string memory a, string memory b) internal pure returns (string[] memory r) {
        r = new string[](2);
        r[0] = a;
        r[1] = b;
    }

    function _s(string memory a, string memory b, string memory c) internal pure returns (string[] memory r) {
        r = new string[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _n(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _n(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    function _n(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _label(uint256 i) internal pure returns (string memory) {
        return string.concat("F", vm.toString(i));
    }

    // ---------- actions ----------
    function _post(bytes32 id, string[] memory f, uint256[] memory u, uint256[] memory o, uint256 rate) internal {
        vm.prank(oracle);
        sc.postPeriod(id, f, u, o, rate, HASH);
    }

    /// @dev Pawan's scenario: A unused 30_000, B unused 10_000, C over 20_000, rate 13.
    function _postABC(bytes32 id) internal {
        _post(id, _s("A", "B", "C"), _n(30_000, 10_000, 0), _n(0, 0, 20_000), 13);
    }

    function _reg(string memory label, address w) internal {
        vm.prank(owner);
        sc.register(label, w);
    }

    function _regABC() internal {
        _reg("A", alice);
        _reg("B", bob);
        _reg("C", carol);
    }

    function _fund(bytes32 id, address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(sc), amt);
        sc.fund(id, amt);
        vm.stopPrank();
    }

    function _payIn(bytes32 id, string memory flat, address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(sc), amt);
        sc.payIn(id, flat);
        vm.stopPrank();
    }

    function _claim(bytes32 id, string memory flat) internal {
        vm.prank(stranger);
        sc.claim(id, flat);
    }

    function _totalIn(bytes32 id) internal view returns (uint256 t) {
        (,,,, t,) = sc.periodInfo(id);
    }

    function _totalClaimed(bytes32 id) internal view returns (uint256 t) {
        (,,,,, t) = sc.periodInfo(id);
    }

    function _flatClaimed(bytes32 id, string memory flat) internal view returns (uint256 c) {
        (,,,, c) = sc.flatInfo(id, flat);
    }
}
