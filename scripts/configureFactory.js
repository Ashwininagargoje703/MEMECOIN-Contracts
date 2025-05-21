// scripts/configureFactory.js
const { ethers } = require("hardhat");

async function main() {
  // ─────────── Your deployed addresses ───────────
  const FACTORY_ADDRESS           = "0xF69E7F748C82CE499bb949D65Ade8Fc02FcFb64e";
  const VESTING_MANAGER_ADDRESS   = "0x978405912588C9BA17B0F8e30585c139FfdAE942";
  const DEX_HELPER_ADDRESS        = "0x0000000000000000000000000000000000000000"; // placeholder
  const WHITELIST_PRESALE_ADDRESS = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
  const STAKING_TOKEN_ADDRESS     = "0xD5a0e4EA3F25f7027B2156372085093EAb1774C1";
  const REWARD_TOKEN_ADDRESS      = "0x978405912588C9BA17B0F8e30585c139FfdAE942";
  const STAKING_MODULE_ADDRESS    = "0x1380CEC0B585Fd7CB44c87Dcd706b507AFee2d6e";
  const AIRDROP_MERKLE_ADDRESS    = "0x4deb0Fc6276F346d024Bc118c8Ba0d8689101d20";
  const BRIDGE_ADAPTER_ADDRESS    = "0xbB86F9f555785f251efae4227EFDd6e466336ca8";
  const GAS_SERVICE_ADDRESS       = "0x9feEdE58B02dbB1b1589b8266b29131362eDB0FE";
  const GATEWAY_ADDRESS           = "0x4CC5F6132078fe253e3B0c48a780a15e8Ab8620c";
  const ROUTER_ADDRESS            = "0x4793f56C982Aff1e683265CfFF77599058625F94";
  const BUYBACK_BURN_ADDRESS      = "0x544b24c1341d92e46892515A5F5b9a8ceA9ca54D";

  // ─────────── Attach to factory ───────────
  const [deployer] = await ethers.getSigners();
  console.log("Using deployer:", deployer.address);

  const factory = await ethers.getContractAt(
    "MemeCoinFactory",
    FACTORY_ADDRESS,
    deployer
  );

  // Utility to call & wait
  async function exec(fn, name) {
    console.log("> Setting", name);
    const tx = await fn();
    console.log("  tx:", tx.hash);
    await tx.wait(1);
    console.log("  ✅ done");
  }

  // ─────────── Core modules ───────────
  await exec(
    () => factory.setWhitelistModule(WHITELIST_PRESALE_ADDRESS),
    "WhitelistPresale"
  );
  await exec(
    () => factory.setV3Helper(DEX_HELPER_ADDRESS),
    "UniswapV3Helper"
  );
  await exec(
    () => factory.setPositionManager(UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"),
    "PositionManager"
  );
  await exec(
    () => factory.setV2Factory("0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"),
    "V2Factory"
  );

  // ─────────── Staking & Vesting ───────────
  await exec(
    () => factory.setStakingModule(STAKING_MODULE_ADDRESS),
    "StakingRewards"
  );
  await exec(
    () => factory.setGovernanceModules(REWARD_TOKEN_ADDRESS, VESTING_MANAGER_ADDRESS),
    "GovernanceToken & GovernorContract"
  );

  // ─────────── Bridge & Airdrop & Buyback ───────────
  await exec(
    () => factory.setBridgeModule(BRIDGE_ADAPTER_ADDRESS),
    "BridgeAdapter"
  );
  await exec(
    () => factory.setAirdropModule(AIRDROP_MERKLE_ADDRESS),
    "AirdropMerkle"
  );
  await exec(
    () => factory.setBuybackModule(BUYBACK_BURN_ADDRESS),
    "BuybackBurn"
  );

  console.log("✅ All modules configured.");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
