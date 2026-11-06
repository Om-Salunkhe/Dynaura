// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SolarCredits} from "../src/SolarCredits.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {SolarCreditsTestBase} from "./SolarCredits.Base.t.sol";

contract SolarCreditsFlowTest is SolarCreditsTestBase {
    function setUp() public override {
        super.setUp();
        _postABC(P1);
        _regABC();
    }

    // ======================= fund =======================
    function test_Fund_UnpostedReverts() public {
        vm.prank(funder);
        vm.expectRevert(SolarCredits.NoPeriod.selector);
        sc.fund(P2, 1);
    }

    function test_Fund_ZeroAmountReverts() public {
        vm.prank(funder);
        vm.expectRevert(SolarCredits.BadAmount.selector);
        sc.fund(P1, 0);
    }

    function test_Fund_TotalUnusedZeroReverts() public {
        _post(P2, _s("X", "Y"), _n(0, 0), _n(5, 0), 3);
        usdc.mint(funder, 100);
        vm.startPrank(funder);
        usdc.approve(address(sc), 100);
        vm.expectRevert(SolarCredits.NoUnusedWh.selector);
        sc.fund(P2, 100);
        vm.stopPrank();
    }

    function test_Fund_HappyPath_MovesUsdcAndEmits() public {
        usdc.mint(funder, 1_000);
        vm.startPrank(funder);
        usdc.approve(address(sc), 1_000);
        vm.expectEmit(true, true, false, true, address(sc));
        emit SolarCredits.PeriodFunded(P1, funder, 600);
        sc.fund(P1, 600);
        vm.stopPrank();
        assertEq(usdc.balanceOf(funder), 400);
        assertEq(usdc.balanceOf(address(sc)), 600);
        assertEq(_totalIn(P1), 600);

        _fund(P1, alice, 50); // anyone, even a registered wallet
        assertEq(_totalIn(P1), 650);
        assertEq(usdc.balanceOf(address(sc)), 650);
    }

    function test_Fund_InsufficientAllowanceReverts() public {
        usdc.mint(funder, 100);
        vm.startPrank(funder);
        usdc.approve(address(sc), 50);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(sc), 50, 100));
        sc.fund(P1, 100);
        vm.stopPrank();
        assertEq(_totalIn(P1), 0);
    }

    function test_Fund_InsufficientBalanceReverts() public {
        usdc.mint(funder, 40);
        vm.startPrank(funder);
        usdc.approve(address(sc), 100);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, funder, 40, 100));
        sc.fund(P1, 100);
        vm.stopPrank();
        assertEq(_totalIn(P1), 0);
    }

    // ======================= payIn =======================
    function test_PayIn_PullsExactAmount_Event_Flag() public {
        usdc.mint(funder, 1_000_000);
        vm.startPrank(funder);
        usdc.approve(address(sc), type(uint256).max);
        vm.expectEmit(true, true, false, true, address(sc));
        emit SolarCredits.NeighborPaid(P1, "C", funder, 20_000, 260_000);
        sc.payIn(P1, "C");
        vm.stopPrank();
        assertEq(usdc.balanceOf(funder), 1_000_000 - 260_000);
        assertEq(usdc.balanceOf(address(sc)), 260_000);
        assertEq(_totalIn(P1), 260_000);
        (,,, bool paid,) = sc.flatInfo(P1, "C");
        assertTrue(paid);
    }

    function test_PayIn_SecondCallReverts() public {
        _payIn(P1, "C", funder, 260_000);
        usdc.mint(funder, 260_000);
        vm.startPrank(funder);
        usdc.approve(address(sc), 260_000);
        vm.expectRevert(SolarCredits.AlreadyPaid.selector);
        sc.payIn(P1, "C");
        vm.stopPrank();
        assertEq(_totalIn(P1), 260_000);
    }

    function test_PayIn_SellerFlatReverts() public {
        vm.prank(funder);
        vm.expectRevert(SolarCredits.NotBuyer.selector);
        sc.payIn(P1, "A");
    }

    function test_PayIn_FlatBothZeroReverts() public {
        _post(P2, _s("A", "Z"), _n(5, 0), _n(0, 0), 3);
        vm.prank(funder);
        vm.expectRevert(SolarCredits.NotBuyer.selector);
        sc.payIn(P2, "Z");
    }

    function test_PayIn_FlatNotInPeriodReverts() public {
        vm.prank(funder);
        vm.expectRevert(SolarCredits.NotBuyer.selector);
        sc.payIn(P1, "NOPE");
    }

    function test_PayIn_UnpostedPeriodReverts() public {
        vm.prank(funder);
        vm.expectRevert(SolarCredits.NoPeriod.selector);
        sc.payIn(P2, "C");
    }

    function test_PayIn_TotalUnusedZeroReverts() public {
        _post(P2, _s("X", "Y"), _n(0, 0), _n(5, 0), 3);
        usdc.mint(funder, 100);
        vm.startPrank(funder);
        usdc.approve(address(sc), 100);
        vm.expectRevert(SolarCredits.NoUnusedWh.selector);
        sc.payIn(P2, "X");
        vm.stopPrank();
    }

    function test_PayIn_RateZeroMarksPaidWithoutTransfer() public {
        _post(P2, _s("S", "B"), _n(10, 0), _n(0, 500), 0);
        vm.expectEmit(true, true, false, true, address(sc));
        emit SolarCredits.NeighborPaid(P2, "B", funder, 500, 0);
        vm.prank(funder); // no balance, no allowance needed
        sc.payIn(P2, "B");
        (,,, bool paid,) = sc.flatInfo(P2, "B");
        assertTrue(paid);
        assertEq(_totalIn(P2), 0);
        assertEq(usdc.balanceOf(address(sc)), 0);
        vm.prank(funder);
        vm.expectRevert(SolarCredits.AlreadyPaid.selector);
        sc.payIn(P2, "B");
    }

    function test_PayIn_AnyoneMayPay_PayerInEvent() public {
        usdc.mint(stranger, 260_000);
        vm.startPrank(stranger);
        usdc.approve(address(sc), 260_000);
        vm.expectEmit(true, true, false, true, address(sc));
        emit SolarCredits.NeighborPaid(P1, "C", stranger, 20_000, 260_000);
        sc.payIn(P1, "C");
        vm.stopPrank();
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_PayIn_InsufficientFundsReverts() public {
        usdc.mint(funder, 259_999);
        vm.startPrank(funder);
        usdc.approve(address(sc), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, funder, 259_999, 260_000));
        sc.payIn(P1, "C");
        vm.stopPrank();
        (,,, bool paid,) = sc.flatInfo(P1, "C");
        assertFalse(paid);
    }

    function test_PayIn_MaxValuesNoOverflow() public {
        _post(P2, _s("S", "B"), _n(1, 0), _n(0, 1e12), 1_000_000);
        _payIn(P2, "B", funder, 1e18);
        assertEq(_totalIn(P2), 1e18);
    }

    // ======================= claim =======================
    function test_PawanNumbers() public {
        _payIn(P1, "C", funder, 260_000);
        _fund(P1, funder, 140_000);
        assertEq(_totalIn(P1), 400_000);
        assertEq(sc.claimable(P1, "A"), 300_000);
        assertEq(sc.claimable(P1, "B"), 100_000);
        _claim(P1, "A");
        _claim(P1, "B");
        assertEq(usdc.balanceOf(alice), 300_000);
        assertEq(usdc.balanceOf(bob), 100_000);
        assertEq(usdc.balanceOf(address(sc)), 0);
        assertEq(usdc.balanceOf(alice), 3 * usdc.balanceOf(bob));
        // buyer flat C has unused 0 -> nothing to claim
        assertEq(sc.claimable(P1, "C"), 0);
        vm.expectRevert(SolarCredits.NothingToClaim.selector);
        sc.claim(P1, "C");
    }

    function test_Claim_PaysRegisteredWalletNotCaller_AndEvent() public {
        _fund(P1, funder, 4_000);
        vm.expectEmit(true, true, false, true, address(sc));
        emit SolarCredits.CreditClaimed(P1, "A", alice, 3_000);
        vm.prank(stranger);
        sc.claim(P1, "A");
        assertEq(usdc.balanceOf(alice), 3_000);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(_flatClaimed(P1, "A"), 3_000);
        assertEq(_totalClaimed(P1), 3_000);
        assertEq(usdc.balanceOf(address(sc)), 1_000);
    }

    function test_Claim_UnregisteredWalletReverts() public {
        _post(P2, _s("U"), _n(10), _n(0), 0);
        _fund(P2, funder, 100);
        vm.expectRevert(SolarCredits.ZeroAddress.selector);
        sc.claim(P2, "U");
        assertEq(_flatClaimed(P2, "U"), 0);
        assertEq(sc.claimable(P2, "U"), 100);
        _reg("U", alice);
        sc.claim(P2, "U");
        assertEq(usdc.balanceOf(alice), 100);
    }

    function test_Claim_UnpostedReverts() public {
        vm.expectRevert(SolarCredits.NothingToClaim.selector);
        sc.claim(P2, "A");
    }

    function test_Claim_FlatNotInPeriodReverts() public {
        _fund(P1, funder, 100);
        _reg("Q", alice);
        vm.expectRevert(SolarCredits.NothingToClaim.selector);
        sc.claim(P1, "Q");
    }

    function test_Claim_NothingBeforeFundingReverts() public {
        vm.expectRevert(SolarCredits.NothingToClaim.selector);
        sc.claim(P1, "A");
    }

    function test_Claim_NothingAfterFullClaimReverts() public {
        _fund(P1, funder, 4_000);
        _claim(P1, "A");
        vm.expectRevert(SolarCredits.NothingToClaim.selector);
        sc.claim(P1, "A");
    }

    function test_Claim_RepeatedFundingPaysOnlyNewShare() public {
        _fund(P1, funder, 4_000);
        _claim(P1, "A");
        assertEq(usdc.balanceOf(alice), 3_000);
        _fund(P1, funder, 8_000);
        assertEq(sc.claimable(P1, "A"), 6_000);
        _claim(P1, "A");
        assertEq(usdc.balanceOf(alice), 9_000);
        assertEq(_flatClaimed(P1, "A"), 9_000);
        _claim(P1, "B");
        assertEq(usdc.balanceOf(bob), 3_000);
    }

    function test_Claim_LateClaimAfterReRegisterPaysNewWallet() public {
        _fund(P1, funder, 4_000);
        _reg("A", carol);
        _claim(P1, "A");
        assertEq(usdc.balanceOf(carol), 3_000);
        assertEq(usdc.balanceOf(alice), 0);
        // now re-register and fund more: the newest wallet gets the increment
        _reg("A", bob);
        _fund(P1, funder, 4_000);
        _claim(P1, "A");
        assertEq(usdc.balanceOf(bob), 3_000);
        assertEq(usdc.balanceOf(carol), 3_000);
    }

    function test_Claim_RoundingDust_HandComputed() public {
        // 3 equal sellers, 100 micro-USDC: each floor(100*1/3)=33, dust 1.
        _post(P2, _s("X", "Y", "Z"), _n(1, 1, 1), _n(0, 0, 0), 0);
        _reg("X", alice);
        _reg("Y", bob);
        _reg("Z", carol);
        _fund(P2, funder, 100);
        _claim(P2, "X");
        _claim(P2, "Y");
        _claim(P2, "Z");
        assertEq(usdc.balanceOf(alice), 33);
        assertEq(usdc.balanceOf(bob), 33);
        assertEq(usdc.balanceOf(carol), 33);
        assertEq(usdc.balanceOf(address(sc)), 1); // exact dust stays
        assertEq(_totalIn(P2) - _totalClaimed(P2), 1);
        vm.expectRevert(SolarCredits.NothingToClaim.selector);
        sc.claim(P2, "X");
    }

    function test_Claim_RoundingDust_UnevenWeights() public {
        // weights 1 and 2, 10 in: floor(10/3)=3 and floor(20/3)=6 -> dust 1
        _post(P2, _s("X", "Y"), _n(1, 2), _n(0, 0), 0);
        _reg("X", alice);
        _reg("Y", bob);
        _fund(P2, funder, 10);
        _claim(P2, "X");
        _claim(P2, "Y");
        assertEq(usdc.balanceOf(alice), 3);
        assertEq(usdc.balanceOf(bob), 6);
        assertEq(usdc.balanceOf(address(sc)), 1);
    }

    function test_Claim_DustCanBecomeClaimableWhenMoreFunded() public {
        _post(P2, _s("X", "Y", "Z"), _n(1, 1, 1), _n(0, 0, 0), 0);
        _reg("X", alice);
        _fund(P2, funder, 100);
        _claim(P2, "X");
        _fund(P2, funder, 2); // 102 total -> 34 each
        assertEq(sc.claimable(P2, "X"), 1);
    }

    function test_Claimable_MatchesClaimPayout() public {
        _payIn(P1, "C", funder, 260_000);
        _fund(P1, funder, 12_345);
        uint256 c = sc.claimable(P1, "A");
        uint256 before = usdc.balanceOf(alice);
        _claim(P1, "A");
        assertEq(usdc.balanceOf(alice) - before, c);
        assertEq(sc.claimable(P1, "A"), 0);
    }

    function test_Claimable_ZeroForUnpostedAndUnknown() public view {
        assertEq(sc.claimable(P2, "A"), 0);
        assertEq(sc.claimable(bytes32(0), ""), 0);
        assertEq(sc.claimable(P1, "unknown"), 0);
        assertEq(sc.claimable(P1, ""), 0);
        assertEq(sc.claimable(P1, "a-label-way-longer-than-sixteen-bytes"), 0);
    }

    function test_Claimable_ZeroPeriodTotalUnusedDoesNotRevert() public {
        _post(P2, _s("X", "Y"), _n(0, 0), _n(5, 0), 3);
        assertEq(sc.claimable(P2, "X"), 0);
        vm.expectRevert(SolarCredits.NothingToClaim.selector);
        sc.claim(P2, "X");
    }

    function test_Claim_BlockedWalletRevertsOthersStillClaim_ThenReRegister() public {
        _fund(P1, funder, 4_000);
        usdc.setBlocked(alice, true);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocked.selector, alice));
        sc.claim(P1, "A");
        // no credit consumed
        assertEq(_flatClaimed(P1, "A"), 0);
        assertEq(_totalClaimed(P1), 0);
        assertEq(sc.claimable(P1, "A"), 3_000);

        _claim(P1, "B"); // other flat unaffected
        assertEq(usdc.balanceOf(bob), 1_000);

        _reg("A", carol); // clean wallet
        _claim(P1, "A");
        assertEq(usdc.balanceOf(carol), 3_000);
        assertEq(_flatClaimed(P1, "A"), 3_000);
        assertEq(usdc.balanceOf(address(sc)), 0);
    }

    function test_Claim_SumNeverAboveTotalIn() public {
        _post(P2, _s("X", "Y", "Z"), _n(7, 11, 13), _n(0, 0, 0), 0);
        _reg("X", alice);
        _reg("Y", bob);
        _reg("Z", carol);
        _fund(P2, funder, 1_000_003);
        _claim(P2, "X");
        _claim(P2, "Y");
        _claim(P2, "Z");
        assertLe(_totalClaimed(P2), _totalIn(P2));
        assertLt(_totalIn(P2) - _totalClaimed(P2), 3);
        assertEq(usdc.balanceOf(address(sc)), _totalIn(P2) - _totalClaimed(P2));
    }

    // ======================= period isolation =======================
    function test_TwoPeriods_Independent() public {
        _postABC(P2);
        _fund(P1, funder, 4_000);
        assertEq(_totalIn(P2), 0);
        assertEq(sc.claimable(P2, "A"), 0);
        _fund(P2, funder, 400);
        _claim(P1, "A");
        assertEq(_flatClaimed(P2, "A"), 0);
        assertEq(sc.claimable(P2, "A"), 300);
        _payIn(P2, "C", funder, 260_000);
        (,,, bool paid1,) = sc.flatInfo(P1, "C");
        (,,, bool paid2,) = sc.flatInfo(P2, "C");
        assertFalse(paid1);
        assertTrue(paid2);
        assertEq(_totalIn(P1), 4_000);
    }

    function test_SameFlatManyPeriods() public {
        _reg("A", alice);
        uint256 expected;
        for (uint256 i = 1; i <= 6; i++) {
            bytes32 id = bytes32(i);
            _post(id, _s("A", "B"), _n(i, 1), _n(0, 0), 0);
            _fund(id, funder, 1_000 * i);
            expected += Math.mulDiv(1_000 * i, i, i + 1);
            _claim(id, "A");
        }
        assertEq(usdc.balanceOf(alice), expected);
        // same flat can pay in once per period
        for (uint256 i = 11; i <= 13; i++) {
            bytes32 id = bytes32(i);
            _post(id, _s("S", "A"), _n(1, 0), _n(0, 10), 2);
            _payIn(id, "A", funder, 20);
            assertEq(_totalIn(id), 20);
        }
    }
}
