// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title EpisodeRegistry
/// @notice The on-chain index of Dyna's decisions for one Dynaura building, on 0G Chain.
///
/// Every time Dyna decides something (a plan, a dust check, an answer, or a "no AI" safe stop),
/// the Pi writes an episode log to 0G Storage and records it here:
///   - root:   the 0G Storage root hash of the episode JSON (look it up on storagescan)
///   - chatId: the 0G Compute request ID (the Router's ZG-Res-Key) that made the decision,
///             empty when 0G could not be reached
///   - ai:     true if 0G made the decision, false for a no-AI safe stop (nothing was faked)
///
/// Only the building's Pi (the `device` wallet) can record. The owner can move that role to a
/// new Pi wallet. Episodes are numbered from 1 in the order they were recorded.
contract EpisodeRegistry {
    address public immutable owner;
    address public device;
    uint256 public count;

    /// @notice Episode number for a storage root (0 = not recorded). Lets anyone check a root
    /// from the explorer's "Read Contract" tab, and lets the Pi retry without double-recording.
    mapping(bytes32 => uint256) public episodeOf;

    event Episode(uint256 indexed n, bytes32 indexed root, string chatId, bool ai);
    event DeviceChanged(address indexed device);

    error NotDevice();
    error NotOwner();
    error ZeroAddress();
    error EmptyRoot();
    error AlreadyRecorded(uint256 n);

    constructor(address device_) {
        if (device_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        device = device_;
        emit DeviceChanged(device_);
    }

    /// @notice Record one episode. Called by the Pi right after the 0G Storage upload.
    function record(bytes32 root, string calldata chatId, bool ai) external returns (uint256 n) {
        if (msg.sender != device) revert NotDevice();
        if (root == bytes32(0)) revert EmptyRoot();
        if (episodeOf[root] != 0) revert AlreadyRecorded(episodeOf[root]);
        n = ++count;
        episodeOf[root] = n;
        emit Episode(n, root, chatId, ai);
    }

    /// @notice Hand the recording role to another wallet (a new Pi, or a rotated key).
    function setDevice(address device_) external {
        if (msg.sender != owner) revert NotOwner();
        if (device_ == address(0)) revert ZeroAddress();
        device = device_;
        emit DeviceChanged(device_);
    }
}
