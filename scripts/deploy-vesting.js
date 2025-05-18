// scripts/deploy-vesting.js
require("dotenv").config();
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeploying VestingManager on ${network.name} with account ${deployer.address}`);
  console.log(`Balance: ${ethers.utils.formatEther(await deployer.getBalance())} ETH`);

  const Vesting = await ethers.getContractFactory("MemeCoinVestingManager");
  const vesting = await Vesting.deploy();
  await vesting.deployed();

  console.log("✅ VestingManager deployed at:", vesting.address);
  console.log(`\n👉 Add this to your .env as VESTING_MANAGER_ADDRESS=${vesting.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
