// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShopTradeBase} from "./ShopTrade.Base.t.sol";
import {ShopTrade} from "../src/ShopTrade.sol";

/// @dev Deferred refunds (blocked shop) and admin functions.
contract ShopTradeDeferredAdminTest is ShopTradeBase {
    function test_Settle_BlockedShop_DefersRefund() public {
        uint256 id = _place(shop, 2000); // 3.0 USDC
        usdc.setBlocked(shop, true);
        uint256 shopBefore = usdc.balanceOf(shop);

        vm.expectEmit(true, true, false, true, address(trade));
        emit ShopTrade.RefundDeferred(id, shop, 1_200_000);
        vm.expectEmit(true, true, false, true, address(trade));
        emit ShopTrade.OrderSettled(id, shop, 1200, 1_800_000, 0);
        vm.prank(oracle);
        trade.settle(id, 1200);

        assertEq(usdc.balanceOf(treasury), 1_800_000, "treasury still paid");
        assertEq(uint8(_status(id)), uint8(ShopTrade.Status.Settled));
        assertEq(trade.pendingRefund(id), 1_200_000);
        assertEq(trade.totalLocked(), 1_200_000);
        assertEq(usdc.balanceOf(address(trade)), 1_200_000);
        assertEq(usdc.balanceOf(shop), shopBefore);

        // only the shop may claim
        vm.prank(stranger);
        vm.expectRevert(ShopTrade.NotShop.selector);
        trade.claimRefund(id);
        vm.prank(oracle);
        vm.expectRevert(ShopTrade.NotShop.selector);
        trade.claimRefund(id);
        vm.prank(shop2);
        vm.expectRevert(ShopTrade.NotShop.selector);
        trade.claimRefund(id);

        // fails while blocked, state intact
        vm.prank(shop);
        vm.expectRevert(_blockedErr(shop));
        trade.claimRefund(id);
        assertEq(trade.pendingRefund(id), 1_200_000);
        assertEq(trade.totalLocked(), 1_200_000);

        // works after unblock
        usdc.setBlocked(shop, false);
        vm.expectEmit(true, true, false, true, address(trade));
        emit ShopTrade.RefundClaimed(id, shop, 1_200_000);
        vm.prank(shop);
        trade.claimRefund(id);
        assertEq(usdc.balanceOf(shop), shopBefore + 1_200_000);
        assertEq(trade.pendingRefund(id), 0);
        assertEq(trade.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(trade)), 0);

        // no double claim
        vm.prank(shop);
        vm.expectRevert(ShopTrade.NothingPending.selector);
        trade.claimRefund(id);
    }

    function test_Settle_BlockedShop_ZeroDelivered_AllDeferred() public {
        uint256 id = _place(shop, 1000);
        usdc.setBlocked(shop, true);
        vm.prank(oracle);
        trade.settle(id, 0);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(trade.pendingRefund(id), 1_500_000);
        assertEq(trade.totalLocked(), 1_500_000);
    }

    function test_Settle_BlockedShop_FullDelivery_NothingDeferred() public {
        uint256 id = _place(shop, 1000);
        usdc.setBlocked(shop, true);
        vm.prank(oracle);
        trade.settle(id, 1000);
        assertEq(trade.pendingRefund(id), 0);
        assertEq(trade.totalLocked(), 0);
        vm.prank(shop);
        vm.expectRevert(ShopTrade.NothingPending.selector);
        trade.claimRefund(id);
    }

    function test_RevertWhen_ClaimRefund_NothingPendingOrNonexistent() public {
        uint256 id = _place(shop, 1000);
        vm.prank(shop);
        vm.expectRevert(ShopTrade.NothingPending.selector);
        trade.claimRefund(id);
        vm.prank(shop);
        vm.expectRevert(ShopTrade.NotShop.selector);
        trade.claimRefund(555);
    }

    // ---------------------------------------------------------------- admin
    function test_SetOracle_OwnerOnly() public {
        address newOracle = makeAddr("newOracle");
        vm.expectEmit(false, false, false, true, address(trade));
        emit ShopTrade.OracleChanged(newOracle);
        vm.prank(owner);
        trade.setOracle(newOracle);
        assertEq(trade.oracle(), newOracle);

        uint256 id = _place(shop, 1000);
        vm.prank(oracle);
        vm.expectRevert(ShopTrade.NotOracle.selector);
        trade.settle(id, 1);
        vm.prank(newOracle);
        trade.settle(id, 1);
    }

    function test_RevertWhen_SetOracle_NonOwnerOrZero() public {
        vm.prank(oracle);
        vm.expectRevert(_notOwner(oracle));
        trade.setOracle(makeAddr("x"));
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        trade.setOracle(makeAddr("x"));
        vm.prank(owner);
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        trade.setOracle(address(0));
    }

    function test_SetTreasury_OwnerOnly() public {
        address newTreasury = makeAddr("newTreasury");
        vm.expectEmit(false, false, false, true, address(trade));
        emit ShopTrade.TreasuryChanged(newTreasury);
        vm.prank(owner);
        trade.setTreasury(newTreasury);
        assertEq(trade.treasury(), newTreasury);
    }

    function test_RevertWhen_SetTreasury_NonOwnerOrZero() public {
        vm.prank(oracle);
        vm.expectRevert(_notOwner(oracle));
        trade.setTreasury(makeAddr("x"));
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        trade.setTreasury(makeAddr("x"));
        vm.prank(owner);
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        trade.setTreasury(address(0));
    }

    function test_Ownership_TwoStepAndRenounceDisabled() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        trade.transferOwnership(newOwner);
        assertEq(trade.owner(), owner);
        assertEq(trade.pendingOwner(), newOwner);
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        trade.acceptOwnership();
        vm.prank(newOwner);
        trade.acceptOwnership();
        assertEq(trade.owner(), newOwner);

        vm.prank(owner);
        vm.expectRevert(_notOwner(owner));
        trade.setTreasury(makeAddr("x"));

        vm.prank(newOwner);
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        trade.renounceOwnership();
        assertEq(trade.owner(), newOwner);
        vm.prank(newOwner);
        vm.expectRevert(ShopTrade.ZeroAddress.selector);
        trade.transferOwnership(address(0));
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        trade.transferOwnership(stranger);
    }
}
