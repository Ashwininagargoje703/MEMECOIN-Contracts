// scripts/deploy-uniswap.js
// Deploy UniswapV2Factory, WETH9 (local), and UniswapV2Router02 on your local Hardhat network

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deploying Uniswap mocks with account:", deployer.address);

  // 1️⃣ Deploy UniswapV2Factory from @uniswap/v2-core
  const Factory = await ethers.getContractFactory(
    "@uniswap/v2-core/contracts/UniswapV2Factory.sol:UniswapV2Factory"
  );
  const factory = await Factory.deploy(deployer.address);
  await factory.deployed();
  console.log("✅ Factory deployed at", factory.address);

  // 2️⃣ Deploy local WETH9
  // Make sure you have a file contracts/WETH9.sol in your project root with a standard WETH implementation
  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth   = await WETH9.deploy();
  await weth.deployed();
  console.log("✅ WETH9 deployed at", weth.address);

  // 3️⃣ Deploy UniswapV2Router02 from @uniswap/v2-periphery
  const Router = await ethers.getContractFactory(
    "@uniswap/v2-periphery/contracts/UniswapV2Router02.sol:UniswapV2Router02"
  );
  const router = await Router.deploy(factory.address, weth.address);
  await router.deployed();
  console.log("✅ Router02 deployed at", router.address);

  console.log("🎉 All UniswapV2 mocks deployed successfully");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });