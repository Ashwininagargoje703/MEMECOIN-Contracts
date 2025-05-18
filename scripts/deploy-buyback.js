// scripts/deploy-buyback.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const factoryAddress = process.env.FACTORY_ADDRESS;
  let routerAddress   = process.env.ROUTER_ADDRESS;

  if (!factoryAddress) {
    console.error("❌ Please set FACTORY_ADDRESS in your .env");
    process.exit(1);
  }
  if (!routerAddress) {
    console.warn("⚠️ ROUTER_ADDRESS not set; using AddressZero. Swaps will revert until you set a real router.");
    routerAddress = ethers.constants.AddressZero;
  }

  console.log(`\nDeploying BuybackBurn on ${network.name}`);
  console.log("Factory: ", factoryAddress);
  console.log("Router:  ", routerAddress, "\n");

  // constructor(address factory, address uniswapRouter)
  const Buyback = await ethers.getContractFactory("BuybackBurn");
  const buyback = await Buyback.deploy(factoryAddress, routerAddress);
  await buyback.deployed();
  console.log(`→ BuybackBurn deployed at: ${buyback.address}`);

  // register in factory
  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = Factory.attach(factoryAddress);
  await (await factory.setBuybackModule(buyback.address)).wait();
  console.log("→ Registered BuybackBurn in factory");

  // optional verify
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying BuybackBurn…");
    try {
      await run("verify:verify", {
        address: buyback.address,
        constructorArguments: [factoryAddress, routerAddress],
      });
      console.log("✅ BuybackBurn verified");
    } catch (e) {
      console.warn("⚠️ Verification failed:", e.message);
    }
  }

  console.log("\n✅ BuybackBurn deployment complete!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
