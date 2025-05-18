// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title Governance Token for Launchpad Proposals
contract GovernanceToken is ERC20, ERC20Permit {
    /// @param initialSupply Total supply minted at deploy (18 decimals)
    constructor(uint256 initialSupply) ERC20("LaunchpadGov", "LPG") ERC20Permit("LaunchpadGov") {
        _mint(msg.sender, initialSupply);
    }
}
