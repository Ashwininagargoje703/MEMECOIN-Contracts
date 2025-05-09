// scripts/watch-and-verify.js
require("dotenv").config();
const hre = require("hardhat");
const { ethers, run } = hre;

async function main() {
  // 1) Ensure env vars
  if (!process.env.TESTNET_URL || !process.env.PRIVATE_KEY) {
    console.error("❌ TESTNET_URL and PRIVATE_KEY must be set in .env");
    process.exit(1);
  }
  if (!process.env.ETHERSCAN_API_KEY) {
    console.warn("⚠️ No ETHERSCAN_API_KEY in .env — verification will fail");
  }

  // 2) Setup provider + wallet
  const provider = new ethers.providers.JsonRpcProvider(process.env.TESTNET_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // 3) Attach to factory and listen for TokenCreated
  const factory = new ethers.Contract(
    process.env.FACTORY_ADDRESS,
    ["event TokenCreated(address indexed token, address indexed creator, uint256 priceWei, string description, string ipfsHash)"],
    wallet
  );
  console.log(`🔍 Watching TokenCreated on ${process.env.FACTORY_ADDRESS}`);

  factory.on("TokenCreated", async (tokenAddr, creator, priceWei, description, ipfsHash, event) => {
    console.log("\n🔔 TokenCreated detected:", tokenAddr);

    // 4) Wait for 10 confirmations + 30s delay
    const tx = await event.getTransaction();
    console.log("⏳ Waiting 10 confirmations…");
    await tx.wait(10);
    console.log("⏳ Waiting 30 s for Etherscan to index…");
    await new Promise(res => setTimeout(res, 30_000));

    // 5) Fetch the constructor args on‑chain
    const token = new ethers.Contract(
      tokenAddr,
      [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function totalSupply() view returns (uint256)"
      ],
      provider
    );
    const name        = await token.name();
    const symbol      = await token.symbol();
    const totalSupply = (await token.totalSupply()).toString();
    console.log("Constructor args:", { name, symbol, totalSupply, creator, ipfsHash });

    // 6) Run the hardhat‑etherscan verify task
    console.log("🛠️  Verifying on Etherscan…");
    try {
      await run("verify:verify", {
        address: tokenAddr,
        constructorArguments: [
          name,
          symbol,
          totalSupply,
          creator,
          ipfsHash
        ],
      });
      console.log("✅ Verified", tokenAddr);
    } catch (err) {
      console.error("⚠️ Verification failed:", err.message.split("\n")[0]);
    }
  });

  // 7) Keep the script alive
  process.stdin.resume();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
