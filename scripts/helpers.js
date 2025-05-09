// scripts/helpers.js
require("dotenv").config();
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Network:  ${network.name}`);

  // 1) Attach to your factory
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
  if (!FACTORY_ADDRESS) throw new Error("Missing FACTORY_ADDRESS in .env");
  const factory = await ethers.getContractAt("MemeCoinFactory", FACTORY_ADDRESS);
  console.log("✅ Attached to MemeCoinFactory at", FACTORY_ADDRESS);

  // 2) Configure Uniswap V2 addresses via helper
  const UNISWAP_FACTORY = process.env.UNISWAP_FACTORY || "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const UNISWAP_ROUTER  = process.env.UNISWAP_ROUTER  || "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  console.log("⏳ Configuring DEX…");
  let tx = await factory.configureDex(UNISWAP_FACTORY, UNISWAP_ROUTER);
  await tx.wait();
  console.log("✅ DEX configured");

  // 3) If we're on localhost/hardhat, stop here
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("⚠️ Local network detected — skipping pair & liquidity steps.");
    return;
  }

  // 4) Create the ETH–token pair
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  if (!TOKEN_ADDRESS) throw new Error("Missing TOKEN_ADDRESS in .env");
  console.log("⏳ Creating pair for token", TOKEN_ADDRESS);
  tx = await factory.createPair(TOKEN_ADDRESS);
  await tx.wait();
  console.log("✅ Pair created");

  // 5) (Optional) Add liquidity
  if (process.env.AMOUNT_TOKEN && process.env.AMOUNT_ETH) {
    const AMOUNT_TOKEN = ethers.utils.parseUnits(process.env.AMOUNT_TOKEN, 18);
    const AMOUNT_ETH   = ethers.utils.parseEther(process.env.AMOUNT_ETH);
    console.log("⏳ Adding liquidity…");
    tx = await factory.addTokenLiquidity(TOKEN_ADDRESS, AMOUNT_TOKEN, { value: AMOUNT_ETH });
    await tx.wait();
    console.log("✅ Liquidity added");
  }

  // 6) (Optional) Remove liquidity
  if (process.env.LP_AMOUNT) {
    const LP_AMOUNT = ethers.utils.parseUnits(process.env.LP_AMOUNT, 18);
    console.log("⏳ Removing liquidity…");
    tx = await factory.removeTokenLiquidity(TOKEN_ADDRESS, LP_AMOUNT);
    await tx.wait();
    console.log("✅ Liquidity removed");
  }

  console.log("🎉 All done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
