// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SolarBilling} from "../../src/SolarBilling.sol";
import {AcceptanceUSDC} from "./AcceptanceUSDC.sol";

contract SolarBillingTest is Test {
    SolarBilling sb;
    AcceptanceUSDC usdc;

    address committee = makeAddr("committee");
    address oracle = makeAddr("oracle");
    address treasury = makeAddr("treasury");
    address grid = makeAddr("grid");
    address resident = makeAddr("resident");
    address stranger = makeAddr("stranger");

    bytes32 constant READINGS = keccak256("signed readings");

    function setUp() public {
        usdc = new AcceptanceUSDC();
        sb = new SolarBilling(address(usdc), oracle, treasury, grid, committee);
        for (uint256 i = 0; i < 2; i++) {
            address who = i == 0 ? resident : stranger;
            usdc.mint(who, 100e6);
            vm.prank(who);
            usdc.approve(address(sb), type(uint256).max);
        }
    }

    function _post(string memory flat, address who) internal returns (uint256 id) {
        vm.prank(oracle);
        id = sb.postBill(flat, "2026-11", who, 3_150_000, 1_050_000, 52_500, 7_000, READINGS);
    }

    function test_constructorChecks() public {
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        new SolarBilling(address(usdc), oracle, treasury, address(0), committee);
    }

    function test_postAndPaySplits() public {
        vm.expectEmit(true, false, false, true);
        emit SolarBilling.BillPosted(1, "A", "2026-11", resident, 4_200_000, 52_500, 7_000, READINGS);
        uint256 id = _post("A", resident);
        assertEq(sb.billOf(sb.key("A", "2026-11")), id);

        vm.expectEmit(true, true, false, true);
        emit SolarBilling.BillPaid(id, resident, 4_200_000, 3_150_000, 1_050_000);
        vm.prank(resident);
        sb.pay(id);

        assertEq(usdc.balanceOf(treasury), 3_150_000); // solar part to the society
        assertEq(usdc.balanceOf(grid), 1_050_000);     // grid part to the electricity board
        assertEq(usdc.balanceOf(resident), 100e6 - 4_200_000);
        (,,, uint96 amount,,,, bool paid, address paidBy, uint96 solar, uint96 gridAmt) = sb.bills(id);
        assertEq(amount, 4_200_000);
        assertTrue(paid);
        assertEq(paidBy, resident);
        assertEq(solar, 3_150_000);
        assertEq(gridAmt, 1_050_000);
    }

    function test_postOnlyOracleOnce() public {
        vm.expectRevert(SolarBilling.NotOracle.selector);
        vm.prank(stranger);
        sb.postBill("A", "2026-11", address(0), 1, 1, 1, 1, READINGS);
        _post("A", resident);
        vm.expectRevert(SolarBilling.AlreadyPosted.selector);
        vm.prank(oracle);
        sb.postBill("A", "2026-11", address(0), 1, 1, 1, 1, READINGS);
        _post("B", address(0)); // another flat, same month is fine
    }

    function test_labels() public {
        vm.startPrank(oracle);
        vm.expectRevert(SolarBilling.BadLabel.selector);
        sb.postBill("", "2026-11", address(0), 1, 1, 1, 1, READINGS);
        vm.expectRevert(SolarBilling.BadLabel.selector);
        sb.postBill("A", "", address(0), 1, 1, 1, 1, READINGS);
        vm.expectRevert(SolarBilling.BadLabel.selector);
        sb.postBill("A", "2026-11-and-more!", address(0), 1, 1, 1, 1, READINGS);
        vm.stopPrank();
    }

    function test_payRules() public {
        vm.expectRevert(SolarBilling.NoBill.selector);
        sb.pay(1);
        uint256 id = _post("A", resident);
        vm.expectRevert(SolarBilling.NotResident.selector);
        vm.prank(stranger);
        sb.pay(id);
        vm.prank(resident);
        sb.pay(id);
        vm.expectRevert(SolarBilling.AlreadyPaid.selector);
        vm.prank(resident);
        sb.pay(id);
    }

    function test_openBillAnyoneMayPay() public {
        uint256 id = _post("C", address(0));
        vm.prank(stranger);
        sb.pay(id);
        (,,,,,,, bool paid, address paidBy,,) = sb.bills(id);
        assertTrue(paid);
        assertEq(paidBy, stranger);
    }

    function test_zeroGridPartSkipsTransfer() public {
        vm.prank(oracle);
        uint256 id = sb.postBill("A", "2026-12", resident, 2_000_000, 0, 1, 0, READINGS);
        vm.prank(resident);
        sb.pay(id);
        assertEq(usdc.balanceOf(treasury), 2_000_000);
        assertEq(usdc.balanceOf(grid), 0);
    }

    function test_amountOverflowReverts() public {
        vm.expectRevert();
        vm.prank(oracle);
        sb.postBill("A", "2026-11", resident, type(uint96).max, 1, 1, 1, READINGS);
    }

    function test_setters() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, oracle));
        vm.prank(oracle);
        sb.setGridPayee(stranger);
        vm.prank(committee);
        sb.setGridPayee(stranger);
        assertEq(sb.gridPayee(), stranger);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        vm.prank(committee);
        sb.setTreasury(address(0));
    }
}
