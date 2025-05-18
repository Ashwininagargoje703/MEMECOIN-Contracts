// scripts/deploy-airdrop.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const factoryAddress = process.env.FACTORY_ADDRESS;
  // Use provided MERKLE_ROOT or default to zero
  const merkleRoot = process.env.MERKLE_ROOT || ethers.constants.HashZero;

  if (!factoryAddress) {
    console.error("❌ Please set FACTORY_ADDRESS in your .env");
    process.exit(1);
  }

  console.log(`\nDeploying AirdropMerkle on ${network.name}`);
  console.log("Factory:   ", factoryAddress);
  console.log("MerkleRoot:", merkleRoot, "\n");

  // 1) Deploy the AirdropMerkle module
  //    constructor(address factory, bytes32 initialRoot)
  const Airdrop = await ethers.getContractFactory("AirdropMerkle");
  const airdrop = await Airdrop.deploy(factoryAddress, merkleRoot);
  await airdrop.deployed();
  console.log(`→ AirdropMerkle deployed at: ${airdrop.address}`);

  // 2) Register it in the factory
  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = Factory.attach(factoryAddress);
  await (await factory.setAirdropModule(airdrop.address)).wait();
  console.log("→ Registered AirdropMerkle in factory");

  // 3) (Optional) Verify on Etherscan
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying AirdropMerkle on Etherscan…");
    try {
      await run("verify:verify", {
        address: airdrop.address,
        constructorArguments: [factoryAddress, merkleRoot],
      });
      console.log("✅ AirdropMerkle verified");
    } catch (err) {
      console.warn("⚠️ Verification failed:", err.message);
    }
  }

  console.log("\n✅ AirdropMerkle deployment complete!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
