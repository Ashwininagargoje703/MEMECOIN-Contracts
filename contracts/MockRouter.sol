// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev A test‐only UniswapV2 router stub that lets you “swap” ETH→token
contract MockRouter {
    address public immutable WETH_ADDRESS;

    constructor(address weth_) {
        require(weth_ != address(0), "Zero WETH");
        WETH_ADDRESS = weth_;
    }

    /// @notice Return the WETH address
    function WETH() external view returns (address) {
        return WETH_ADDRESS;
    }

    /// @notice Pretend to swap ETH→token by transferring `msg.value * 100` tokens
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256,            // minTokensOut (ignored)
        address[] calldata path,
        address to,
        uint256             // deadline (ignored)
    ) external payable {
        require(msg.value > 0, "No ETH sent");
        IERC20 token = IERC20(path[path.length - 1]);
        // In tests make sure this router has enough token balance,
        // or that token itself is mintable and pre‐minted to this address.
        token.transfer(to, msg.value * 100);
    }
}
