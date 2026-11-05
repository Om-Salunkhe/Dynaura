// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ShopTrade} from "../src/ShopTrade.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract ShopTradeTest is Test {
    ShopTrade st;
    MockUSDC usdc;

    address committee = makeAddr("committee");
    address oracle = makeAddr("oracle");
    address treasury = makeAddr("treasury");
    address shop = makeAddr("shop");
    address stranger = makeAddr("stranger");

    uint64 constant PRICE = 80_000; // 0.08 USDC per kWh

    function setUp() public {
        usdc = new MockUSDC();
        st = new ShopTrade(address(usdc), oracle, treasury, PRICE, committee);
        usdc.mint(shop, 100e6);
        vm.prank(shop);
        usdc.approve(address(st), type(uint256).max);
    }

    function _place(uint32 wh) internal returns (uint256 id) {
        vm.prank(shop);
        id = st.placeOrder("2026-11-07", wh, uint64(block.timestamp + 6 hours));
    }

    function _status(uint256 id) internal view returns (ShopTrade.Status s) {
        (,,,,,, s,) = st.orders(id);
    }

    function test_constructorChecks() public {
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        new ShopTrade(address(usdc), oracle, address(0), PRICE, committee);
        vm.expectRevert(ShopTrade.BadPrice.selector);
        new ShopTrade(address(usdc), oracle, treasury, 0, committee);
        vm.expectRevert(ShopTrade.BadPrice.selector);
        new ShopTrade(address(usdc), oracle, treasury, 10_000_001, committee);
    }

    function test_costRoundsUp() public view {
        assertEq(st.costOf(1000), 80_000); // 1 kWh = 0.08 USDC
        assertEq(st.costOf(1), 80);
        assertEq(st.costOf(500), 40_000);
    }

    function test_placeSettlePartial() public {
        uint256 id = _place(500); // deposit 0.04 USDC
        assertEq(usdc.balanceOf(address(st)), 40_000);
        vm.expectRevert(ShopTrade.NotOracle.selector);
        vm.prank(stranger);
        st.settle(id, 300);
        uint256 shopBefore = usdc.balanceOf(shop);
        vm.expectEmit(true, true, false, true);
        emit ShopTrade.OrderSettled(id, shop, 300, 24_000, 16_000);
        vm.prank(oracle);
        st.settle(id, 300);
        assertEq(usdc.balanceOf(treasury), 24_000);
        assertEq(usdc.balanceOf(shop), shopBefore + 16_000);
        assertEq(usdc.balanceOf(address(st)), 0);
        assertEq(uint8(_status(id)), uint8(ShopTrade.Status.Settled));
        vm.expectRevert(ShopTrade.BadStatus.selector);
        vm.prank(oracle);
        st.settle(id, 300);
    }

    function test_overDeliveryIsCapped() public {
        uint256 id = _place(500);
        vm.prank(oracle);
        st.settle(id, 9_999);
        assertEq(usdc.balanceOf(treasury), 40_000);
        (,,, uint32 delivered,,,,) = st.orders(id);
        assertEq(delivered, 500);
    }

    function test_priceIsFixedPerOrder() public {
        uint256 id = _place(1000);
        vm.prank(oracle);
        st.setPrice(160_000);
        vm.prank(oracle);
        st.settle(id, 1000);
        assertEq(usdc.balanceOf(treasury), 80_000);
    }

    function test_setPriceRules() public {
        vm.expectRevert(ShopTrade.NotAllowed.selector);
        vm.prank(stranger);
        st.setPrice(1);
        vm.expectRevert(ShopTrade.BadPrice.selector);
        vm.prank(committee);
        st.setPrice(0);
        vm.prank(committee);
        st.setPrice(90_000);
        assertEq(st.pricePerKwh(), 90_000);
    }

    function test_adminSetters() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, oracle));
        vm.prank(oracle);
        st.setTreasury(stranger);
        vm.prank(committee);
        st.setTreasury(stranger);
        assertEq(st.treasury(), stranger);
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        vm.prank(committee);
        st.setOracle(address(0));
    }

    function test_placeValidation() public {
        vm.startPrank(shop);
        vm.expectRevert(ShopTrade.BadAmount.selector);
        st.placeOrder("2026-11-07", 0, uint64(block.timestamp + 1));
        vm.expectRevert(ShopTrade.BadAmount.selector);
        st.placeOrder("2026-11-07", 10, uint64(block.timestamp));
        vm.expectRevert(ShopTrade.BadAmount.selector);
        st.placeOrder("", 10, uint64(block.timestamp + 1));
        vm.expectRevert(ShopTrade.BadAmount.selector);
        st.placeOrder("2026-11-07-x", 10, uint64(block.timestamp + 1));
        vm.stopPrank();
    }

    function test_refundAfterDeadline() public {
        uint256 id = _place(500);
        vm.expectRevert(ShopTrade.NotShop.selector);
        vm.prank(stranger);
        st.refund(id);
        vm.expectRevert(ShopTrade.TooEarly.selector);
        vm.prank(shop);
        st.refund(id);
        vm.warp(block.timestamp + 6 hours + 1);
        uint256 before = usdc.balanceOf(shop);
        vm.prank(shop);
        st.refund(id);
        assertEq(usdc.balanceOf(shop), before + 40_000);
        vm.expectRevert(ShopTrade.BadStatus.selector);
        vm.prank(oracle);
        st.settle(id, 100);
    }

    function test_settleZeroRefundsAll() public {
        uint256 id = _place(500);
        uint256 before = usdc.balanceOf(shop);
        vm.prank(oracle);
        st.settle(id, 0);
        assertEq(usdc.balanceOf(shop), before + 40_000);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    /// paid + refunded == deposit, paid never above the fair price, the shop never pays more than asked
    function testFuzz_settleConserves(uint32 wantWh, uint32 deliveredWh, uint64 price) public {
        price = uint64(bound(price, 1, 10_000_000));
        wantWh = uint32(bound(wantWh, 1, 1_000_000));
        vm.prank(committee);
        st.setPrice(price);
        uint256 shopStart = usdc.balanceOf(shop);
        uint256 deposit = st.costOf(wantWh);
        vm.assume(deposit <= shopStart);
        uint256 id = _place(wantWh);
        vm.prank(oracle);
        st.settle(id, deliveredWh);
        uint256 paid = usdc.balanceOf(treasury);
        uint256 got = deliveredWh > wantWh ? wantWh : deliveredWh;
        assertEq(paid + usdc.balanceOf(shop), shopStart);
        assertLe(paid, deposit);
        assertLe(paid * 1000, uint256(got) * price);
        assertEq(usdc.balanceOf(address(st)), 0);
        assertEq(st.totalLocked(), 0);
    }
}
