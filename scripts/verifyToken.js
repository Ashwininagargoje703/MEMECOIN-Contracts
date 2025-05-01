// scripts/verifyToken.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  // 1) The address of your already-deployed token
  const tokenAddress = "0xCf6009BD34db551B45133117473616F56E57d2d8";

  // 2) Match exactly the constructor args you used
  const name           = "My Meme Token";
  const symbol         = "MMT";
  const initialSupply  = ethers.utils.parseUnits("10000", 18).toString();
  const owner          = process.env.DEPLOYER_ADDRESS || ""; 
  const ipfsHash       = "Qma2PvX7nwEh76iovJvF6P5RNQDGfkW8bpWC2VMvDMpPYh";

  if (network.name === "localhost" || !process.env.ETHERSCAN_API_KEY) {
    console.error("⛔️ Skipping verification (localhost or no API key).");
    return;
  }

  console.log(`Verifying token at ${tokenAddress} on ${network.name}…`);
  try {
    await run("verify:verify", {
      address: tokenAddress,
      constructorArguments: [
        name,
        symbol,
        initialSupply,
        owner,
        ipfsHash
      ],
    });
    console.log("✅ Token verified!");
  } catch (err) {
    console.error("⚠️ Verification failed:", err.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("❌ Error in verifyToken.js:", err);
    process.exit(1);
  });
