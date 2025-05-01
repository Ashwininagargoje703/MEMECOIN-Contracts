// scripts/watch-and-verify.js
require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

const FACTORY_ADDRESS = "0xYourFactoryAddress"; // replace
const FACTORY_ABI = [
  "event TokenCreated(address indexed token,address indexed creator,uint256 priceWei,string ipfsHash)"
];

async function main() {
  // 1) Set up provider & signer (must have PRIVATE_KEY & RPC_URL in .env)
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // 2) Connect to factory
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);

  console.log("Listening for TokenCreated on", FACTORY_ADDRESS);

  // 3) On each TokenCreated, auto-verify
  factory.on("TokenCreated", async (tokenAddr, creator, priceWei, ipfsHash, event) => {
    console.log(`\n🔔 New token at ${tokenAddr}`);
    console.log("   creator:", creator);
    console.log("   priceWei:", priceWei.toString());
    console.log("   ipfsHash:", ipfsHash);

    try {
      console.log("🛠️  Verifying on Etherscan…");
      await hre.run("verify:verify", {
        address: tokenAddr,
        constructorArguments: [
          // Exactly match MemeCoin constructor args:
          event.args.name,      // Not emitted—replace with stored values if needed
          event.args.symbol,    // Or fetch from on-chain storage
          event.args.totalSupply,
          creator,
          ipfsHash
        ]
      });
      console.log("✅ Verified", tokenAddr);
    } catch (err) {
      console.warn("⚠️  Verification failed:", err.message.split("\n")[0]);
    }
  });

  // Keep the script alive
  process.stdin.resume();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
