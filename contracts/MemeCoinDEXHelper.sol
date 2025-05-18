// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniswapV2Factory {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
}
interface IUniswapV2Router02 {
    function WETH() external pure returns (address);
    function addLiquidityETH(
        address token,
        uint amountToken,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint, uint, uint);
    function removeLiquidityETH(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint, uint);
}

contract MemeCoinDEXHelper {
    using SafeERC20 for IERC20;

    address public immutable factory;
    address public dexFactory;
    address public dexRouter;

    event DexConfigured(address indexed factory_, address indexed router_);
    event LiquidityPairCreated(address indexed token, address indexed pair);
    event LiquidityAdded(
        address indexed token,
        uint256 amountToken,
        uint256 amountETH,
        uint256 liquidity
    );
    event LiquidityRemoved(
        address indexed token,
        uint256 liquidity,
        uint256 amountToken,
        uint256 amountETH
    );
    event DustSwept(address indexed token, address indexed to, uint256 amount);

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    constructor(address _factory) {
        require(_factory != address(0), "Zero factory");
        factory = _factory;
    }

    function setDexAddresses(
        address _dexFactory,
        address _dexRouter
    ) external onlyFactory {
        require(
            _dexFactory != address(0) && _dexRouter != address(0),
            "Invalid addresses"
        );
        dexFactory = _dexFactory;
        dexRouter = _dexRouter;
        emit DexConfigured(_dexFactory, _dexRouter);
    }

    function createLiquidityPair(
        address token
    ) external onlyFactory returns (address pair) {
        pair = IUniswapV2Factory(dexFactory).getPair(
            token,
            IUniswapV2Router02(dexRouter).WETH()
        );
        if (pair == address(0)) {
            pair = IUniswapV2Factory(dexFactory).createPair(
                token,
                IUniswapV2Router02(dexRouter).WETH()
            );
        }
        emit LiquidityPairCreated(token, pair);
    }

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
        IERC20(token).safeTransferFrom(factory, address(this), amountToken);
        IERC20(token).safeIncreaseAllowance(dexRouter, amountToken);
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

    function removeLiquidity(
        address token,
        uint256 liquidity
    )
        external
        onlyFactory
        returns (uint256 amountTokenReturned, uint256 amountETHReturned)
    {
        address weth = IUniswapV2Router02(dexRouter).WETH();
        address pair = IUniswapV2Factory(dexFactory).getPair(token, weth);
        require(pair != address(0), "Pair does not exist");
        IERC20(pair).safeTransferFrom(factory, address(this), liquidity);
        IERC20(pair).safeIncreaseAllowance(dexRouter, liquidity);
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

    /// @notice Recover any ETH or ERC20 dust sent here back to `to`
    function sweepDust(address token, address to) external onlyFactory {
        require(to != address(0), "Zero recipient");
        uint256 amt;
        if (token == address(0)) {
            amt = address(this).balance;
            if (amt > 0) {
                payable(to).transfer(amt);
            }
        } else {
            amt = IERC20(token).balanceOf(address(this));
            if (amt > 0) IERC20(token).safeTransfer(to, amt);
        }
        emit DustSwept(token, to, amt);
    }

    /// @dev Allow contract to receive ETH for dust
    receive() external payable {}
    fallback() external payable {}
}
