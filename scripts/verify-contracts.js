// scripts/verify-contracts.js
require("dotenv").config();
const hre = require("hardhat");

async function main() {
  // Load addresses from .env
  const vestingAddr   = process.env.VESTING_MANAGER_ADDRESS;
  const dexHelperAddr = process.env.DEX_HELPER_ADDRESS;

  if (!vestingAddr || !dexHelperAddr) {
    throw new Error("Please set VESTING_MANAGER_ADDRESS and DEX_HELPER_ADDRESS in .env");
  }

  const { network, ethers } = hre;
  const provider = ethers.provider;

  console.log(`Verifying contracts on "${network.name}" network`);

  for (const [label, addr] of [
    ["Vesting Manager", vestingAddr],
    ["DEX Helper",      dexHelperAddr],
  ]) {
    const code = await provider.getCode(addr);
    if (code && code !== "0x") {
      console.log(`✅ ${label} at ${addr} is deployed (bytecode size ${ (code.length - 2) / 2 } bytes)`);
    } else {
      console.log(`❌ ${label} at ${addr} is NOT deployed`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
