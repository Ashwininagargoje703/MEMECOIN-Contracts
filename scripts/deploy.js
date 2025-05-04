require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(
    `Deploying on ${network.name} (chain ${network.config.chainId}) with`,
    deployer.address
  );

  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = await Factory.deploy(
    200,
    100,
    { gasPrice: ethers.utils.parseUnits("5", "gwei") }
  );

  console.log("⛓ Tx hash:", factory.deployTransaction.hash);

  // Wait for confirmations: only 1 on localhost, 5 elsewhere
  const confirmations = network.name === "localhost" ? 1 : 5;
  const receipt = await factory.deployTransaction.wait(confirmations);
  console.log(
    "✅ Deployed at:",
    factory.address,
    `| Gas used: ${receipt.gasUsed.toString()} (confirmations: ${confirmations})`
  );

  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("🔍 Verifying on Etherscan…");
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
  .catch((error) => {
    console.error("❌ Deployment error:", error);
    process.exit(1);
  });