// scripts/set-dex-helper.js
require("dotenv").config();
const { ethers, network } = require("hardhat");

async function main() {
  const [caller] = await ethers.getSigners();

  const factoryAddress = process.env.FACTORY_ADDRESS;
  const helperAddress  = process.env.DEX_HELPER_ADDRESS;
  if (!factoryAddress || !helperAddress) {
    console.error("❌ Please set FACTORY_ADDRESS and DEX_HELPER_ADDRESS in your .env");
    process.exit(1);
  }

  console.log(`\nSetting V3 helper on factory ${factoryAddress} → ${helperAddress}`);
  console.log(`Caller: ${caller.address} on ${network.name}\n`);

  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = Factory.attach(factoryAddress);

  const tx = await factory.setV3Helper(helperAddress);
  await tx.wait();
  console.log("✅ Dex helper set successfully!");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
