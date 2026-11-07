// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SolarCredits} from "../src/SolarCredits.sol";
import {SolarCreditsTestBase} from "./SolarCredits.Base.t.sol";

contract SolarCreditsTest is SolarCreditsTestBase {
    // ======================= constructor & constants =======================
    function test_Constructor_State() public view {
        assertEq(address(sc.usdc()), address(usdc));
        assertEq(sc.oracle(), oracle);
        assertEq(sc.owner(), owner);
        assertEq(sc.pendingOwner(), address(0));
    }

    function test_Constructor_EmitsOracleChanged() public {
        vm.expectEmit(false, false, false, true);
        emit SolarCredits.OracleChanged(oracle);
        new SolarCredits(address(usdc), oracle, owner);
    }

    function test_Constructor_ZeroUsdcReverts() public {
        vm.expectRevert(SolarCredits.ZeroAddress.selector);
        new SolarCredits(address(0), oracle, owner);
    }

    function test_Constructor_ZeroOracleReverts() public {
        vm.expectRevert(SolarCredits.ZeroAddress.selector);
        new SolarCredits(address(usdc), address(0), owner);
    }

    function test_Constructor_ZeroOwnerReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new SolarCredits(address(usdc), oracle, address(0));
    }

    function test_Constants() public view {
        assertEq(sc.MAX_WH(), 1e12);
        assertEq(sc.MAX_RATE(), 1_000_000);
        assertEq(sc.MAX_FLATS(), 16);
        assertEq(sc.MAX_LABEL_BYTES(), 16);
    }

    // ======================= postPeriod: happy path =======================
    function test_PostPeriod_StoresEverything() public {
        string[] memory f = _s("Zed", "alpha", "Mid");
        uint256[] memory u = _n(500, 0, 250);
        uint256[] memory o = _n(0, 700, 0);
        _post(P1, f, u, o, 42);

        (bool posted, uint256 rate, bytes32 h, uint256 tu, uint256 tin, uint256 tcl) = sc.periodInfo(P1);
        assertTrue(posted);
        assertEq(rate, 42);
        assertEq(h, HASH);
        assertEq(tu, 750);
        assertEq(tin, 0);
        assertEq(tcl, 0);

        string[] memory got = sc.flatsOf(P1);
        assertEq(got.length, 3);
        assertEq(got[0], "Zed");
        assertEq(got[1], "alpha");
        assertEq(got[2], "Mid");

        for (uint256 i = 0; i < 3; i++) {
            _assertFlat(P1, f[i], u[i], o[i]);
        }
        (bool inX,,,,) = sc.flatInfo(P1, "zed"); // labels are case-sensitive
        assertFalse(inX);
    }

    function test_PostPeriod_EmitsPeriodPosted() public {
        string[] memory f = _s("A", "B", "C");
        uint256[] memory u = _n(30_000, 10_000, 0);
        uint256[] memory o = _n(0, 0, 20_000);
        vm.expectEmit(true, false, false, true, address(sc));
        emit SolarCredits.PeriodPosted(P1, f, u, o, 13, HASH);
        _post(P1, f, u, o, 13);
    }

    function test_PostPeriod_FlatWithBothZeroAllowed() public {
        _post(P1, _s("A", "B"), _n(0, 5), _n(0, 0), 1);
        (bool inP, uint256 u, uint256 o,,) = sc.flatInfo(P1, "A");
        assertTrue(inP);
        assertEq(u, 0);
        assertEq(o, 0);
    }

    function test_PostPeriod_TotalUnusedZeroAllowed() public {
        _post(P1, _s("A", "B"), _n(0, 0), _n(10, 0), 5);
        (bool posted,,, uint256 tu,,) = sc.periodInfo(P1);
        assertTrue(posted);
        assertEq(tu, 0);
    }

    function test_PostPeriod_Boundaries_Ok() public {
        _post(P1, _s("A", "B"), _n(sc.MAX_WH(), 0), _n(0, sc.MAX_WH()), sc.MAX_RATE());
        (, uint256 rate,, uint256 tu,,) = sc.periodInfo(P1);
        assertEq(rate, 1_000_000);
        assertEq(tu, 1e12);
        _post(P2, _s("A"), _n(1), _n(0), 0); // rate 0 ok
        (, uint256 rate2,,,,) = sc.periodInfo(P2);
        assertEq(rate2, 0);
    }

    function test_PostPeriod_SixteenFlatsOk_LabelSixteenBytesOk() public {
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _many(16);
        f[3] = "0123456789abcdef"; // exactly 16 bytes
        assertEq(bytes(f[3]).length, 16);
        _post(P1, f, u, o, 1);
        assertEq(sc.flatsOf(P1).length, 16);
        (bool inP,,,,) = sc.flatInfo(P1, "0123456789abcdef");
        assertTrue(inP);
    }

    function test_PostPeriod_SameFlatsAcrossPeriodsAllowed() public {
        _post(P1, _s("A"), _n(1), _n(0), 0);
        _post(P2, _s("A"), _n(2), _n(0), 0);
        (, uint256 u1,,,) = sc.flatInfo(P1, "A");
        (, uint256 u2,,,) = sc.flatInfo(P2, "A");
        assertEq(u1, 1);
        assertEq(u2, 2);
    }

    // ======================= postPeriod: access =======================
    function test_PostPeriod_OwnerCannot() public {
        vm.prank(owner);
        vm.expectRevert(SolarCredits.NotOracle.selector);
        sc.postPeriod(P1, _s("A"), _n(1), _n(0), 1, HASH);
    }

    function test_PostPeriod_StrangerCannot() public {
        vm.prank(stranger);
        vm.expectRevert(SolarCredits.NotOracle.selector);
        sc.postPeriod(P1, _s("A"), _n(1), _n(0), 1, HASH);
    }

    // ======================= postPeriod: reverts =======================
    function test_PostPeriod_ZeroPeriodIdReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadPeriodId.selector);
        sc.postPeriod(bytes32(0), _s("A"), _n(1), _n(0), 1, HASH);
    }

    function test_PostPeriod_AlreadyPostedReverts_StateUnchanged() public {
        _post(P1, _s("A", "B"), _n(10, 20), _n(0, 0), 7);
        _fund(P1, funder, 300);
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.AlreadyPosted.selector);
        sc.postPeriod(P1, _s("X"), _n(99), _n(0), 9, bytes32(uint256(1)));

        (, uint256 rate, bytes32 h, uint256 tu, uint256 tin,) = sc.periodInfo(P1);
        assertEq(rate, 7);
        assertEq(h, HASH);
        assertEq(tu, 30);
        assertEq(tin, 300);
        string[] memory got = sc.flatsOf(P1);
        assertEq(got.length, 2);
        assertEq(got[0], "A");
        (bool inX,,,,) = sc.flatInfo(P1, "X");
        assertFalse(inX);
    }

    function test_PostPeriod_EmptyFlatsReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadFlatCount.selector);
        sc.postPeriod(P1, new string[](0), new uint256[](0), new uint256[](0), 1, HASH);
    }

    function test_PostPeriod_SeventeenFlatsReverts() public {
        (string[] memory f, uint256[] memory u, uint256[] memory o) = _many(17);
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadFlatCount.selector);
        sc.postPeriod(P1, f, u, o, 1, HASH);
    }

    function test_PostPeriod_UnusedLengthMismatchReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.LengthMismatch.selector);
        sc.postPeriod(P1, _s("A", "B"), _n(1), _n(0, 0), 1, HASH);
    }

    function test_PostPeriod_OverLengthMismatchReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.LengthMismatch.selector);
        sc.postPeriod(P1, _s("A", "B"), _n(1, 1), _n(0), 1, HASH);
    }

    function test_PostPeriod_DuplicateFlatReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.DuplicateFlat.selector);
        sc.postPeriod(P1, _s("A", "B", "A"), _n(1, 1, 1), _n(0, 0, 0), 1, HASH);
    }

    function test_PostPeriod_EmptyLabelReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadLabel.selector);
        sc.postPeriod(P1, _s("A", ""), _n(1, 1), _n(0, 0), 1, HASH);
    }

    function test_PostPeriod_SeventeenByteLabelReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadLabel.selector);
        sc.postPeriod(P1, _s("0123456789abcdefg"), _n(1), _n(0), 1, HASH);
    }

    function test_PostPeriod_UnusedOverMaxReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadWh.selector);
        sc.postPeriod(P1, _s("A"), _n(1e12 + 1), _n(0), 1, HASH);
    }

    function test_PostPeriod_OverOverMaxReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadWh.selector);
        sc.postPeriod(P1, _s("A", "B"), _n(1, 0), _n(0, 1e12 + 1), 1, HASH);
    }

    function test_PostPeriod_RateOverMaxReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadRate.selector);
        sc.postPeriod(P1, _s("A"), _n(1), _n(0), 1_000_001, HASH);
    }

    function test_PostPeriod_BothUnusedAndOverReverts() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadWh.selector);
        sc.postPeriod(P1, _s("A", "B"), _n(1, 1), _n(0, 1), 1, HASH);
    }

    function test_PostPeriod_FailedPostDoesNotMarkPosted() public {
        vm.prank(oracle);
        vm.expectRevert(SolarCredits.BadWh.selector);
        sc.postPeriod(P1, _s("A", "B"), _n(1, 1), _n(0, 1), 1, HASH);
        (bool posted,,,,,) = sc.periodInfo(P1);
        assertFalse(posted);
        _post(P1, _s("A"), _n(1), _n(0), 1); // can still post correctly
    }

    // ======================= register =======================
    function test_Register_OwnerOnlyHappyAndEvent() public {
        assertEq(sc.walletOf("A"), address(0));
        vm.expectEmit(true, false, false, true, address(sc));
        emit SolarCredits.FlatRegistered("A", alice);
        _reg("A", alice);
        assertEq(sc.walletOf("A"), alice);
        assertEq(sc.walletOf("a"), address(0));
    }

    function test_Register_NonOwnerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        sc.register("A", alice);
        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, oracle));
        sc.register("A", alice);
    }

    function test_Register_ZeroWalletReverts() public {
        vm.prank(owner);
        vm.expectRevert(SolarCredits.ZeroAddress.selector);
        sc.register("A", address(0));
    }

    function test_Register_EmptyLabelReverts() public {
        vm.prank(owner);
        vm.expectRevert(SolarCredits.BadLabel.selector);
        sc.register("", alice);
    }

    function test_Register_LongLabelReverts() public {
        vm.prank(owner);
        vm.expectRevert(SolarCredits.BadLabel.selector);
        sc.register("0123456789abcdefg", alice);
        _reg("0123456789abcdef", alice); // 16 bytes ok
        assertEq(sc.walletOf("0123456789abcdef"), alice);
    }

    function test_Register_ReRegisterChangesWallet() public {
        _reg("A", alice);
        _reg("A", bob);
        assertEq(sc.walletOf("A"), bob);
    }

    // ======================= setOracle =======================
    function test_SetOracle_OwnerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        sc.setOracle(alice);
        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, oracle));
        sc.setOracle(alice);
    }

    function test_SetOracle_ZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(SolarCredits.ZeroAddress.selector);
        sc.setOracle(address(0));
    }

    function test_SetOracle_EmitsAndSwitches() public {
        vm.expectEmit(false, false, false, true, address(sc));
        emit SolarCredits.OracleChanged(alice);
        vm.prank(owner);
        sc.setOracle(alice);
        assertEq(sc.oracle(), alice);

        vm.prank(oracle); // old oracle
        vm.expectRevert(SolarCredits.NotOracle.selector);
        sc.postPeriod(P1, _s("A"), _n(1), _n(0), 1, HASH);

        vm.prank(alice); // new oracle
        sc.postPeriod(P1, _s("A"), _n(1), _n(0), 1, HASH);
        (bool posted,,,,,) = sc.periodInfo(P1);
        assertTrue(posted);
    }

    // ======================= Ownable2Step =======================
    function test_Ownership_TwoStepTransfer() public {
        vm.expectEmit(true, true, false, false, address(sc));
        emit Ownable2Step.OwnershipTransferStarted(owner, alice);
        vm.prank(owner);
        sc.transferOwnership(alice);
        assertEq(sc.owner(), owner);
        assertEq(sc.pendingOwner(), alice);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        sc.acceptOwnership();

        vm.expectEmit(true, true, false, false, address(sc));
        emit Ownable.OwnershipTransferred(owner, alice);
        vm.prank(alice);
        sc.acceptOwnership();
        assertEq(sc.owner(), alice);
        assertEq(sc.pendingOwner(), address(0));

        // old owner lost rights, new owner has them
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        sc.setOracle(bob);
        vm.prank(alice);
        sc.setOracle(bob);
        assertEq(sc.oracle(), bob);
    }

    function test_Ownership_TransferByNonOwnerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        sc.transferOwnership(alice);
    }

    function test_Ownership_TransferToZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(SolarCredits.ZeroAddress.selector);
        sc.transferOwnership(address(0));
        assertEq(sc.owner(), owner);
    }

    function test_Ownership_RenounceReverts() public {
        vm.prank(owner);
        vm.expectRevert(SolarCredits.ZeroAddress.selector);
        sc.renounceOwnership();
        assertEq(sc.owner(), owner);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        sc.renounceOwnership();
    }

    // ======================= helpers =======================
    function _assertFlat(bytes32 id, string memory flat, uint256 u, uint256 o) internal view {
        (bool inP, uint256 uu, uint256 oo, bool paid, uint256 cl) = sc.flatInfo(id, flat);
        assertTrue(inP);
        assertEq(uu, u);
        assertEq(oo, o);
        assertFalse(paid);
        assertEq(cl, 0);
    }

    function _many(uint256 n) internal pure returns (string[] memory f, uint256[] memory u, uint256[] memory o) {
        f = new string[](n);
        u = new uint256[](n);
        o = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            f[i] = string.concat("F", vm.toString(i));
            u[i] = 1;
        }
    }
}
