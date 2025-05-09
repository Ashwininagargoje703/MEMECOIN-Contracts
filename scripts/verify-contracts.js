#!/usr/bin/env node

/**
 * Script to verify the MemeCoinFactory contract on Etherscan (Sepolia) using Hardhat.
 *
 * Usage:
 *   npx hardhat run scripts/verify-contracts.js --network sepolia
 *
 * Update the `address` field below with your deployed contract address.
 */

const hre = require("hardhat");

// Replace with your deployed MemeCoinFactory address:
const FACTORY_ADDRESS = "0xdb9719307A8a6c62EDCc4e11BAA08785a36c8C3C";

async function main() {
  console.log(`Verifying ${FACTORY_ADDRESS} (MemeCoinFactory)...`);
  try {
    await hre.run("verify:verify", {
      address: FACTORY_ADDRESS,
      contract: "contracts/MemeCoinFactory.sol:MemeCoinFactory",
      constructorArguments: [200, 100]
    });
    console.log(`✅ Successfully verified ${FACTORY_ADDRESS}`);
  } catch (error) {
    console.error(`❌ Failed to verify ${FACTORY_ADDRESS}:`, error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
