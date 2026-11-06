// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ShopTradeBase} from "./ShopTrade.Base.t.sol";
import {ShopTrade} from "../src/ShopTrade.sol";

contract ShopTradeTest is ShopTradeBase {
    // ----------------------------------------------------------------- ctor
    function test_Constructor_SetsStateAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit ShopTrade.OracleChanged(oracle);
        vm.expectEmit(false, false, false, true);
        emit ShopTrade.TreasuryChanged(treasury);
        vm.expectEmit(false, false, false, true);
        emit ShopTrade.PriceSet(PRICE);
        ShopTrade t = new ShopTrade(address(usdc), oracle, treasury, PRICE, owner);
        assertEq(address(t.usdc()), address(usdc));
        assertEq(t.oracle(), oracle);
        assertEq(t.treasury(), treasury);
        assertEq(t.pricePerKwh(), PRICE);
        assertEq(t.owner(), owner);
        assertEq(t.nextOrderId(), 1);
        assertEq(t.totalLocked(), 0);
    }

    function test_RevertWhen_Constructor_ZeroAddresses() public {
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        new ShopTrade(address(0), oracle, treasury, PRICE, owner);
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        new ShopTrade(address(usdc), address(0), treasury, PRICE, owner);
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        new ShopTrade(address(usdc), oracle, address(0), PRICE, owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ShopTrade(address(usdc), oracle, treasury, PRICE, address(0));
    }

    function test_Constructor_PriceBounds() public {
        vm.expectRevert(ShopTrade.BadPrice.selector);
        new ShopTrade(address(usdc), oracle, treasury, 0, owner);
        vm.expectRevert(ShopTrade.BadPrice.selector);
        new ShopTrade(address(usdc), oracle, treasury, 10_000_001, owner);
        assertEq(new ShopTrade(address(usdc), oracle, treasury, 1, owner).pricePerKwh(), 1);
        assertEq(new ShopTrade(address(usdc), oracle, treasury, 10_000_000, owner).pricePerKwh(), 10_000_000);
    }

    // --------------------------------------------------------------- costOf
    function test_CostOf_RoundsUp() public {
        vm.prank(owner);
        trade.setPrice(1);
        assertEq(trade.costOf(0), 0);
        assertEq(trade.costOf(1), 1); // 0.001 -> 1
        assertEq(trade.costOf(999), 1);
        assertEq(trade.costOf(1000), 1); // exact
        assertEq(trade.costOf(1001), 2); // 1.001 -> 2
        vm.prank(owner);
        trade.setPrice(1500);
        assertEq(trade.costOf(1), 2); // 1.5 -> 2
        assertEq(trade.costOf(2), 3); // exact
        assertEq(trade.costOf(1000), 1500);
    }

    // ----------------------------------------------------------- placeOrder
    function test_PlaceOrder_HappyPath() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        uint256 before = usdc.balanceOf(shop);
        vm.expectEmit(true, true, false, true, address(trade));
        emit ShopTrade.OrderPlaced(1, shop, "2025-06-01", 2000, 3_000_000, PRICE);
        vm.prank(shop);
        uint256 id = trade.placeOrder("2025-06-01", 2000, dl);

        assertEq(id, 1);
        assertEq(trade.nextOrderId(), 2);
        assertEq(_shopOf(1), shop);
        assertEq(_deposit(1), 3_000_000);
        assertEq(_want(1), 2000);
        assertEq(_delivered(1), 0);
        assertEq(_price(1), PRICE);
        assertEq(_deadline(1), dl);
        assertEq(uint8(_status(1)), uint8(ShopTrade.Status.Open));
        assertEq(_day(1), "2025-06-01");
        assertEq(usdc.balanceOf(shop), before - 3_000_000);
        assertEq(usdc.balanceOf(address(trade)), 3_000_000);
        assertEq(trade.totalLocked(), 3_000_000);
    }

    function test_PlaceOrder_DepositRoundsUp() public {
        vm.prank(owner);
        trade.setPrice(1500);
        uint256 id = _place(shop, 1);
        assertEq(_deposit(id), 2);
        assertEq(trade.totalLocked(), 2);
    }

    function test_PlaceOrder_PriceFrozenAfterSetPrice() public {
        uint256 id = _place(shop, 1000); // 1.5 USDC
        vm.prank(owner);
        trade.setPrice(5_000_000);
        assertEq(_price(id), PRICE);
        assertEq(_deposit(id), 1_500_000);
        // new order uses the new price
        uint256 id2 = _place(shop, 1000);
        assertEq(_price(id2), 5_000_000);
        assertEq(_deposit(id2), 5_000_000);
        // settle uses the frozen price for the first order
        vm.prank(oracle);
        trade.settle(id, 1000);
        assertEq(usdc.balanceOf(treasury), 1_500_000);
    }

    function test_PlaceOrder_Day10BytesOk() public {
        vm.prank(shop);
        uint256 id = trade.placeOrder("0123456789", 1, uint64(block.timestamp + 1));
        assertEq(_day(id), "0123456789");
    }

    function test_RevertWhen_PlaceOrder_Day11Bytes() public {
        vm.prank(shop);
        vm.expectRevert(ShopTrade.BadAmount.selector);
        trade.placeOrder("01234567890", 1, uint64(block.timestamp + 1));
    }

    function test_RevertWhen_PlaceOrder_ZeroWh() public {
        vm.prank(shop);
        vm.expectRevert(ShopTrade.BadAmount.selector);
        trade.placeOrder("d", 0, uint64(block.timestamp + 1));
    }

    function test_RevertWhen_PlaceOrder_DeadlineNowOrPast() public {
        vm.prank(shop);
        vm.expectRevert(ShopTrade.BadAmount.selector);
        trade.placeOrder("d", 1, uint64(block.timestamp));
        vm.prank(shop);
        vm.expectRevert(ShopTrade.BadAmount.selector);
        trade.placeOrder("d", 1, uint64(block.timestamp - 1));
    }

    function test_RevertWhen_PlaceOrder_NoAllowance() public {
        vm.prank(stranger);
        vm.expectRevert();
        trade.placeOrder("d", 1000, uint64(block.timestamp + 1));
        assertEq(trade.nextOrderId(), 1);
        assertEq(trade.totalLocked(), 0);
    }

    // ------------------------------------------------------------- setPrice
    function test_SetPrice_OwnerAndOracle() public {
        vm.expectEmit(false, false, false, true, address(trade));
        emit ShopTrade.PriceSet(2_000_000);
        vm.prank(owner);
        trade.setPrice(2_000_000);
        assertEq(trade.pricePerKwh(), 2_000_000);
        vm.prank(oracle);
        trade.setPrice(3_000_000);
        assertEq(trade.pricePerKwh(), 3_000_000);
    }

    function test_SetPrice_Bounds() public {
        vm.startPrank(owner);
        trade.setPrice(10_000_000);
        assertEq(trade.pricePerKwh(), 10_000_000);
        trade.setPrice(1);
        assertEq(trade.pricePerKwh(), 1);
        vm.expectRevert(ShopTrade.BadPrice.selector);
        trade.setPrice(0);
        vm.expectRevert(ShopTrade.BadPrice.selector);
        trade.setPrice(10_000_001);
        vm.stopPrank();
        vm.prank(oracle);
        vm.expectRevert(ShopTrade.BadPrice.selector);
        trade.setPrice(0);
    }

    function test_RevertWhen_SetPrice_Stranger() public {
        vm.prank(stranger);
        vm.expectRevert(ShopTrade.NotAllowed.selector);
        trade.setPrice(2_000_000);
        vm.prank(shop);
        vm.expectRevert(ShopTrade.NotAllowed.selector);
        trade.setPrice(2_000_000);
        assertEq(trade.pricePerKwh(), PRICE);
    }

    // --------------------------------------------------------------- settle
    function test_Settle_PartialDelivery() public {
        uint256 id = _place(shop, 2000); // deposit 3.0 USDC
        uint256 shopBefore = usdc.balanceOf(shop);
        // 1200 Wh * 1.5 = 1.8 USDC to treasury, 1.2 back
        vm.expectEmit(true, true, false, true, address(trade));
        emit ShopTrade.OrderSettled(id, shop, 1200, 1_800_000, 1_200_000);
        vm.prank(oracle);
        trade.settle(id, 1200);

        assertEq(uint8(_status(id)), uint8(ShopTrade.Status.Settled));
        assertEq(_delivered(id), 1200);
        assertEq(usdc.balanceOf(treasury), 1_800_000);
        assertEq(usdc.balanceOf(shop), shopBefore + 1_200_000);
        assertEq(usdc.balanceOf(address(trade)), 0);
        assertEq(trade.totalLocked(), 0);
        assertEq(trade.pendingRefund(id), 0);
    }

    function test_Settle_CapsDeliveredAtWant() public {
        uint256 id = _place(shop, 2000);
        vm.prank(oracle);
        trade.settle(id, 999_999);
        assertEq(_delivered(id), 2000);
        assertEq(usdc.balanceOf(treasury), 3_000_000);
        assertEq(usdc.balanceOf(address(trade)), 0);
        assertEq(trade.totalLocked(), 0);
    }

    function test_Settle_ZeroDeliveredReturnsEverything() public {
        uint256 id = _place(shop, 2000);
        uint256 shopBefore = usdc.balanceOf(shop);
        vm.expectEmit(true, true, false, true, address(trade));
        emit ShopTrade.OrderSettled(id, shop, 0, 0, 3_000_000);
        vm.prank(oracle);
        trade.settle(id, 0);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(usdc.balanceOf(shop), shopBefore + 3_000_000);
        assertEq(trade.totalLocked(), 0);
    }

    function test_Settle_RoundingPaysFloorRefundsRest() public {
        vm.prank(owner);
        trade.setPrice(1500);
        uint256 id = _place(shop, 1); // deposit 2 (ceil of 1.5)
        vm.prank(oracle);
        trade.settle(id, 1); // paid floor(1.5) = 1, refund 1
        assertEq(usdc.balanceOf(treasury), 1);
        assertEq(usdc.balanceOf(address(trade)), 0);
        assertEq(trade.totalLocked(), 0);
    }

    function test_Settle_UsesCurrentTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        uint256 id = _place(shop, 1000);
        vm.prank(owner);
        trade.setTreasury(newTreasury);
        vm.prank(oracle);
        trade.settle(id, 1000);
        assertEq(usdc.balanceOf(newTreasury), 1_500_000);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_Settle_WorksAfterDeadline() public {
        uint256 id = _place(shop, 1000);
        vm.warp(_deadline(id) + 5 days);
        vm.prank(oracle);
        trade.settle(id, 500);
        assertEq(usdc.balanceOf(treasury), 750_000);
    }

    function test_RevertWhen_Settle_NotOracle() public {
        uint256 id = _place(shop, 1000);
        address[3] memory callers = [owner, shop, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(ShopTrade.NotOracle.selector);
            trade.settle(id, 10);
        }
    }

    function test_RevertWhen_Settle_Twice() public {
        uint256 id = _place(shop, 1000);
        vm.prank(oracle);
        trade.settle(id, 500);
        vm.prank(oracle);
        vm.expectRevert(ShopTrade.BadStatus.selector);
        trade.settle(id, 500);
        assertEq(usdc.balanceOf(treasury), 750_000);
    }

    function test_RevertWhen_Settle_AfterRefund() public {
        uint256 id = _place(shop, 1000);
        vm.warp(_deadline(id) + 1);
        vm.prank(shop);
        trade.refund(id);
        vm.prank(oracle);
        vm.expectRevert(ShopTrade.BadStatus.selector);
        trade.settle(id, 500);
    }

    function test_RevertWhen_Settle_NonexistentOrder() public {
        vm.prank(oracle);
        vm.expectRevert(ShopTrade.BadStatus.selector);
        trade.settle(1, 1);
        vm.prank(oracle);
        vm.expectRevert(ShopTrade.BadStatus.selector);
        trade.settle(0, 1);
    }

    function test_RevertWhen_Settle_TreasuryBlocked_AtomicRevert() public {
        uint256 id = _place(shop, 1000);
        usdc.setBlocked(treasury, true);
        vm.prank(oracle);
        vm.expectRevert(_blockedErr(treasury));
        trade.settle(id, 1000);
        assertEq(uint8(_status(id)), uint8(ShopTrade.Status.Open));
        assertEq(trade.totalLocked(), 1_500_000);
        assertEq(usdc.balanceOf(address(trade)), 1_500_000);
    }

    // --------------------------------------------------------------- refund
    function test_Refund_AfterDeadlineByShop() public {
        uint256 id = _place(shop, 1000);
        uint256 before = usdc.balanceOf(shop);
        vm.warp(_deadline(id) + 1);
        vm.expectEmit(true, true, false, true, address(trade));
        emit ShopTrade.OrderRefunded(id, shop, 1_500_000);
        vm.prank(shop);
        trade.refund(id);
        assertEq(uint8(_status(id)), uint8(ShopTrade.Status.Refunded));
        assertEq(usdc.balanceOf(shop), before + 1_500_000);
        assertEq(usdc.balanceOf(address(trade)), 0);
        assertEq(trade.totalLocked(), 0);
    }

    function test_RevertWhen_Refund_BeforeDeadline() public {
        uint256 id = _place(shop, 1000);
        vm.prank(shop);
        vm.expectRevert(ShopTrade.TooEarly.selector);
        trade.refund(id);
        vm.warp(_deadline(id)); // at deadline still too early
        vm.prank(shop);
        vm.expectRevert(ShopTrade.TooEarly.selector);
        trade.refund(id);
    }

    function test_RevertWhen_Refund_NotShop() public {
        uint256 id = _place(shop, 1000);
        vm.warp(_deadline(id) + 1);
        address[4] memory callers = [stranger, oracle, owner, shop2];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(ShopTrade.NotShop.selector);
            trade.refund(id);
        }
    }

    function test_RevertWhen_Refund_Twice() public {
        uint256 id = _place(shop, 1000);
        vm.warp(_deadline(id) + 1);
        vm.prank(shop);
        trade.refund(id);
        vm.prank(shop);
        vm.expectRevert(ShopTrade.BadStatus.selector);
        trade.refund(id);
    }

    function test_RevertWhen_Refund_AfterSettle() public {
        uint256 id = _place(shop, 1000);
        vm.prank(oracle);
        trade.settle(id, 1000);
        vm.warp(_deadline(id) + 1);
        vm.prank(shop);
        vm.expectRevert(ShopTrade.BadStatus.selector);
        trade.refund(id);
    }

    function test_RevertWhen_Refund_BlockedShop_ThenWorksAfterUnblock() public {
        uint256 id = _place(shop, 1000);
        vm.warp(_deadline(id) + 1);
        usdc.setBlocked(shop, true);
        vm.prank(shop);
        vm.expectRevert(_blockedErr(shop));
        trade.refund(id);
        assertEq(uint8(_status(id)), uint8(ShopTrade.Status.Open));
        usdc.setBlocked(shop, false);
        vm.prank(shop);
        trade.refund(id);
        assertEq(trade.totalLocked(), 0);
    }
}
