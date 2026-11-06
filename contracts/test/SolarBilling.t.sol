// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SolarBilling} from "../src/SolarBilling.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract SolarBillingTest is Test {
    MockUSDC internal usdc;
    SolarBilling internal billing;

    address internal owner = makeAddr("owner");
    address internal oracle = makeAddr("oracle");
    address internal treasury = makeAddr("treasury");
    address internal grid = makeAddr("grid");
    address internal resident = makeAddr("resident");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant HASH = keccak256("readings");
    uint96 internal constant SOLAR = 12e6;
    uint96 internal constant GRID = 8e6;

    function setUp() public {
        usdc = new MockUSDC();
        billing = new SolarBilling(address(usdc), oracle, treasury, grid, owner);
        usdc.mint(resident, 1_000e6);
        usdc.mint(stranger, 1_000e6);
        vm.prank(resident);
        usdc.approve(address(billing), type(uint256).max);
        vm.prank(stranger);
        usdc.approve(address(billing), type(uint256).max);
    }

    // ------------------------------------------------------------- helpers
    function _post(string memory flat, string memory month, address res, uint96 s, uint96 g) internal returns (uint256 id) {
        vm.prank(oracle);
        id = billing.postBill(flat, month, res, s, g, 100, 50, HASH);
    }

    function _bill(uint256 id) internal view returns (SolarBilling.Bill memory b) {
        (b.flat, b.month, b.resident, b.amount,,,,,,,) = billing.bills(id);
        (,,,, b.solarWh, b.gridWh, b.readingsHash, b.paid, b.paidBy,,) = billing.bills(id);
        (,,,,,,,,, b.solarAmount, b.gridAmount) = billing.bills(id);
    }

    function _notOwner(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    function _str(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; ++i) b[i] = "a";
        return string(b);
    }

    // ---------------------------------------------------------------- ctor
    function test_Constructor_SetsStateAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit SolarBilling.OracleChanged(oracle);
        vm.expectEmit(false, false, false, true);
        emit SolarBilling.TreasuryChanged(treasury);
        vm.expectEmit(false, false, false, true);
        emit SolarBilling.GridPayeeChanged(grid);
        SolarBilling b = new SolarBilling(address(usdc), oracle, treasury, grid, owner);
        assertEq(address(b.usdc()), address(usdc));
        assertEq(b.oracle(), oracle);
        assertEq(b.treasury(), treasury);
        assertEq(b.gridPayee(), grid);
        assertEq(b.owner(), owner);
        assertEq(b.nextBillId(), 1);
    }

    function test_RevertWhen_Constructor_ZeroAddresses() public {
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        new SolarBilling(address(0), oracle, treasury, grid, owner);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        new SolarBilling(address(usdc), address(0), treasury, grid, owner);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        new SolarBilling(address(usdc), oracle, address(0), grid, owner);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        new SolarBilling(address(usdc), oracle, treasury, address(0), owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new SolarBilling(address(usdc), oracle, treasury, grid, address(0));
    }

    // ----------------------------------------------------------------- key
    function test_Key_MatchesEncodingAndIsCollisionSafe() public view {
        assertEq(billing.key("A1", "2025-01"), keccak256(abi.encode("A1", "2025-01")));
        assertTrue(billing.key("ab", "c") != billing.key("a", "bc"));
        assertTrue(billing.key("A1", "2025-01") != billing.key("A1", "2025-02"));
    }

    // ------------------------------------------------------------ postBill
    function test_PostBill_HappyPath() public {
        vm.expectEmit(true, false, false, true, address(billing));
        emit SolarBilling.BillPosted(1, "A1", "2025-01", resident, SOLAR + GRID, 100, 50, HASH);
        uint256 id = _post("A1", "2025-01", resident, SOLAR, GRID);

        assertEq(id, 1);
        assertEq(billing.nextBillId(), 2);
        assertEq(billing.billOf(billing.key("A1", "2025-01")), 1);
        SolarBilling.Bill memory b = _bill(1);
        assertEq(b.flat, "A1");
        assertEq(b.month, "2025-01");
        assertEq(b.resident, resident);
        assertEq(b.amount, SOLAR + GRID);
        assertEq(b.solarAmount, SOLAR);
        assertEq(b.gridAmount, GRID);
        assertEq(b.solarWh, 100);
        assertEq(b.gridWh, 50);
        assertEq(b.readingsHash, HASH);
        assertFalse(b.paid);
        assertEq(b.paidBy, address(0));
    }

    function test_PostBill_AmountIsSolarPlusGridAndIdsIncrement() public {
        assertEq(_post("A1", "m1", resident, 1, 2), 1);
        assertEq(_post("A1", "m2", resident, 3, 4), 2);
        assertEq(_post("B2", "m1", resident, 5, 6), 3);
        assertEq(_bill(1).amount, 3);
        assertEq(_bill(2).amount, 7);
        assertEq(_bill(3).amount, 11);
        assertEq(billing.billOf(billing.key("B2", "m1")), 3);
    }

    function test_RevertWhen_PostBill_NotOracle() public {
        vm.prank(owner);
        vm.expectRevert(SolarBilling.NotOracle.selector);
        billing.postBill("A1", "m", resident, 1, 1, 0, 0, HASH);
        vm.prank(stranger);
        vm.expectRevert(SolarBilling.NotOracle.selector);
        billing.postBill("A1", "m", resident, 1, 1, 0, 0, HASH);
    }

    function test_RevertWhen_PostBill_AlreadyPosted() public {
        _post("A1", "2025-01", resident, SOLAR, GRID);
        vm.prank(oracle);
        vm.expectRevert(SolarBilling.AlreadyPosted.selector);
        billing.postBill("A1", "2025-01", stranger, 1, 1, 0, 0, HASH);
        assertEq(billing.nextBillId(), 2);
        // different month / different flat is fine
        _post("A1", "2025-02", resident, 1, 1);
        _post("A2", "2025-01", resident, 1, 1);
    }

    function test_PostBill_ConcatenationAmbiguityIsNotACollision() public {
        _post("ab", "c", resident, 1, 1);
        _post("a", "bc", resident, 1, 1);
        assertEq(billing.nextBillId(), 3);
    }

    function test_RevertWhen_PostBill_BadFlat() public {
        vm.startPrank(oracle);
        vm.expectRevert(SolarBilling.BadLabel.selector);
        billing.postBill("", "m", resident, 1, 1, 0, 0, HASH);
        vm.expectRevert(SolarBilling.BadLabel.selector);
        billing.postBill(_str(17), "m", resident, 1, 1, 0, 0, HASH);
        // 16 bytes is accepted
        billing.postBill(_str(16), "m", resident, 1, 1, 0, 0, HASH);
        vm.stopPrank();
    }

    function test_RevertWhen_PostBill_BadMonth() public {
        vm.startPrank(oracle);
        vm.expectRevert(SolarBilling.BadLabel.selector);
        billing.postBill("A1", "", resident, 1, 1, 0, 0, HASH);
        vm.expectRevert(SolarBilling.BadLabel.selector);
        billing.postBill("A1", _str(17), resident, 1, 1, 0, 0, HASH);
        billing.postBill("A1", _str(16), resident, 1, 1, 0, 0, HASH);
        vm.stopPrank();
    }

    function test_PostBill_Uint96MaxSumOk_OverflowReverts() public {
        _post("A1", "m1", resident, type(uint96).max, 0);
        assertEq(_bill(1).amount, type(uint96).max);

        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, uint8(96), uint256(type(uint96).max) + 1));
        billing.postBill("A1", "m2", resident, type(uint96).max, 1, 0, 0, HASH);
        // failed post consumed neither an id nor the key
        assertEq(billing.nextBillId(), 2);
        assertEq(billing.billOf(billing.key("A1", "m2")), 0);

        vm.prank(oracle);
        vm.expectRevert();
        billing.postBill("A1", "m3", resident, type(uint96).max, type(uint96).max, 0, 0, HASH);
    }

    function testFuzz_PostBill_OverflowIffSumExceedsUint96(uint96 s, uint96 g) public {
        vm.prank(oracle);
        if (uint256(s) + uint256(g) > type(uint96).max) {
            vm.expectRevert();
            billing.postBill("A1", "m", resident, s, g, 0, 0, HASH);
        } else {
            uint256 id = billing.postBill("A1", "m", resident, s, g, 0, 0, HASH);
            assertEq(_bill(id).amount, uint256(s) + uint256(g));
        }
    }

    function test_PostBill_ZeroTotalAllowed_PayableWithoutTransfers() public {
        uint256 id = _post("A1", "m", resident, 0, 0);
        assertEq(_bill(id).amount, 0);

        // a payer with no balance and no allowance can pay: no transfers happen
        address broke = makeAddr("broke");
        vm.prank(oracle);
        uint256 open = billing.postBill("A2", "m", address(0), 0, 0, 0, 0, HASH);
        uint256 tBefore = usdc.balanceOf(treasury);
        uint256 gBefore = usdc.balanceOf(grid);

        vm.expectEmit(true, true, false, true, address(billing));
        emit SolarBilling.BillPaid(open, broke, 0, 0, 0);
        vm.prank(broke);
        billing.pay(open);
        assertTrue(_bill(open).paid);
        assertEq(_bill(open).paidBy, broke);
        assertEq(usdc.balanceOf(treasury), tBefore);
        assertEq(usdc.balanceOf(grid), gBefore);

        vm.prank(resident);
        billing.pay(id);
        assertTrue(_bill(id).paid);
    }

    // ----------------------------------------------------------------- pay
    function test_Pay_SplitsSolarToTreasuryAndGridToGridPayee() public {
        uint256 id = _post("A1", "m", resident, SOLAR, GRID);
        uint256 rBefore = usdc.balanceOf(resident);

        vm.expectEmit(true, true, false, true, address(billing));
        emit SolarBilling.BillPaid(id, resident, SOLAR + GRID, SOLAR, GRID);
        vm.prank(resident);
        billing.pay(id);

        assertEq(usdc.balanceOf(treasury), SOLAR);
        assertEq(usdc.balanceOf(grid), GRID);
        assertEq(usdc.balanceOf(resident), rBefore - SOLAR - GRID);
        assertEq(usdc.balanceOf(address(billing)), 0);
        SolarBilling.Bill memory b = _bill(id);
        assertTrue(b.paid);
        assertEq(b.paidBy, resident);
    }

    function test_Pay_SolarOnlyAndGridOnly() public {
        uint256 a = _post("A1", "m", resident, SOLAR, 0);
        uint256 b = _post("A2", "m", resident, 0, GRID);
        vm.startPrank(resident);
        billing.pay(a);
        assertEq(usdc.balanceOf(treasury), SOLAR);
        assertEq(usdc.balanceOf(grid), 0);
        billing.pay(b);
        vm.stopPrank();
        assertEq(usdc.balanceOf(treasury), SOLAR);
        assertEq(usdc.balanceOf(grid), GRID);
    }

    function test_RevertWhen_Pay_WrongResident() public {
        uint256 id = _post("A1", "m", resident, SOLAR, GRID);
        vm.prank(stranger);
        vm.expectRevert(SolarBilling.NotResident.selector);
        billing.pay(id);
        vm.prank(owner);
        vm.expectRevert(SolarBilling.NotResident.selector);
        billing.pay(id);
        assertFalse(_bill(id).paid);
    }

    function test_Pay_ZeroResidentAnyonePays() public {
        uint256 id = _post("A1", "m", address(0), SOLAR, GRID);
        uint256 sBefore = usdc.balanceOf(stranger);
        vm.prank(stranger);
        billing.pay(id);
        assertEq(_bill(id).paidBy, stranger);
        assertEq(usdc.balanceOf(stranger), sBefore - SOLAR - GRID);
        assertEq(usdc.balanceOf(treasury), SOLAR);
        assertEq(usdc.balanceOf(grid), GRID);
    }

    function test_RevertWhen_Pay_Twice() public {
        uint256 id = _post("A1", "m", resident, SOLAR, GRID);
        vm.prank(resident);
        billing.pay(id);
        vm.prank(resident);
        vm.expectRevert(SolarBilling.AlreadyPaid.selector);
        billing.pay(id);
        vm.prank(stranger);
        vm.expectRevert(SolarBilling.AlreadyPaid.selector);
        billing.pay(id);
        assertEq(usdc.balanceOf(treasury), SOLAR);
    }

    function test_RevertWhen_Pay_NoBill() public {
        vm.prank(resident);
        vm.expectRevert(SolarBilling.NoBill.selector);
        billing.pay(0);
        uint256 next = billing.nextBillId(); // 1 on a fresh contract
        vm.prank(resident);
        vm.expectRevert(SolarBilling.NoBill.selector);
        billing.pay(next);

        _post("A1", "m", resident, 1, 1);
        next = billing.nextBillId(); // 2
        vm.prank(resident);
        vm.expectRevert(SolarBilling.NoBill.selector);
        billing.pay(next);
        vm.prank(resident);
        vm.expectRevert(SolarBilling.NoBill.selector);
        billing.pay(type(uint256).max);
    }

    function test_RevertWhen_Pay_InsufficientAllowance() public {
        address spender = makeAddr("lowAllowance");
        usdc.mint(spender, 1_000e6);
        uint256 id = _post("A1", "m", address(0), SOLAR, GRID);
        vm.startPrank(spender);
        usdc.approve(address(billing), SOLAR - 1);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(billing), SOLAR - 1, SOLAR));
        billing.pay(id);
        // enough for solar leg but not for grid: the whole payment reverts atomically
        usdc.approve(address(billing), SOLAR);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(billing), 0, GRID));
        billing.pay(id);
        vm.stopPrank();
        assertFalse(_bill(id).paid);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(usdc.balanceOf(grid), 0);
    }

    function test_RevertWhen_Pay_InsufficientBalance() public {
        address poor = makeAddr("poor");
        usdc.mint(poor, 1e6);
        vm.prank(poor);
        usdc.approve(address(billing), type(uint256).max);
        uint256 id = _post("A1", "m", address(0), SOLAR, GRID);
        vm.prank(poor);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 1e6, SOLAR));
        billing.pay(id);
        assertFalse(_bill(id).paid);
    }

    function test_RevertWhen_Pay_GridPayeeBlocked_AtomicRevert() public {
        uint256 id = _post("A1", "m", resident, SOLAR, GRID);
        usdc.setBlocked(grid, true);
        vm.prank(resident);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocked.selector, grid));
        billing.pay(id);
        assertFalse(_bill(id).paid);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function testFuzz_Pay_Split(uint96 s, uint96 g) public {
        s = uint96(bound(s, 0, 100_000e6));
        g = uint96(bound(g, 0, 100_000e6));
        usdc.mint(resident, uint256(s) + g);
        uint256 id = _post("F1", "m", resident, s, g);
        uint256 rBefore = usdc.balanceOf(resident);
        vm.prank(resident);
        billing.pay(id);
        assertEq(usdc.balanceOf(treasury), s);
        assertEq(usdc.balanceOf(grid), g);
        assertEq(usdc.balanceOf(resident), rBefore - s - g);
        assertEq(usdc.balanceOf(address(billing)), 0);
    }

    // ---------------------------------------------------------- admin
    function test_SplitFollowsCurrentGridPayeeAndTreasuryAtPayTime() public {
        uint256 id = _post("A1", "m", resident, SOLAR, GRID);
        address newGrid = makeAddr("newGrid");
        address newTreasury = makeAddr("newTreasury");
        vm.startPrank(owner);
        billing.setGridPayee(newGrid);
        billing.setTreasury(newTreasury);
        vm.stopPrank();

        vm.prank(resident);
        billing.pay(id);
        assertEq(usdc.balanceOf(newGrid), GRID);
        assertEq(usdc.balanceOf(newTreasury), SOLAR);
        assertEq(usdc.balanceOf(grid), 0);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_SetGridPayee_OwnerOnly() public {
        address n = makeAddr("n");
        vm.expectEmit(false, false, false, true, address(billing));
        emit SolarBilling.GridPayeeChanged(n);
        vm.prank(owner);
        billing.setGridPayee(n);
        assertEq(billing.gridPayee(), n);
        vm.prank(oracle);
        vm.expectRevert(_notOwner(oracle));
        billing.setGridPayee(n);
        vm.prank(owner);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        billing.setGridPayee(address(0));
    }

    function test_SetTreasury_OwnerOnly() public {
        address n = makeAddr("n");
        vm.expectEmit(false, false, false, true, address(billing));
        emit SolarBilling.TreasuryChanged(n);
        vm.prank(owner);
        billing.setTreasury(n);
        assertEq(billing.treasury(), n);
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        billing.setTreasury(n);
        vm.prank(owner);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        billing.setTreasury(address(0));
    }

    function test_SetOracle_OwnerOnly() public {
        address n = makeAddr("n");
        vm.expectEmit(false, false, false, true, address(billing));
        emit SolarBilling.OracleChanged(n);
        vm.prank(owner);
        billing.setOracle(n);
        assertEq(billing.oracle(), n);
        vm.prank(oracle);
        vm.expectRevert(SolarBilling.NotOracle.selector);
        billing.postBill("A1", "m", resident, 1, 1, 0, 0, HASH);
        vm.prank(n);
        billing.postBill("A1", "m", resident, 1, 1, 0, 0, HASH);
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        billing.setOracle(n);
        vm.prank(owner);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        billing.setOracle(address(0));
    }

    function test_Ownership_TwoStepAndRenounceDisabled() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        billing.transferOwnership(newOwner);
        assertEq(billing.owner(), owner);
        assertEq(billing.pendingOwner(), newOwner);
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        billing.acceptOwnership();
        vm.prank(newOwner);
        billing.acceptOwnership();
        assertEq(billing.owner(), newOwner);

        vm.prank(newOwner);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        billing.renounceOwnership();
        vm.prank(newOwner);
        vm.expectRevert(SolarBilling.ZeroAddress.selector);
        billing.transferOwnership(address(0));
        vm.prank(stranger);
        vm.expectRevert(_notOwner(stranger));
        billing.transferOwnership(stranger);
        assertEq(billing.owner(), newOwner);
    }
}
