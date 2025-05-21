// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUniswapV2Router02 {
    function factory() external pure returns (address);
    function WETH()    external pure returns (address);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint    amountADesired,
        uint    amountBDesired,
        uint    amountAMin,
        uint    amountBMin,
        address to,
        uint    deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint    liquidity,
        uint    amountAMin,
        uint    amountBMin,
        address to,
        uint    deadline
    ) external returns (uint amountA, uint amountB);

    // ← fee‐on‐transfer version needed by BuybackBurn
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint    amountOutMin,
        address[] calldata path,
        address to,
        uint    deadline
    ) external payable;
}
