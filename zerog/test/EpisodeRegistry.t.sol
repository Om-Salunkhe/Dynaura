// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

/// The few Foundry cheatcodes these tests use (no forge-std dependency).
interface Vm {
    function prank(address) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
}

contract EpisodeRegistryTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event Episode(uint256 indexed n, bytes32 indexed root, string chatId, bool ai);
    event DeviceChanged(address indexed device);

    address constant PI = address(0xB0B);
    address constant NEW_PI = address(0xCAFE);
    bytes32 constant ROOT_1 = keccak256("episode 1");
    bytes32 constant ROOT_2 = keccak256("episode 2");

    EpisodeRegistry reg;

    function setUp() public {
        reg = new EpisodeRegistry(PI);
    }

    function _eq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function test_setup() public view {
        require(reg.owner() == address(this), "owner");
        require(reg.device() == PI, "device");
        _eq(reg.count(), 0, "count");
    }

    function test_record_numbers_episodes_in_order() public {
        vm.expectEmit(true, true, false, true);
        emit Episode(1, ROOT_1, "chat-abc", true);
        vm.prank(PI);
        uint256 n1 = reg.record(ROOT_1, "chat-abc", true);

        vm.expectEmit(true, true, false, true);
        emit Episode(2, ROOT_2, "", false); // a no-AI safe stop: no chat ID, ai = false
        vm.prank(PI);
        uint256 n2 = reg.record(ROOT_2, "", false);

        _eq(n1, 1, "n1");
        _eq(n2, 2, "n2");
        _eq(reg.count(), 2, "count");
        _eq(reg.episodeOf(ROOT_1), 1, "episodeOf 1");
        _eq(reg.episodeOf(ROOT_2), 2, "episodeOf 2");
        _eq(reg.episodeOf(keccak256("never")), 0, "unknown root");
    }

    function test_only_device_records() public {
        vm.expectRevert(abi.encodeWithSelector(EpisodeRegistry.NotDevice.selector));
        reg.record(ROOT_1, "chat", true); // the owner is not the device
    }

    function test_rejects_empty_root() public {
        vm.prank(PI);
        vm.expectRevert(abi.encodeWithSelector(EpisodeRegistry.EmptyRoot.selector));
        reg.record(bytes32(0), "chat", true);
    }

    function test_same_root_only_once() public {
        vm.prank(PI);
        reg.record(ROOT_1, "chat", true);
        vm.prank(PI);
        vm.expectRevert(abi.encodeWithSelector(EpisodeRegistry.AlreadyRecorded.selector, uint256(1)));
        reg.record(ROOT_1, "chat", true);
    }

    function test_owner_moves_device() public {
        vm.expectEmit(true, false, false, false);
        emit DeviceChanged(NEW_PI);
        reg.setDevice(NEW_PI);
        require(reg.device() == NEW_PI, "device moved");

        vm.prank(PI); // the old Pi can no longer record
        vm.expectRevert(abi.encodeWithSelector(EpisodeRegistry.NotDevice.selector));
        reg.record(ROOT_1, "chat", true);

        vm.prank(NEW_PI);
        _eq(reg.record(ROOT_1, "chat", true), 1, "new device records");
    }

    function test_only_owner_moves_device() public {
        vm.prank(PI);
        vm.expectRevert(abi.encodeWithSelector(EpisodeRegistry.NotOwner.selector));
        reg.setDevice(NEW_PI);
    }

    function test_no_zero_device() public {
        vm.expectRevert(abi.encodeWithSelector(EpisodeRegistry.ZeroAddress.selector));
        reg.setDevice(address(0));
        vm.expectRevert(abi.encodeWithSelector(EpisodeRegistry.ZeroAddress.selector));
        new EpisodeRegistry(address(0));
    }
}
