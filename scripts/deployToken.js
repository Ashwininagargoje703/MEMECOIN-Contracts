// scripts/deployToken.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Token with address:", deployer.address);

  // Token constructor args
  const name          = "My Meme Token";
  const symbol        = "MMT";
  const initialSupply = ethers.utils.parseUnits("10000", 18); // 10 000 × 10⁻¹⁸
  const owner         = deployer.address;
  const ipfsHash      = "Qma2PvX7nwEh76iovJvF6P5RNQDGfkW8bpWC2VMvDMpPYh";

  // 1) Deploy
  const Token = await ethers.getContractFactory("MemeCoin");
  const token = await Token.deploy(
    name,
    symbol,
    initialSupply,
    owner,
    ipfsHash
  );
  await token.deployed();
  console.log("MemeCoin deployed to:", token.address);

  // 2) Auto-verify (skip on localhost)
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("Verifying on Etherscan…");
    try {
      await run("verify:verify", {
        address: token.address,
        constructorArguments: [
          name,
          symbol,
          initialSupply.toString(),
          owner,
          ipfsHash
        ],
      });
      console.log("✅ Token verified!");
    } catch (err) {
      console.warn("⚠️ Token verification failed:", err.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("❌ Deployment error:", error);
    process.exit(1);
  });
