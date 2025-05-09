// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

/// @title   DEX Helper Module for MemeCoinFactory
/// @notice  Uniswap V2 helper functions extracted into a separate module to keep the factory bytecode under size limits
contract MemeCoinDEXHelper {
    using SafeERC20 for IERC20;

    /// @dev Address of the factory that is allowed to call these helpers
    address public factory;

    /// @dev Uniswap V2 Factory & Router addresses
    address public dexFactory;
    address public dexRouter;

    /// @dev Emitted when the Uniswap V2 addresses are configured
    event DexConfigured(address indexed factory_, address indexed router_);

    /// @dev Emitted when a new ETH–token pair is created
    event LiquidityPairCreated(address indexed token, address indexed pair);

    /// @dev Emitted when liquidity is added
    event LiquidityAdded(
        address indexed token,
        uint256 amountToken,
        uint256 amountETH,
        uint256 liquidity
    );

    /// @dev Emitted when liquidity is removed
    event LiquidityRemoved(
        address indexed token,
        uint256 liquidity,
        uint256 amountToken,
        uint256 amountETH
    );

    /// @dev Ensure that only the designated factory can call these methods
    modifier onlyFactory() {
        require(
            msg.sender == factory,
            "MemeCoinDEXHelper: caller is not factory"
        );
        _;
    }

    /// @param _factory The address of your MemeCoinFactory
    constructor(address _factory) {
        require(
            _factory != address(0),
            "MemeCoinDEXHelper: factory is zero address"
        );
        factory = _factory;
    }

    /// @notice Set the Uniswap V2 factory and router addresses
    /// @param _dexFactory The Uniswap V2 factory address
    /// @param _dexRouter  The Uniswap V2 router address
    function setDexAddresses(
        address _dexFactory,
        address _dexRouter
    ) external onlyFactory {
        require(
            _dexFactory != address(0) && _dexRouter != address(0),
            "MemeCoinDEXHelper: invalid address"
        );
        dexFactory = _dexFactory;
        dexRouter = _dexRouter;
        emit DexConfigured(_dexFactory, _dexRouter);
    }

    /// @notice Create (or fetch) the ETH–token pair contract
    /// @param token The ERC‑20 token address
    /// @return pair The address of the liquidity pair
    function createLiquidityPair(
        address token
    ) external onlyFactory returns (address pair) {
        IUniswapV2Factory fac = IUniswapV2Factory(dexFactory);
        address weth = IUniswapV2Router02(dexRouter).WETH();
        pair = fac.getPair(token, weth);
        if (pair == address(0)) {
            pair = fac.createPair(token, weth);
        }
        emit LiquidityPairCreated(token, pair);
    }

    /// @notice Add ETH + token liquidity; LP tokens are sent back to the factory caller
    /// @param token       The ERC‑20 token address
    /// @param amountToken The amount of token to deposit
    /// @return amountTokenAdded      Actual amount of token added
    /// @return amountETHAdded        Actual amount of ETH added
    /// @return liquidity            Amount of LP tokens minted
    function addLiquidity(
        address token,
        uint256 amountToken
    )
        external
        payable
        onlyFactory
        returns (
            uint256 amountTokenAdded,
            uint256 amountETHAdded,
            uint256 liquidity
        )
    {
        // Pull tokens from factory
        IERC20(token).safeTransferFrom(factory, address(this), amountToken);
        // Approve router
        IERC20(token).safeIncreaseAllowance(dexRouter, amountToken);

        // Add liquidity and send LP to factory
        (amountTokenAdded, amountETHAdded, liquidity) = IUniswapV2Router02(
            dexRouter
        ).addLiquidityETH{value: msg.value}(
            token,
            amountToken,
            0,
            0,
            factory,
            block.timestamp
        );

        emit LiquidityAdded(token, amountTokenAdded, amountETHAdded, liquidity);
    }

    /// @notice Remove ETH + token liquidity; underlying assets are sent back to the factory caller
    /// @param token     The ERC‑20 token address
    /// @param liquidity The amount of LP tokens to burn
    /// @return amountTokenReturned  Amount of token returned
    /// @return amountETHReturned    Amount of ETH returned
    function removeLiquidity(
        address token,
        uint256 liquidity
    )
        external
        onlyFactory
        returns (uint256 amountTokenReturned, uint256 amountETHReturned)
    {
        // Determine pair address
        address weth = IUniswapV2Router02(dexRouter).WETH();
        address pair = IUniswapV2Factory(dexFactory).getPair(token, weth);
        require(pair != address(0), "MemeCoinDEXHelper: pair does not exist");

        // Pull LP tokens from factory
        IERC20(pair).safeTransferFrom(factory, address(this), liquidity);
        // Approve router
        IERC20(pair).safeIncreaseAllowance(dexRouter, liquidity);

        // Remove liquidity and send assets back to factory
        (amountTokenReturned, amountETHReturned) = IUniswapV2Router02(dexRouter)
            .removeLiquidityETH(
                token,
                liquidity,
                0,
                0,
                factory,
                block.timestamp
            );

        emit LiquidityRemoved(
            token,
            liquidity,
            amountTokenReturned,
            amountETHReturned
        );
    }

    /// @notice Fallback to reject accidental ETH transfers
    receive() external payable {
        revert("MemeCoinDEXHelper: use addLiquidity");
    }

    fallback() external payable {
        revert("MemeCoinDEXHelper: use addLiquidity");
    }
}
