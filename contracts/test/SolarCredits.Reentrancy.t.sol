// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SolarCredits} from "../src/SolarCredits.sol";

/// @dev Hostile token: on transfer/transferFrom it re-enters the target with a preset payload
///      and records the inner result, then reports a successful transfer.
contract SolarCreditsReentrantToken {
    address public target;
    bytes public payload;
    bool public attacked;
    bool public innerOk;
    bytes public innerRet;

    function arm(address t, bytes calldata p) external {
        target = t;
        payload = p;
        attacked = false;
    }

    function disarm() external {
        target = address(0);
    }

    function _hook() internal {
        if (target != address(0)) {
            attacked = true;
            (innerOk, innerRet) = target.call(payload);
        }
    }

    function transferFrom(address, address, uint256) external returns (bool) {
        _hook();
        return true;
    }

    function transfer(address, uint256) external returns (bool) {
        _hook();
        return true;
    }
}

contract SolarCreditsReentrancyTest is Test {
    SolarCredits internal sc;
    SolarCreditsReentrantToken internal tok;
    address internal owner = makeAddr("owner");
    address internal oracle = makeAddr("oracle");
    bytes32 internal constant P1 = keccak256("p1");

    function setUp() public {
        tok = new SolarCreditsReentrantToken();
        sc = new SolarCredits(address(tok), oracle, owner);
        string[] memory f = new string[](2);
        f[0] = "S";
        f[1] = "B";
        uint256[] memory u = new uint256[](2);
        u[0] = 100;
        uint256[] memory o = new uint256[](2);
        o[1] = 50;
        vm.prank(oracle);
        sc.postPeriod(P1, f, u, o, 2, bytes32(0));
        vm.prank(owner);
        sc.register("S", address(0xBEEF));
    }

    function _assertBlocked() internal view {
        assertTrue(tok.attacked(), "hook did not run");
        assertFalse(tok.innerOk(), "reentrant call succeeded");
        assertEq(bytes4(tok.innerRet()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function test_Fund_BlocksReentryIntoFund() public {
        tok.arm(address(sc), abi.encodeCall(SolarCredits.fund, (P1, 1)));
        sc.fund(P1, 1000);
        _assertBlocked();
        (,,,, uint256 tin,) = sc.periodInfo(P1);
        assertEq(tin, 1000);
    }

    function test_Fund_BlocksReentryIntoClaim() public {
        tok.arm(address(sc), abi.encodeCall(SolarCredits.claim, (P1, "S")));
        sc.fund(P1, 1000);
        _assertBlocked();
    }

    function test_PayIn_BlocksReentryIntoPayInAndFund() public {
        tok.arm(address(sc), abi.encodeCall(SolarCredits.payIn, (P1, "B")));
        sc.payIn(P1, "B");
        _assertBlocked();
        (,,,, uint256 tin,) = sc.periodInfo(P1);
        assertEq(tin, 100); // 50 * 2, counted once

        string[] memory f = new string[](1);
        f[0] = "B2";
        uint256[] memory u = new uint256[](1);
        uint256[] memory o = new uint256[](1);
        u[0] = 1;
        vm.prank(oracle);
        sc.postPeriod(keccak256("p2"), f, u, o, 1, bytes32(0));
        tok.arm(address(sc), abi.encodeCall(SolarCredits.fund, (P1, 5)));
        sc.fund(keccak256("p2"), 10);
        _assertBlocked();
    }

    function test_Claim_BlocksReentryIntoClaimAndFund() public {
        sc.fund(P1, 1000);
        tok.arm(address(sc), abi.encodeCall(SolarCredits.claim, (P1, "S")));
        sc.claim(P1, "S");
        _assertBlocked();
        (,,,,, uint256 tcl) = sc.periodInfo(P1);
        assertEq(tcl, 1000); // paid exactly once

        sc.fund(P1, 1000);
        tok.arm(address(sc), abi.encodeCall(SolarCredits.fund, (P1, 1)));
        sc.claim(P1, "S");
        _assertBlocked();
    }
}
