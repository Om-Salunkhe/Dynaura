// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ShopTrade} from "../src/ShopTrade.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @dev Shared fixture. Contains no test functions.
abstract contract ShopTradeBase is Test {
    MockUSDC internal usdc;
    ShopTrade internal trade;

    address internal owner = makeAddr("owner");
    address internal oracle = makeAddr("oracle");
    address internal treasury = makeAddr("treasury");
    address internal shop = makeAddr("shop");
    address internal shop2 = makeAddr("shop2");
    address internal stranger = makeAddr("stranger");

    uint64 internal constant PRICE = 1_500_000; // 1.5 USDC per kWh

    function setUp() public virtual {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
        trade = new ShopTrade(address(usdc), oracle, treasury, PRICE, owner);
        _fund(shop);
        _fund(shop2);
    }

    function _fund(address who) internal {
        usdc.mint(who, 1_000_000_000e6);
        vm.prank(who);
        usdc.approve(address(trade), type(uint256).max);
    }

    function _shopOf(uint256 id) internal view returns (address s) {
        (s,,,,,,,) = trade.orders(id);
    }

    function _want(uint256 id) internal view returns (uint32 w) {
        (,, w,,,,,) = trade.orders(id);
    }

    function _delivered(uint256 id) internal view returns (uint32 d) {
        (,,, d,,,,) = trade.orders(id);
    }

    function _price(uint256 id) internal view returns (uint64 p) {
        (,,,, p,,,) = trade.orders(id);
    }

    function _day(uint256 id) internal view returns (string memory d) {
        (,,,,,,, d) = trade.orders(id);
    }

    function _status(uint256 id) internal view returns (ShopTrade.Status st) {
        (,,,,,, st,) = trade.orders(id);
    }

    function _deposit(uint256 id) internal view returns (uint96 d) {
        (, d,,,,,,) = trade.orders(id);
    }

    function _deadline(uint256 id) internal view returns (uint64 d) {
        (,,,,, d,,) = trade.orders(id);
    }

    function _place(address who, uint32 wantWh) internal returns (uint256 id) {
        vm.prank(who);
        id = trade.placeOrder("2025-06-01", wantWh, uint64(block.timestamp + 1 days));
    }

    function _notOwner(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    function _blockedErr(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(MockUSDC.Blocked.selector, who);
    }

    function _ceil(uint256 wh, uint256 price) internal pure returns (uint256) {
        uint256 x = wh * price;
        return x / 1000 + (x % 1000 == 0 ? 0 : 1);
    }
}
