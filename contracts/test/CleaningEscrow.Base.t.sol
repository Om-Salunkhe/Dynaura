// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CleaningEscrow} from "../src/CleaningEscrow.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @dev Shared fixture. Contains no test functions.
abstract contract CleaningEscrowBase is Test {
    MockUSDC internal usdc;
    CleaningEscrow internal escrow;

    address internal owner = makeAddr("owner");
    address internal oracle = makeAddr("oracle");
    address internal payer = makeAddr("payer");
    address internal cleaner = makeAddr("cleaner");
    address internal cleaner2 = makeAddr("cleaner2");
    address internal stranger = makeAddr("stranger");

    uint96 internal constant FEE = 50e6;
    uint64 internal constant DURATION = 1 days;
    bytes32 internal constant PROOF = keccak256("meter-proof");
    bytes32 internal constant ROOT = keccak256("0g-root");

    function setUp() public virtual {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
        escrow = new CleaningEscrow(address(usdc), oracle, owner);
        usdc.mint(payer, 1_000_000e6);
        vm.prank(payer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _job(uint256 id) internal view returns (CleaningEscrow.Job memory j) {
        (j.payer, j.cleaner, j.fee, j.deadline, j.outputBefore,,,,,) = escrow.jobs(id);
        (,,,,, j.outputAfter, j.status, j.proof,,) = escrow.jobs(id);
        (,,,,,,,, j.ogStorageRoot, j.ogRequestId) = escrow.jobs(id);
    }

    function _status(uint256 id) internal view returns (CleaningEscrow.Status) {
        return _job(id).status;
    }

    function _deadline(uint256 id) internal view returns (uint256) {
        return _job(id).deadline;
    }

    function _open() internal returns (uint256 id) {
        uint64 dl = uint64(block.timestamp + DURATION);
        vm.prank(payer);
        id = escrow.openJob(FEE, dl, 40, "req-1");
    }

    function _openAccepted() internal returns (uint256 id) {
        id = _open();
        vm.prank(cleaner);
        escrow.accept(id);
    }

    function _openDisputed() internal returns (uint256 id) {
        id = _openAccepted();
        vm.prank(cleaner);
        escrow.dispute(id, "panel still dirty");
    }

    function _release(uint256 id, uint16 pct) internal {
        vm.prank(oracle);
        escrow.release(id, pct, PROOF);
    }

    function _notOwner(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    function _str(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; ++i) b[i] = "a";
        return string(b);
    }
}
