// scripts/set-dex-helper.js
require("dotenv").config();
const { ethers, network } = require("hardhat");

async function main() {
  const factoryAddress = process.env.FACTORY_ADDRESS;
  const helperAddress  = process.env.HELPER_ADDRESS;
  if (!factoryAddress || !helperAddress) {
    console.error("❌ Please set FACTORY_ADDRESS and HELPER_ADDRESS in your .env");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`\nAttaching to factory ${factoryAddress} on ${network.name}`);
  const factory = await ethers.getContractAt("MemeCoinFactory", factoryAddress);

  const tx = await factory.setDexHelper(helperAddress);
  await tx.wait();
  console.log("✅ dexHelper set to:", helperAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
