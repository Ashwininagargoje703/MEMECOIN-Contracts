// scripts/listTokens.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const factoryAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // your factory
  const factory = await ethers.getContractAt("MemeCoinFactory", factoryAddress);

  const total = (await factory.totalTokens()).toNumber();
  console.log("Total launched tokens:", total);

  for (let i = 0; i < total; i++) {
    const info = await factory.allTokens(i);
    const tokenAddr = info.token;
    const creator   = info.creator;
    const priceEth  = ethers.utils.formatEther(info.priceWei);

    // fetch IPFS hash from the token
    const token = await ethers.getContractAt("MemeCoin", tokenAddr);
    const ipfsHash = await token.ipfsHash();

    console.log(`\nToken #${i}`);
    console.log(`  Address:     ${tokenAddr}`);
    console.log(`  Creator:     ${creator}`);
    console.log(`  Price:       ${priceEth} ETH`);
    console.log(`  IPFS:        ipfs://${ipfsHash}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
