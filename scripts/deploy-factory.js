// scripts/deploy-factory.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeploying MemeCoinFactory on ${network.name} with account ${deployer.address}`);

  // Read fee BPs from .env or fall back
  const platformFeeBP = Number(process.env.PLATFORM_FEE_BP || "200");  // 2%
  const referralFeeBP = Number(process.env.REFERRAL_FEE_BP || "100");  // 1%

  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = await Factory.deploy(platformFeeBP, referralFeeBP);
  await factory.deployed();
  console.log("✅ MemeCoinFactory deployed at:", factory.address);

  // Auto‐verify on Etherscan (skip localhost)
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("🔍 Verifying factory on Etherscan…");
    try {
      await run("verify:verify", {
        address: factory.address,
        constructorArguments: [platformFeeBP, referralFeeBP],
      });
      console.log("✅ Factory verified");
    } catch (err) {
      console.warn("⚠️ Factory verification failed:", err.message);
    }
  }

  // Print instructions
  console.log(`
  • Now set FACTORY_ADDRESS=${factory.address} in your .env
  • Run \`npx hardhat run scripts/deploy-dex-helper.js --network ${network.name}\`
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
