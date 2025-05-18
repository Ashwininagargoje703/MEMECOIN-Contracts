// scripts/deploy-uniswap.js
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying UniswapV2 mocks with:", deployer.address);

  // 1) Deploy the real UniswapV2Factory implementation
  const Factory = await ethers.getContractFactory(
    "@uniswap/v2-core/contracts/UniswapV2Factory.sol:UniswapV2Factory"
  );
  const factory = await Factory.deploy(deployer.address);
  await factory.deployed();
  console.log("UniswapV2Factory:", factory.address);

  // 2) Deploy WETH9 (the official Uniswap-periphery stub)
  const WETH9 = await ethers.getContractFactory(
    "@uniswap/v2-periphery/contracts/test/WETH9.sol:WETH9"
  );
  const weth = await WETH9.deploy();
  await weth.deployed();
  console.log("WETH9:", weth.address);

  // 3) Deploy the UniswapV2Router02
  const Router = await ethers.getContractFactory(
    "@uniswap/v2-periphery/contracts/UniswapV2Router02.sol:UniswapV2Router02"
  );
  const router = await Router.deploy(factory.address, weth.address);
  await router.deployed();
  console.log("UniswapV2Router02:", router.address);

  console.log(`
★ Add to your .env:
    FACTORY_ADDRESS=${process.env.FACTORY_ADDRESS}
    ROUTER_ADDRESS=${router.address}

Then rerun your buyback script:
  npx hardhat run scripts/deploy-buyback.js --network localhost
`);
}

main().catch(console.error);
