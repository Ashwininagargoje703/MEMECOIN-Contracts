// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

/// @title Uniswap V3 Helper
/// @notice Wraps NonfungiblePositionManager to mint positions and collect fees
contract UniswapV3Helper {
    using SafeERC20 for IERC20;

    /// @notice Uniswap V3 position manager
    INonfungiblePositionManager public immutable positionManager;
    /// @notice Uniswap V3 factory (for reference if needed)
    IUniswapV3Factory        public immutable factory;

    /// @notice Emitted when a new position is minted
    event PositionMinted(
        uint256 indexed tokenId,
        address indexed token0,
        address indexed token1,
        uint24  fee,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );
    /// @notice Emitted when fees are collected from a position
    event FeesCollected(
        uint256 indexed tokenId,
        address indexed collector,
        uint256 amount0,
        uint256 amount1
    );

    /// @param positionManager_ Address of the NonfungiblePositionManager
    constructor(address positionManager_) {
        require(positionManager_ != address(0), "Zero manager address");
        positionManager = INonfungiblePositionManager(positionManager_);
        factory         = IUniswapV3Factory(positionManager.factory());
    }

    /// @notice Mint a new Uniswap V3 liquidity position
    function mintPosition(
        address token0,
        address token1,
        uint24  fee,
        int24   tickLower,
        int24   tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address recipient,
        uint256 deadline
    )
        external
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        // Transfer desired tokens from caller
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0Desired);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1Desired);
        // Approve position manager
        IERC20(token0).safeIncreaseAllowance(address(positionManager), amount0Desired);
        IERC20(token1).safeIncreaseAllowance(address(positionManager), amount1Desired);

        // Mint position
        (tokenId, liquidity, amount0, amount1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0:         token0,
                token1:         token1,
                fee:            fee,
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min:     amount0Min,
                amount1Min:     amount1Min,
                recipient:      recipient,
                deadline:       deadline
            })
        );

        // Refund any leftover tokens
        if (amount0 < amount0Desired) {
            IERC20(token0).safeTransfer(msg.sender, amount0Desired - amount0);
        }
        if (amount1 < amount1Desired) {
            IERC20(token1).safeTransfer(msg.sender, amount1Desired - amount1);
        }

        emit PositionMinted(tokenId, token0, token1, fee, liquidity, amount0, amount1);
    }

    /// @notice Collect all fees for a given position
    function collectFees(uint256 tokenId, address recipient)
        external
        returns (uint256 collected0, uint256 collected1)
    {
        // Collect fees to recipient
        positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    tokenId,
                recipient:  recipient,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // Ignore the first 10 return values, then grab the last two (tokensOwed0, tokensOwed1)
        (, , , , , , , , , , collected0, collected1) = positionManager.positions(tokenId);

        emit FeesCollected(tokenId, recipient, collected0, collected1);
    }
}
