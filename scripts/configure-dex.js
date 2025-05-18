// scripts/configure-dex.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const factoryAddress = process.env.FACTORY_ADDRESS;
  if (!factoryAddress) throw new Error("Set FACTORY_ADDRESS in your .env");

  const factory = await ethers.getContractAt("MemeCoinFactory", factoryAddress);
  await factory.configureDex(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // UniswapV2Factory
    "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"  // UniswapV2Router02
  );
  console.log("✅ DEX configured");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
