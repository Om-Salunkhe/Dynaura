// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST-ONLY 6-decimals USDC mock with free mint and a blocklist model.
/// @dev Transfers (transfer/transferFrom) between two nonzero accounts revert if the sender
///      or the recipient is blocked. Mint/burn are never blocked.
contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;

    error Blocked(address account);

    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (blocked[from]) revert Blocked(from);
            if (blocked[to]) revert Blocked(to);
        }
        super._update(from, to, value);
    }
}
