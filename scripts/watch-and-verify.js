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
    console.warn("⚠️ No ETHERSCAN_API_KEY in .env — verification will likely fail");
  }

  // 2) Setup provider + wallet (force Sepolia chainId)
  const provider = new ethers.providers.JsonRpcProvider(process.env.TESTNET_URL, {
    name: "sepolia",
    chainId: 11155111
  });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // 3) Attach minimal event interface to your factory
  const factory = new ethers.Contract(
    process.env.FACTORY_ADDRESS,
    [
      "event TokenCreated(address indexed token, address indexed creator, uint256 priceWei, string description, string ipfsHash)"
    ],
    wallet
  );
  console.log(`🔍 Watching TokenCreated on ${process.env.FACTORY_ADDRESS}`);

  factory.on("TokenCreated", async (tokenAddr, creator, priceWei, description, ipfsHash, event) => {
    console.log("\n🔔 TokenCreated detected:", tokenAddr);

    // 4) Wait for 10 confirmations + 30s delay
    const tx = await event.getTransaction();
    console.log("⏳ Waiting 10 confirmations…");
    await tx.wait(10);
    console.log("⏳ Waiting 30 s for Etherscan to index…");
    await new Promise(res => setTimeout(res, 30_000));

    // 5) Read constructor args on­chain
    const token = new ethers.Contract(
      tokenAddr,
      [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function totalSupply() view returns (uint256)"
      ],
      provider
    );
    const [name, symbol, totalSupply] = await Promise.all([
      token.name(),
      token.symbol(),
      token.totalSupply().then(v => v.toString())
    ]);
    console.log("Constructor args:", { name, symbol, totalSupply, creator, ipfsHash });

    // 6) Attempt verification
    console.log("🛠️  Verifying on Etherscan…");
    const verifyArgs = {
      address: tokenAddr,
      constructorArguments: [name, symbol, totalSupply, creator, ipfsHash],
      contract: "contracts/MemeCoin.sol:MemeCoin"  // point at your contract path + name
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await run("verify:verify", verifyArgs);
        console.log("✅ Verified", tokenAddr);
        break;
      } catch (err) {
        const msg = err.message.split("\n")[0];
        console.warn(`⚠️ Verify attempt ${attempt} failed: ${msg}`);
        if (attempt === 2) console.error("❌ Giving up after 2 attempts");
        else {
          console.log("⏳ Retrying in 15 s…");
          await new Promise(r => setTimeout(r, 15_000));
        }
      }
    }
  });

  // 7) Keep the script alive
  process.stdin.resume();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
