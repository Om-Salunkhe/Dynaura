// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

interface Vm {
    function envUint(string calldata) external view returns (uint256);
    function envAddress(string calldata) external view returns (address);
    function startBroadcast(uint256) external;
    function stopBroadcast() external;
}

/// Hands the recording role to the Pi's 0G wallet. Keys come from the environment:
///   ZG_DEPLOYER_PRIVATE_KEY  the owner
///   ZG_REGISTRY              the EpisodeRegistry address
///   ZG_DEVICE_ADDRESS        the Pi's 0G wallet (the address of its ZG_PRIVATE_KEY)
contract SetDevice {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        EpisodeRegistry reg = EpisodeRegistry(vm.envAddress("ZG_REGISTRY"));
        vm.startBroadcast(vm.envUint("ZG_DEPLOYER_PRIVATE_KEY"));
        reg.setDevice(vm.envAddress("ZG_DEVICE_ADDRESS"));
        vm.stopBroadcast();
    }
}
