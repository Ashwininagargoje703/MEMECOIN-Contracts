// scripts/deploy-reward-token.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying RewardToken with:", deployer.address);

  // 1) Deploy the token with 1,000,000 supply (6 decimals)
  const initialSupply = ethers.utils.parseUnits("1000000", 18);
  const Reward = await ethers.getContractFactory("RewardToken");
  const reward = await Reward.deploy(initialSupply);
  await reward.deployed();

  console.log("RewardToken deployed at:", reward.address);
  console.log(
    "Minted",
    ethers.utils.formatUnits(initialSupply, 18),
    "RWD to deployer"
  );
  console.log(`
Now add to your .env:
  REWARD_TOKEN_ADDRESS=${reward.address}

Then rerun:
  npx hardhat run scripts/deploy-staking.js --network localhost
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
