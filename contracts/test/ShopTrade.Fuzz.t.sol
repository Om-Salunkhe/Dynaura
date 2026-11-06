// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShopTradeBase} from "./ShopTrade.Base.t.sol";
import {ShopTrade} from "../src/ShopTrade.sol";

contract ShopTradeFuzzTest is ShopTradeBase {
    /// forge-config: default.fuzz.runs = 512
    function testFuzz_Settle_Conservation(uint64 price, uint32 wantWh, uint32 deliveredWh) public {
        price = uint64(bound(price, 1, 10_000_000));
        wantWh = uint32(bound(wantWh, 1, type(uint32).max));
        vm.prank(owner);
        trade.setPrice(price);

        uint256 expectedDeposit = _ceil(wantWh, price);
        assertEq(trade.costOf(wantWh), expectedDeposit, "costOf rounds up");

        uint256 shopStart = usdc.balanceOf(shop);
        uint256 treasuryStart = usdc.balanceOf(treasury);
        uint256 id = _place(shop, wantWh);

        assertEq(_deposit(id), expectedDeposit, "deposit = ceil");
        assertEq(usdc.balanceOf(address(trade)), expectedDeposit);
        assertEq(trade.totalLocked(), expectedDeposit);
        assertEq(usdc.balanceOf(shop), shopStart - expectedDeposit);

        uint256 effective = deliveredWh > wantWh ? wantWh : deliveredWh;
        uint256 expectedPaid = (effective * uint256(price)) / 1000;

        vm.prank(oracle);
        trade.settle(id, deliveredWh);

        uint256 paid = usdc.balanceOf(treasury) - treasuryStart;
        uint256 refunded = usdc.balanceOf(shop) - (shopStart - expectedDeposit);
        assertEq(paid, expectedPaid, "paid = floor");
        assertEq(paid + refunded, expectedDeposit, "paid + refunded == deposit");
        assertEq(usdc.balanceOf(shop) + usdc.balanceOf(treasury), shopStart + treasuryStart, "shop+treasury conserved");
        assertEq(usdc.balanceOf(address(trade)), 0);
        assertEq(trade.totalLocked(), 0);
        assertEq(_delivered(id), effective);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_Settle_BlockedShop_Conservation(uint64 price, uint32 wantWh, uint32 deliveredWh) public {
        price = uint64(bound(price, 1, 10_000_000));
        wantWh = uint32(bound(wantWh, 1, type(uint32).max));
        vm.prank(owner);
        trade.setPrice(price);
        uint256 id = _place(shop, wantWh);
        uint256 deposit = _deposit(id);
        usdc.setBlocked(shop, true);

        uint256 effective = deliveredWh > wantWh ? wantWh : deliveredWh;
        uint256 paid = (effective * uint256(price)) / 1000;

        vm.prank(oracle);
        trade.settle(id, deliveredWh);

        assertEq(usdc.balanceOf(treasury), paid);
        assertEq(trade.pendingRefund(id), deposit - paid);
        assertEq(trade.totalLocked(), deposit - paid);
        assertEq(usdc.balanceOf(address(trade)), deposit - paid);

        usdc.setBlocked(shop, false);
        if (deposit - paid > 0) {
            vm.prank(shop);
            trade.claimRefund(id);
        }
        assertEq(trade.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(trade)), 0);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_Refund_ReturnsExactDeposit(uint64 price, uint32 wantWh, uint32 extra) public {
        price = uint64(bound(price, 1, 10_000_000));
        wantWh = uint32(bound(wantWh, 1, type(uint32).max));
        vm.prank(owner);
        trade.setPrice(price);
        uint256 shopStart = usdc.balanceOf(shop);
        uint256 id = _place(shop, wantWh);
        vm.warp(uint256(_deadline(id)) + 1 + extra);
        vm.prank(shop);
        trade.refund(id);
        assertEq(usdc.balanceOf(shop), shopStart);
        assertEq(usdc.balanceOf(address(trade)), 0);
        assertEq(trade.totalLocked(), 0);
    }

    /// @dev Two concurrent orders at different prices: contract balance always equals totalLocked.
    /// forge-config: default.fuzz.runs = 512
    function testFuzz_ConcurrentOrders_BalanceEqualsTotalHeld(
        uint64 p1,
        uint64 p2,
        uint32 w1,
        uint32 w2,
        uint32 d1
    ) public {
        p1 = uint64(bound(p1, 1, 10_000_000));
        p2 = uint64(bound(p2, 1, 10_000_000));
        w1 = uint32(bound(w1, 1, type(uint32).max));
        w2 = uint32(bound(w2, 1, type(uint32).max));

        vm.prank(owner);
        trade.setPrice(p1);
        uint256 a = _place(shop, w1);
        vm.prank(oracle);
        trade.setPrice(p2);
        uint256 b = _place(shop2, w2);
        uint256 expected = _ceil(w1, p1) + _ceil(w2, p2);
        assertEq(trade.totalLocked(), expected);
        assertEq(usdc.balanceOf(address(trade)), expected);

        vm.prank(oracle);
        trade.settle(a, d1);
        assertEq(trade.totalLocked(), _ceil(w2, p2));
        assertEq(usdc.balanceOf(address(trade)), trade.totalLocked());

        vm.warp(uint256(_deadline(b)) + 1);
        vm.prank(shop2);
        trade.refund(b);
        assertEq(trade.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(trade)), 0);
    }
}
