// scripts/deploy-bridge.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const factoryAddress       = process.env.FACTORY_ADDRESS;
  const gasServiceAddress    = process.env.GAS_SERVICE_ADDRESS;
  const gatewayAddress       = process.env.GATEWAY_ADDRESS;

  if (!factoryAddress || !gasServiceAddress || !gatewayAddress) {
    console.error("❌ Please set in your .env:");
    console.error("   FACTORY_ADDRESS");
    console.error("   GAS_SERVICE_ADDRESS");
    console.error("   GATEWAY_ADDRESS");
    process.exit(1);
  }

  console.log(`\nDeploying BridgeAdapter on ${network.name}`);
  console.log("Factory:      ", factoryAddress);
  console.log("GasService:   ", gasServiceAddress);
  console.log("Gateway:      ", gatewayAddress, "\n");

  // 1) Deploy the BridgeAdapter module
  //    constructor(address gasService, address gateway)
  const Bridge = await ethers.getContractFactory("BridgeAdapter");
  const bridge = await Bridge.deploy(gasServiceAddress, gatewayAddress);
  await bridge.deployed();
  console.log(`→ BridgeAdapter deployed at: ${bridge.address}`);

  // 2) Register it in the factory
  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = Factory.attach(factoryAddress);
  await (await factory.setBridgeModule(bridge.address)).wait();
  console.log("→ Registered BridgeAdapter in factory");

  // 3) (Optional) Verify on Etherscan
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying BridgeAdapter on Etherscan…");
    try {
      await run("verify:verify", {
        address: bridge.address,
        constructorArguments: [gasServiceAddress, gatewayAddress],
      });
      console.log("✅ BridgeAdapter verified");
    } catch (err) {
      console.warn("⚠️ Verification failed:", err.message);
    }
  }

  console.log("\n✅ BridgeAdapter deployment complete!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

