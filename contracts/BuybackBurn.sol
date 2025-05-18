// contracts/BuybackBurn.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

/// @title Buyback & Burn Module
/// @notice Swaps incoming ETH for tokens on Uniswap V2 then burns them
contract BuybackBurn {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    IUniswapV2Router02 public immutable router;

    /// @dev use a common “dead” address so the transfer won’t revert
    address public constant BURN_ADDRESS = 
      0x000000000000000000000000000000000000dEaD;

    event BuybackAndBurn(uint256 ethSpent, uint256 tokensBurned);

    constructor(address token_, address router_) {
        require(token_  != address(0), "Zero token");
        require(router_ != address(0), "Zero router");
        token  = IERC20(token_);
        router = IUniswapV2Router02(router_);
    }

    receive() external payable {}

    /// @notice Swap all received ETH for `token` and burn the result
    /// @param minTokensOut Minimum acceptable output (to guard slippage)
    /// @param path         Swap path (e.g. [WETH, token])
    function buyAndBurn(uint256 minTokensOut, address[] calldata path) external payable {
        require(msg.value > 0, "No ETH sent");

        // swap ETH→token
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{ value: msg.value }(
            minTokensOut,
            path,
            address(this),
            block.timestamp
        );

        // burn by sending to DEAD address
        uint256 bal = token.balanceOf(address(this));
        require(bal > 0, "No tokens bought");
        token.safeTransfer(BURN_ADDRESS, bal);

        emit BuybackAndBurn(msg.value, bal);
    }
}
