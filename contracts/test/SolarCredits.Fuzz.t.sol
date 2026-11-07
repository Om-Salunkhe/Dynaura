// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SolarCredits} from "../src/SolarCredits.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {SolarCreditsTestBase} from "./SolarCredits.Base.t.sol";

contract SolarCreditsFuzzTest is SolarCreditsTestBase {
    struct Out {
        uint256[] paid;
        uint256 totalIn;
        uint256 expectedIn;
        uint256 bal;
    }

    uint256 internal constant MAXWH = 1e12;

    // ---------- scenario generation ----------
    function _r(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(a, b, c)));
    }

    function _w(uint256 i) internal pure returns (address) {
        return address(uint160(0x10000 + i));
    }

    function _gen(uint256 seed, uint256 n)
        internal
        pure
        returns (string[] memory f, uint256[] memory u, uint256[] memory o)
    {
        f = new string[](n);
        u = new uint256[](n);
        o = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            f[i] = string.concat("F", vm.toString(i));
            uint256 kind = i == 0 ? 0 : _r(seed, i, 1) % 3;
            uint256 hi = _r(seed, i, 2) % 2 == 0 ? 100 : MAXWH;
            uint256 v = 1 + (_r(seed, i, 3) % hi);
            if (kind == 0) u[i] = v;
            else if (kind == 1) o[i] = v;
        }
    }

    function _tryClaim(string memory label, uint256 i) internal {
        uint256 c = sc.claimable(P1, label);
        if (c == 0) {
            vm.expectRevert(SolarCredits.NothingToClaim.selector);
            sc.claim(P1, label);
        } else {
            uint256 before = usdc.balanceOf(_w(i));
            sc.claim(P1, label);
            assertEq(usdc.balanceOf(_w(i)) - before, c, "claim != claimable");
        }
    }

    function _payRandom(string[] memory f, uint256[] memory o, uint256 ord, uint256 stage, bool all) internal {
        (, uint256 rate,,,,) = sc.periodInfo(P1);
        for (uint256 i = 0; i < f.length; i++) {
            if (o[i] == 0) continue;
            (,,, bool paid,) = sc.flatInfo(P1, f[i]);
            if (paid) continue;
            if (all || _r(ord, stage, i) % 2 == 0) _payIn(P1, f[i], funder, o[i] * rate);
        }
    }

    function _run(uint256 seed, uint256 n, uint256[3] memory amts, uint256 ord) internal returns (Out memory out) {
        usdc = new MockUSDC();
        sc = new SolarCredits(address(usdc), oracle, owner);
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _gen(seed, n);
        for (uint256 i = 0; i < n; i++) {
            _reg(f[i], _w(i));
        }
        uint256 rate = _rateOf(seed);
        _post(P1, f, u, o, rate);

        for (uint256 s = 0; s < 3; s++) {
            _fund(P1, funder, amts[s]);
            out.expectedIn += amts[s];
            _payRandom(f, o, ord, s, false);
            for (uint256 k = 0; k < n; k++) {
                uint256 i = _r(ord, s, k + 1000) % n;
                _tryClaim(f[i], i);
            }
        }
        _payRandom(f, o, ord, 9, true);
        for (uint256 i = 0; i < n; i++) {
            out.expectedIn += o[i] * rate;
        }
        for (uint256 i = 0; i < n; i++) {
            _tryClaim(f[i], i);
        }
        out.paid = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            out.paid[i] = usdc.balanceOf(_w(i));
            assertEq(out.paid[i], _flatClaimed(P1, f[i]), "wallet != claimed");
            assertEq(sc.claimable(P1, f[i]), 0, "claimable left");
        }
        out.totalIn = _totalIn(P1);
        out.bal = usdc.balanceOf(address(sc));
    }

    function _amts(uint96 a, uint96 b, uint96 c) internal pure returns (uint256[3] memory r) {
        r[0] = bound(a, 1, type(uint96).max);
        r[1] = bound(b, 1, type(uint96).max);
        r[2] = bound(c, 1, 1e9); // include small amounts so dust matters
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_RandomFlow_ExactEntitlements(uint256 seed, uint8 nRaw, uint96 a, uint96 b, uint96 c) public {
        uint256 n = bound(nRaw, 1, 16);
        Out memory out = _run(seed, n, _amts(a, b, c), seed);
        (, uint256[] memory u,) = _gen(seed, n);

        uint256 totalU;
        for (uint256 i = 0; i < n; i++) {
            totalU += u[i];
        }
        uint256 sumPaid;
        uint256 sellers;
        for (uint256 i = 0; i < n; i++) {
            assertEq(out.paid[i], Math.mulDiv(out.totalIn, u[i], totalU), "entitlement");
            sumPaid += out.paid[i];
            if (u[i] > 0) sellers++;
        }
        assertEq(out.totalIn, out.expectedIn, "totalIn");
        assertLe(sumPaid, out.totalIn, "paid > in");
        assertEq(out.bal, out.totalIn - sumPaid, "balance != in - paid");
        assertLt(out.totalIn - sumPaid, sellers, "dust >= sellers");
        assertLe(out.totalIn - sumPaid, n);
        assertEq(_totalClaimed(P1), sumPaid);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_OrderDoesNotChangeFinalAmounts(uint256 seed, uint8 nRaw, uint96 a, uint96 b, uint96 c, uint256 ordB)
        public
    {
        uint256 n = bound(nRaw, 1, 16);
        uint256[3] memory amts = _amts(a, b, c);
        Out memory o1 = _run(seed, n, amts, seed);
        Out memory o2 = _run(seed, n, amts, ordB);
        assertEq(o1.totalIn, o2.totalIn);
        assertEq(o1.bal, o2.bal);
        for (uint256 i = 0; i < n; i++) {
            assertEq(o1.paid[i], o2.paid[i], "order-dependent payout");
        }
        // Also: funding everything in one lump gives the same result as three separate fundings.
        uint256[] memory lump = _lump(seed, n, amts);
        for (uint256 i = 0; i < n; i++) {
            assertEq(lump[i], o1.paid[i], "lump != split");
        }
    }

    function _lump(uint256 seed, uint256 n, uint256[3] memory amts) internal returns (uint256[] memory paid) {
        usdc = new MockUSDC();
        sc = new SolarCredits(address(usdc), oracle, owner);
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _gen(seed, n);
        for (uint256 i = 0; i < n; i++) {
            _reg(f[i], _w(i));
        }
        _post(P1, f, u, o, _rateOf(seed));
        _fund(P1, funder, amts[0] + amts[1] + amts[2]);
        _payRandom(f, o, 0, 9, true);
        paid = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            if (sc.claimable(P1, f[i]) > 0) sc.claim(P1, f[i]);
            paid[i] = usdc.balanceOf(_w(i));
        }
    }

    function _rateOf(uint256 seed) internal pure returns (uint256) {
        return _r(seed, 0, 99) % 1_000_001;
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_PayIn_ExactAmount(uint256 over, uint256 rate) public {
        over = bound(over, 1, MAXWH);
        rate = bound(rate, 0, 1_000_000);
        _post(P1, _s("S", "B"), _n(1, 0), _n(0, over), rate);
        uint256 amount = over * rate;
        usdc.mint(funder, amount + 7);
        vm.startPrank(funder);
        usdc.approve(address(sc), type(uint256).max);
        vm.expectEmit(true, true, false, true, address(sc));
        emit SolarCredits.NeighborPaid(P1, "B", funder, over, amount);
        sc.payIn(P1, "B");
        vm.stopPrank();
        assertEq(usdc.balanceOf(funder), 7);
        assertEq(usdc.balanceOf(address(sc)), amount);
        assertEq(_totalIn(P1), amount);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_SingleSellerGetsEverything(uint128 amt, uint256 w) public {
        amt = uint128(bound(amt, 1, type(uint128).max));
        w = bound(w, 1, MAXWH);
        _post(P1, _s("S"), _n(w), _n(0), 0);
        _reg("S", alice);
        _fund(P1, funder, amt);
        _claim(P1, "S");
        assertEq(usdc.balanceOf(alice), amt);
        assertEq(usdc.balanceOf(address(sc)), 0);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_TwoSellers_Proportional(uint256 w1, uint256 w2, uint128 amt) public {
        w1 = bound(w1, 1, MAXWH);
        w2 = bound(w2, 1, MAXWH);
        amt = uint128(bound(amt, 1, type(uint128).max));
        _post(P1, _s("X", "Y"), _n(w1, w2), _n(0, 0), 0);
        _reg("X", alice);
        _reg("Y", bob);
        _fund(P1, funder, amt);
        if (sc.claimable(P1, "X") > 0) _claim(P1, "X");
        if (sc.claimable(P1, "Y") > 0) _claim(P1, "Y");
        assertEq(usdc.balanceOf(alice), Math.mulDiv(amt, w1, w1 + w2));
        assertEq(usdc.balanceOf(bob), Math.mulDiv(amt, w2, w1 + w2));
        assertLt(usdc.balanceOf(address(sc)), 2);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_Claimable_NeverReverts(bytes32 id, string calldata label) public view {
        assertEq(sc.claimable(id, label), 0);
        (bool posted,,,,,) = sc.periodInfo(id);
        assertFalse(posted);
        assertEq(sc.walletOf(label), address(0));
        assertEq(sc.flatsOf(id).length, 0);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_Post_RateAndWhBounds(uint256 unused, uint256 over, uint256 rate) public {
        vm.prank(oracle);
        try sc.postPeriod(P1, _s("A", "B"), _n(unused, 0), _n(0, over), rate, HASH) {
            assertLe(unused, MAXWH);
            assertLe(over, MAXWH);
            assertLe(rate, 1_000_000);
            (bool posted,,,,,) = sc.periodInfo(P1);
            assertTrue(posted);
        } catch (bytes memory err) {
            bool bad = unused > MAXWH || over > MAXWH || rate > 1_000_000;
            assertTrue(bad, "reverted on valid input");
            bytes4 sel = bytes4(err);
            if (rate > 1_000_000) assertEq(sel, SolarCredits.BadRate.selector);
            else assertEq(sel, SolarCredits.BadWh.selector);
        }
    }
}
