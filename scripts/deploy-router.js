// scripts/deploy-router.js
const { ethers } = require("hardhat");

async function main() {
  // 1) Deploy UniswapV2Factory from the npm package
  const Factory = await ethers.getContractFactory(
    "@uniswap/v2-core/contracts/UniswapV2Factory.sol:UniswapV2Factory"
  );
  const factory = await Factory.deploy((await ethers.getSigners())[0].address);
  await factory.deployed();
  console.log("Factory deployed to:", factory.address);

  // 2) Deploy WETH9 (used by the router)
  const WETH9 = await ethers.getContractFactory(
    "@uniswap/v2-periphery/contracts/WETH9.sol:WETH9"
  );
  const weth = await WETH9.deploy();
  await weth.deployed();
  console.log("WETH9 deployed to:", weth.address);

  // 3) Deploy UniswapV2Router02
  const Router = await ethers.getContractFactory(
    "@uniswap/v2-periphery/contracts/UniswapV2Router02.sol:UniswapV2Router02"
  );
  const router = await Router.deploy(factory.address, weth.address);
  await router.deployed();
  console.log("Router deployed to:", router.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
