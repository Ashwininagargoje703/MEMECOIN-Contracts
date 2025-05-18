// scripts/deploy-staking.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const factoryAddress      = process.env.FACTORY_ADDRESS;
  const stakingTokenAddress = process.env.STAKING_TOKEN_ADDRESS;
  const rewardTokenAddress  = process.env.REWARD_TOKEN_ADDRESS;

  if (!factoryAddress || !stakingTokenAddress || !rewardTokenAddress) {
    console.error("❌ Please set in your .env:");
    console.error("   FACTORY_ADDRESS");
    console.error("   STAKING_TOKEN_ADDRESS");
    console.error("   REWARD_TOKEN_ADDRESS");
    process.exit(1);
  }

  console.log(`\nDeploying StakingRewards on ${network.name}`);
  console.log("Factory:      ", factoryAddress);
  console.log("Staking Token:", stakingTokenAddress);
  console.log("Reward Token: ", rewardTokenAddress, "\n");

  // Deploy the StakingRewards module
  // Constructor signature: (address factory, address stakingToken, address rewardToken)
  const Staking = await ethers.getContractFactory("StakingRewards");
  const staking = await Staking.deploy(
    factoryAddress,
    stakingTokenAddress,
    rewardTokenAddress
  );
  await staking.deployed();
  console.log(`→ StakingRewards deployed at: ${staking.address}`);

  // Register it in the factory
  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = Factory.attach(factoryAddress);

  const tx = await factory.setStakingModule(staking.address);
  await tx.wait();
  console.log("→ Registered StakingRewards module in factory");

  // Optional: verify on Etherscan
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying StakingRewards on Etherscan…");
    try {
      await run("verify:verify", {
        address: staking.address,
        constructorArguments: [
          factoryAddress,
          stakingTokenAddress,
          rewardTokenAddress,
        ],
      });
      console.log("✅ StakingRewards verified");
    } catch (err) {
      console.warn("⚠️ Verification failed:", err.message);
    }
  }

  console.log("\n✅ StakingRewards deployment complete!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
