// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

interface Vm {
    function envUint(string calldata) external view returns (uint256);
    function envOr(string calldata, address) external view returns (address);
    function addr(uint256) external pure returns (address);
    function startBroadcast(uint256) external;
    function stopBroadcast() external;
}

/// Deploys EpisodeRegistry. Reads the key from the environment, so it never appears on the command line.
///   ZG_DEPLOYER_PRIVATE_KEY  deployer (becomes the owner)
///   ZG_DEVICE_ADDRESS        the Pi's 0G wallet that may record (default: the deployer)
contract Deploy {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (EpisodeRegistry reg) {
        uint256 pk = vm.envUint("ZG_DEPLOYER_PRIVATE_KEY");
        address device = vm.envOr("ZG_DEVICE_ADDRESS", vm.addr(pk));
        vm.startBroadcast(pk);
        reg = new EpisodeRegistry(device);
        vm.stopBroadcast();
    }
}
