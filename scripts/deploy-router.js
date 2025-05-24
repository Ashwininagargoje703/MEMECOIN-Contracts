const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying w/:", deployer.address);

  // WETH9
  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth  = await WETH9.deploy();
  await weth.deployed();
  console.log("WETH9:", weth.address);

  // UniswapV2Factory
  const UV2F = await ethers.getContractFactory(
    "@uniswap/v2-core/contracts/UniswapV2Factory.sol:UniswapV2Factory"
  );
  const uniFactory = await UV2F.deploy(deployer.address);
  await uniFactory.deployed();
  console.log("Factory:", uniFactory.address);

  // UniswapV2Router02
  const Router = await ethers.getContractFactory(
    "@uniswap/v2-periphery/contracts/UniswapV2Router02.sol:UniswapV2Router02"
  );
  const router = await Router.deploy(uniFactory.address, weth.address);
  await router.deployed();
  console.log("Router02:", router.address);

  console.log(`
👉 Add to your .env:
SEPOLIA_FACTORY=${uniFactory.address}
UNISWAP_V2_ROUTER=${router.address}
  `);
}

main().catch(console.error);
