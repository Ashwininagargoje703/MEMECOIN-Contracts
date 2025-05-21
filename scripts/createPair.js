// scripts/createPair.js
const { ethers } = require("hardhat");

async function main() {
  // ────────── CONFIG ──────────
  const FACTORY_ADDRESS = "0xF69E7F748C82CE499bb949D65Ade8Fc02FcFb64e";

  // Replace these two with your two token addresses:
  let A = "0xD5a0e4EA3F25f7027B2156372085093EAb1774C1";
  let B = "0x63cA15DeAd29913046cFF7f2e773A6A7b98D4465";

  // **Sort** them so the lower‐numerical address is first
  if (A.toLowerCase() > B.toLowerCase()) [A, B] = [B, A];

  // ────────── SETUP ──────────
  const [deployer] = await ethers.getSigners();
  console.log("⛏️  Using deployer:", deployer.address);

  const factory = await ethers.getContractAt(
    "MemeCoinFactory",
    FACTORY_ADDRESS,
    deployer
  );

  // ────────── CREATE PAIR ──────────
  console.log(`🚀 Ensuring V2 pair for:\n  Token0: ${A}\n  Token1: ${B}`);
  const tx = await factory.ensureV2Pair(A, B, { gasLimit: 200_000 });
  console.log("  ↳ tx hash:", tx.hash);
  await tx.wait(1);
  console.log("✅ ensureV2Pair confirmed");

  // ────────── LOOKUP PAIR ──────────
  const v2FactoryAddr = await factory.v2Factory();
  const uniFactory = new ethers.Contract(
    v2FactoryAddr,
    ["function getPair(address,address) view returns (address)"],
    deployer
  );
  const pairAddr = await uniFactory.getPair(A, B);

  console.log("🔗 Uniswap V2 Pair address:", pairAddr);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("✖️  error in createPair script:", err);
    process.exit(1);
  });
