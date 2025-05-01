// scripts/deploy.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with address:", deployer.address);

  // 1) Deploy the factory
  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = await Factory.deploy(200 /* platformFeeBP */, 100 /* referralFeeBP */);
  await factory.deployed();
  console.log("MemeCoinFactory deployed to:", factory.address);

  // 2) Auto-verify on Etherscan (skip for localhost)
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("Verifying on Etherscan...");
    try {
      await run("verify:verify", {
        address: factory.address,
        constructorArguments: [200, 100],
      });
      console.log("✅ Verified!");
    } catch (err) {
      console.warn("⚠️ Verification failed:", err.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("❌ Deployment error:", error);
    process.exit(1);
  });
