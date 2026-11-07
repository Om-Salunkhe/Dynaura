// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SolarCredits} from "../../src/SolarCredits.sol";
import {AcceptanceUSDC} from "./AcceptanceUSDC.sol";

/// Acceptance tests for SolarCredits, written from the spec before the contract existed
/// (prompts/tasks-credits.md). Each flat is paid for the spare sun it left unused:
/// claim = pool * unusedWh[flat] / sum(unusedWh), computed on chain.
contract SolarCreditsAcceptanceTest is Test {
    SolarCredits sc;
    AcceptanceUSDC usdc;

    address committee = makeAddr("committee");
    address oracle = makeAddr("oracle");
    address walletA = makeAddr("flatA");
    address walletB = makeAddr("flatB");
    address walletC = makeAddr("flatC");
    address shop = makeAddr("shop");
    address stranger = makeAddr("stranger");

    bytes32 constant DAY = keccak256("sunrise-apartments:2026-11-07");
    bytes32 constant READINGS = keccak256("signed 1-minute panel summaries");
    uint256 constant RATE = 13; // micro-USDC per Wh of the real building (0.013 USDC per kWh)

    function setUp() public {
        usdc = new AcceptanceUSDC();
        sc = new SolarCredits(address(usdc), oracle, committee);
        address[4] memory payers = [walletC, shop, stranger, oracle];
        for (uint256 i = 0; i < payers.length; i++) {
            usdc.mint(payers[i], 100e6);
            vm.prank(payers[i]);
            usdc.approve(address(sc), type(uint256).max);
        }
        vm.startPrank(committee);
        sc.register("A", walletA);
        sc.register("B", walletB);
        sc.register("C", walletC);
        vm.stopPrank();
    }

    /// Pawan's day: A left 30 kWh of its share unused, B left 10, C used 20 kWh more than its share.
    function _postPawansDay() internal {
        string[] memory flats = new string[](3);
        flats[0] = "A";
        flats[1] = "B";
        flats[2] = "C";
        uint256[] memory unused = new uint256[](3);
        unused[0] = 30_000;
        unused[1] = 10_000;
        uint256[] memory over = new uint256[](3);
        over[2] = 20_000;
        vm.prank(oracle);
        sc.postPeriod(DAY, flats, unused, over, RATE, READINGS);
    }

    function _one(string memory flat, uint256 unused, uint256 over)
        internal
        pure
        returns (string[] memory f, uint256[] memory u, uint256[] memory o)
    {
        f = new string[](1);
        f[0] = flat;
        u = new uint256[](1);
        u[0] = unused;
        o = new uint256[](1);
        o[0] = over;
    }

    // ---- the headline: the flat that saved gets paid -------------------------------------

    function test_pawansNumbers_AGetsThreeTimesB() public {
        _postPawansDay();
        vm.prank(walletC);
        sc.payIn(DAY, "C"); // C bought 20 kWh from its neighbours at 0.013 USDC/kWh: 0.26 USDC
        assertEq(usdc.balanceOf(address(sc)), 20_000 * RATE);
        vm.prank(shop);
        sc.fund(DAY, 140_000); // shop + grid revenue: 0.14 USDC
        assertEq(sc.claimable(DAY, "A"), 300_000);
        assertEq(sc.claimable(DAY, "B"), 100_000);
        assertEq(sc.claimable(DAY, "C"), 0);

        sc.claim(DAY, "A"); // anyone may trigger it: the money goes to the flat's registered wallet
        sc.claim(DAY, "B");
        assertEq(usdc.balanceOf(walletA), 300_000);
        assertEq(usdc.balanceOf(walletB), 100_000);
        assertEq(usdc.balanceOf(walletA), 3 * usdc.balanceOf(walletB));
        assertEq(usdc.balanceOf(address(sc)), 0);
    }

    function test_claimPaysTheRegisteredWalletNotTheCaller() public {
        _postPawansDay();
        vm.prank(shop);
        sc.fund(DAY, 400_000);
        uint256 before = usdc.balanceOf(stranger);
        vm.prank(stranger);
        sc.claim(DAY, "A");
        assertEq(usdc.balanceOf(walletA), 300_000);
        assertEq(usdc.balanceOf(stranger), before);
    }

    function test_claimIsOncePerUnitOfMoney_laterFundsPayOnlyTheNewShare() public {
        _postPawansDay();
        vm.prank(shop);
        sc.fund(DAY, 400_000);
        sc.claim(DAY, "A");
        vm.expectRevert();
        sc.claim(DAY, "A"); // nothing new to claim
        vm.prank(shop);
        sc.fund(DAY, 40_000); // late grid revenue
        assertEq(sc.claimable(DAY, "A"), 30_000);
        sc.claim(DAY, "A");
        sc.claim(DAY, "B");
        assertEq(usdc.balanceOf(walletA), 330_000);
        assertEq(usdc.balanceOf(walletB), 110_000);
        assertEq(usdc.balanceOf(address(sc)), 0);
    }

    // ---- postPeriod: oracle only, once, well-formed ---------------------------------------

    function test_onlyOracleCanPost() public {
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _one("A", 5, 0);
        vm.prank(committee);
        vm.expectRevert();
        sc.postPeriod(DAY, f, u, o, RATE, READINGS);
        vm.prank(stranger);
        vm.expectRevert();
        sc.postPeriod(DAY, f, u, o, RATE, READINGS);
    }

    function test_periodIsImmutableOncePosted() public {
        _postPawansDay();
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _one("A", 99, 0);
        vm.prank(oracle);
        vm.expectRevert();
        sc.postPeriod(DAY, f, u, o, RATE, READINGS);
    }

    function test_rejectsMalformedPeriods() public {
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _one("A", 5, 0);
        vm.startPrank(oracle);
        vm.expectRevert(); // zero period id
        sc.postPeriod(bytes32(0), f, u, o, RATE, READINGS);

        uint256[] memory two = new uint256[](2);
        vm.expectRevert(); // length mismatch
        sc.postPeriod(DAY, f, two, o, RATE, READINGS);

        string[] memory none = new string[](0);
        uint256[] memory zero = new uint256[](0);
        vm.expectRevert(); // no flats
        sc.postPeriod(DAY, none, zero, zero, RATE, READINGS);

        string[] memory dup = new string[](2);
        dup[0] = "A";
        dup[1] = "A";
        vm.expectRevert(); // the same flat twice
        sc.postPeriod(DAY, dup, two, two, RATE, READINGS);

        (f, u, o) = _one("", 5, 0);
        vm.expectRevert(); // empty label
        sc.postPeriod(DAY, f, u, o, RATE, READINGS);

        (f, u, o) = _one("FLAT-WITH-A-LONG-NAME", 5, 0);
        vm.expectRevert(); // label over 16 bytes
        sc.postPeriod(DAY, f, u, o, RATE, READINGS);

        (f, u, o) = _one("A", 5, 3);
        vm.expectRevert(); // a flat is either under its share or over it, never both
        sc.postPeriod(DAY, f, u, o, RATE, READINGS);
        vm.stopPrank();
    }

    function test_rejectsAbsurdNumbers() public {
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _one("A", 5, 0);
        vm.startPrank(oracle);
        vm.expectRevert(); // above 1 USDC per Wh (1000 USDC/kWh) is a bug, not a price
        sc.postPeriod(DAY, f, u, o, 1_000_001, READINGS);
        (f, u, o) = _one("A", 1e12 + 1, 0);
        vm.expectRevert(); // over MAX_WH
        sc.postPeriod(DAY, f, u, o, RATE, READINGS);
        vm.stopPrank();
    }

    // ---- register: committee only -------------------------------------------------------------

    function test_onlyOwnerRegistersWallets() public {
        vm.prank(oracle);
        vm.expectRevert();
        sc.register("A", stranger);
        vm.prank(stranger);
        vm.expectRevert();
        sc.register("A", stranger);
        vm.prank(committee);
        vm.expectRevert(); // zero wallet
        sc.register("A", address(0));
        assertEq(sc.walletOf("A"), walletA);
    }

    function test_claimNeedsARegisteredWallet() public {
        string[] memory flats = new string[](2);
        flats[0] = "A";
        flats[1] = "D"; // never registered
        uint256[] memory unused = new uint256[](2);
        unused[0] = 1;
        unused[1] = 1;
        uint256[] memory over = new uint256[](2);
        vm.prank(oracle);
        sc.postPeriod(DAY, flats, unused, over, RATE, READINGS);
        vm.prank(shop);
        sc.fund(DAY, 100);
        vm.expectRevert();
        sc.claim(DAY, "D");
        vm.prank(committee);
        sc.register("D", stranger);
        uint256 before = usdc.balanceOf(stranger);
        sc.claim(DAY, "D");
        assertEq(usdc.balanceOf(stranger) - before, 50);
    }

    // ---- money in --------------------------------------------------------------------------------

    function test_payInIsExactlyOverTimesRate_once_andOnlyForBuyers() public {
        _postPawansDay();
        vm.expectRevert(); // A sold, it didn't buy
        sc.payIn(DAY, "A");
        uint256 before = usdc.balanceOf(walletC);
        vm.prank(walletC);
        sc.payIn(DAY, "C");
        assertEq(before - usdc.balanceOf(walletC), 260_000);
        vm.prank(walletC);
        vm.expectRevert(); // already paid
        sc.payIn(DAY, "C");
        vm.expectRevert(); // not in the period
        sc.payIn(DAY, "Z");
    }

    function test_fundNeedsAPostedPeriodWithSellers() public {
        vm.prank(shop);
        vm.expectRevert(); // not posted
        sc.fund(DAY, 1);
        _postPawansDay();
        vm.prank(shop);
        vm.expectRevert(); // zero amount
        sc.fund(DAY, 0);

        bytes32 nobodySaved = keccak256("day nobody saved");
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _one("C", 0, 5);
        vm.prank(oracle);
        sc.postPeriod(nobodySaved, f, u, o, RATE, READINGS);
        vm.prank(shop);
        vm.expectRevert(); // nobody to pay: the money would be stuck
        sc.fund(nobodySaved, 1);
        vm.prank(walletC);
        vm.expectRevert();
        sc.payIn(nobodySaved, "C");
    }

    // ---- the pool never pays out more than came in ---------------------------------------------

    function testFuzz_claimsNeverExceedThePool(uint64 a, uint64 b, uint64 c, uint96 funded) public {
        a = uint64(bound(a, 0, 1e12)); // the contract caps each flat at MAX_WH = 1e12
        b = uint64(bound(b, 0, 1e12));
        c = uint64(bound(c, 1, 1e12)); // someone saved, so the pool can be funded
        funded = uint96(bound(funded, 1, 50e6));
        string[] memory flats = new string[](3);
        flats[0] = "A";
        flats[1] = "B";
        flats[2] = "C";
        uint256[] memory unused = new uint256[](3);
        unused[0] = a;
        unused[1] = b;
        unused[2] = c;
        uint256[] memory over = new uint256[](3);
        vm.prank(oracle);
        sc.postPeriod(DAY, flats, unused, over, RATE, READINGS);
        vm.prank(shop);
        sc.fund(DAY, funded);
        uint256 total = uint256(a) + b + c;
        uint256 paid;
        for (uint256 i = 0; i < 3; i++) {
            uint256 expected = uint256(funded) * unused[i] / total;
            assertEq(sc.claimable(DAY, flats[i]), expected);
            if (expected > 0) sc.claim(DAY, flats[i]);
            paid += expected;
        }
        assertLe(paid, funded);
        assertLt(funded - paid, 3); // rounding dust: under one micro-USDC per flat
        assertEq(usdc.balanceOf(address(sc)), funded - paid);
    }

    // ---- roles ------------------------------------------------------------------------------------

    function test_rolesFromTheConstructor() public view {
        assertEq(sc.owner(), committee);
        assertEq(sc.oracle(), oracle);
        assertEq(address(sc.usdc()), address(usdc));
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert();
        new SolarCredits(address(0), oracle, committee);
        vm.expectRevert();
        new SolarCredits(address(usdc), address(0), committee);
        vm.expectRevert();
        new SolarCredits(address(usdc), oracle, address(0));
    }

    function test_onlyOwnerChangesTheOracle() public {
        vm.prank(oracle);
        vm.expectRevert();
        sc.setOracle(stranger);
        vm.prank(committee);
        sc.setOracle(stranger);
        assertEq(sc.oracle(), stranger);
    }
}
