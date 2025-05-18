// scripts/deploy-whitelist.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const factoryAddress = process.env.FACTORY_ADDRESS;
  if (!factoryAddress) {
    throw new Error("Please set FACTORY_ADDRESS in your .env");
  }

  console.log(
    `\nDeploying WhitelistPresale on ${network.name} with account ${deployer.address}`
  );
  console.log(
    `Account balance: ${ethers.utils.formatEther(
      await deployer.getBalance()
    )} ETH\n`
  );

  // 1) Deploy the module
  const Whitelist = await ethers.getContractFactory("WhitelistPresale");
  const whitelist = await Whitelist.deploy(factoryAddress);
  await whitelist.deployed();
  console.log(`→ WhitelistPresale deployed at: ${whitelist.address}`);

  // 2) Register it in the factory
  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = Factory.attach(factoryAddress);

  const tx = await factory.setWhitelistModule(whitelist.address);
  await tx.wait();
  console.log(`→ Registered whitelist module in factory`);

  // 3) (Optional) Verify on Etherscan
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying WhitelistPresale on Etherscan…");
    try {
      await run("verify:verify", {
        address: whitelist.address,
        constructorArguments: [factoryAddress],
      });
      console.log("✅ WhitelistPresale verified");
    } catch (e) {
      console.warn("⚠️ Verification failed:", e.message);
    }
  }

  console.log("\n✅ WhitelistPresale deployment complete!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
