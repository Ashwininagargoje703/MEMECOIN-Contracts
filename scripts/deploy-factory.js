// scripts/deploy-factory.js
require("dotenv").config();
const { ethers, run, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(
    `\nDeploying contracts on ${network.name} with account ${deployer.address}`
  );
  console.log(
    `Account balance: ${ethers.utils.formatEther(
      await deployer.getBalance()
    )} ETH\n`
  );

  // 1) Deploy Vesting Manager
  const Vesting = await ethers.getContractFactory("MemeCoinVestingManager");
  const vesting = await Vesting.deploy();
  await vesting.deployed();
  console.log(`→ MemeCoinVestingManager deployed at: ${vesting.address}`);

  // 2) Deploy Factory (forwarder = address zero on localhost)
  const platformFeeBP = Number(process.env.PLATFORM_FEE_BP || "200"); // default 2%
  const referralFeeBP = Number(process.env.REFERRAL_FEE_BP || "100"); // default 1%

  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = await Factory.deploy(
    // use zero address so _msgSender() == msg.sender on localhost
    network.name === "localhost" ? ethers.constants.AddressZero : deployer.address,
    platformFeeBP,
    referralFeeBP
  );
  await factory.deployed();
  console.log(`→ MemeCoinFactory deployed at: ${factory.address}`);

  // 3) Grant Factory the OPERATOR_ROLE on the Vesting Manager
  const OP = await vesting.OPERATOR_ROLE();
  await vesting.grantRole(OP, factory.address);
  console.log(`→ Granted OPERATOR_ROLE on VestingManager to Factory`);

  // 4) (Optional) Verify on Etherscan
  if (network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying on Etherscan…");

    try {
      await run("verify:verify", {
        address: vesting.address,
        constructorArguments: [],
      });
      console.log("✅ VestingManager verified");
    } catch (e) {
      console.warn("⚠️ VestingManager verification failed:", e.message);
    }

    try {
      await run("verify:verify", {
        address: factory.address,
        constructorArguments: [
          network.name === "localhost" ? ethers.constants.AddressZero : deployer.address,
          platformFeeBP,
          referralFeeBP,
        ],
      });
      console.log("✅ Factory verified");
    } catch (e) {
      console.warn("⚠️ Factory verification failed:", e.message);
    }
  }

  // 5) Post-deploy instructions
  console.log(`
🎉 Deployment complete!

 • Add to your .env (or your frontend config):
     FACTORY_ADDRESS=${factory.address}
     VESTING_MANAGER_ADDRESS=${vesting.address}

 • Next, deploy additional modules:
     npx hardhat run scripts/deploy-whitelist.js --network ${network.name}
     npx hardhat run scripts/deploy-dex-helper.js   --network ${network.name}
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
