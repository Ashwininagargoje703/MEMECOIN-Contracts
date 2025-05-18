// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Simple ERC20 that mints `initialSupply` to deployer
contract RewardToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("RewardToken", "RWD") {
        _mint(msg.sender, initialSupply);
    }
}
