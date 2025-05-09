// scripts/deploy-dex-helper.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const factoryAddress = process.env.FACTORY_ADDRESS;
  if (!factoryAddress) {
    console.error("❌ Please set FACTORY_ADDRESS in your .env");
    process.exit(1);
  }

  console.log(`\nDeploying MemeCoinDEXHelper on ${network.name}`);
  console.log("Factory is:", factoryAddress);

  const Helper = await ethers.getContractFactory("MemeCoinDEXHelper");
  const helper = await Helper.deploy(factoryAddress);
  await helper.deployed();
  console.log("✅ MemeCoinDEXHelper deployed at:", helper.address);

  // Auto‐verify on Etherscan (skip localhost)
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("🔍 Verifying helper on Etherscan…");
    try {
      await run("verify:verify", {
        address: helper.address,
        constructorArguments: [factoryAddress],
      });
      console.log("✅ Helper verified");
    } catch (err) {
      console.warn("⚠️ Helper verification failed:", err.message);
    }
  }

  console.log(`
  • Now call \`setDexHelper(${helper.address})\` on your factory:
      npx hardhat run scripts/set-dex-helper.js --network ${network.name}
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
