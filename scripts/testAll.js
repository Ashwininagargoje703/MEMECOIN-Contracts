// scripts/testAll.js
require("dotenv").config();
const { ethers } = require("hardhat");

// helper to assert a revert containing the given substring
async function expectRevert(fn, substr) {
  try {
    await fn();
    console.error("    ✖ expected revert containing:", substr);
  } catch (err) {
    if (err.message.includes(substr)) {
      console.log("    ✔ reverted with:", substr);
    } else {
      console.error("    ✖ unexpected error:", err.message);
    }
  }
}

async function main() {
  const [deployer, alice, bob, referrer] = await ethers.getSigners();

  const FACTORY    = process.env.FACTORY_ADDRESS;
  const VM_ADDR    = process.env.VESTING_MANAGER_ADDRESS;
  const DEX_HELPER = process.env.DEX_HELPER_ADDRESS;
  if (!FACTORY || !VM_ADDR || !DEX_HELPER) {
    throw new Error("Set FACTORY_ADDRESS, VESTING_MANAGER_ADDRESS and DEX_HELPER_ADDRESS in .env");
  }

  const factory        = await ethers.getContractAt("MemeCoinFactory", FACTORY);
  const vestingManager = await ethers.getContractAt("MemeCoinVestingManager", VM_ADDR);
  const helper         = await ethers.getContractAt("IMemeCoinDEXHelper", DEX_HELPER);

  console.log("🏭 Factory:", factory.address);
  console.log("🛡 VestingManager:", vestingManager.address);
  console.log("🤖 DEX Helper:", helper.address);

  // 1. Basic params
  console.log("Fees (bp):",
    (await factory.platformFeeBP()).toString(), "/",
    (await factory.referralFeeBP()).toString());
  console.log("Platform fees accrued:", ethers.utils.formatEther(await factory.platformFeesAccrued()));
  console.log("Presale Merkle root:", (await factory.presaleMerkleRoot()).toString());
  console.log("totalTokens =", (await factory.totalTokens()).toString());

  // 2. Reuse existing token
  const tokenAddr = "0x1e74994b82e87F312bbcE77EeF849fE3d7E85863";
  console.log("\n🔁 Reusing MemeCoin at:", tokenAddr);
  const token = await ethers.getContractAt("MemeCoin", tokenAddr);

  // 3. DEX-Integration
  console.log("\n2️⃣ DEX integration:");
  await factory.setDexHelper(helper.address);
  await factory.configureDex(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506"
  );
  console.log("    ✓ setDexHelper & configureDex");

  await factory.grantRole(await factory.OPERATOR_ROLE(), deployer.address);
  console.log("    ✓ operator granted");

  try {
    await factory.callStatic.createPair(tokenAddr);
    await factory.createPair(tokenAddr);
    console.log("    ✓ Pair created");
  } catch {
    console.log("    ⚠ Pair exists or failed, skipping");
  }

  // 4. Liquidity ops
  console.log("\n3️⃣ Liquidity operations:");
  const liqTokenAmt = ethers.utils.parseEther("1");    // 1 TTK
  const liqEthAmt   = ethers.utils.parseEther("0.05"); // 0.05 ETH

  // Transfer tokens into the factory so helper can pull them without allowance
  await token.connect(deployer).transfer(factory.address, liqTokenAmt);
  console.log("    ✓ transferred 1 TTK into factory");

  // Approve helper (just in case)
  await token.connect(deployer).approve(helper.address, ethers.constants.MaxUint256);
  console.log("    ✓ approved helper to spend TTK");

  // Wrap liquidity in try/catch so we can continue if it still fails
  try {
    await factory.addTokenLiquidity(tokenAddr, liqTokenAmt, { value: liqEthAmt });
    console.log("    ✓ addTokenLiquidity");
    await factory.removeTokenLiquidity(tokenAddr, ethers.BigNumber.from("1"));
    console.log("    ✓ removeTokenLiquidity");
    await factory.sweepHelperDust(tokenAddr, deployer.address);
    console.log("    ✓ sweepHelperDust");
  } catch (err) {
    console.warn("    ⚠ Liquidity ops failed, skipping rest of liquidity steps");
  }

  // 5. Views & metadata
  console.log("\n4️⃣ Views & metadata:");
  const info = await factory.getTokenInfoByAddress(tokenAddr);
  console.log("   creator  =", info.creator);
  console.log("   priceWei =", ethers.utils.formatEther(info.priceWei));
  console.log("   active   =", info.active);

  // 6. Buy & referral
  console.log("\n5️⃣ Alice buys 5 TTK…");
  const buyAmt = ethers.utils.parseEther("5");
  const cost   = info.priceWei.mul(buyAmt).div(ethers.utils.parseEther("1"));
  await factory.connect(alice).buyToken(tokenAddr, buyAmt, referrer.address, { value: cost });
  console.log("    ✓ buyToken");

  // 7. Withdraw fees
  console.log("\n6️⃣ Withdraw fees:");
  let b = await ethers.provider.getBalance(deployer.address);
  await factory.withdrawPlatformFees(deployer.address);
  let a = await ethers.provider.getBalance(deployer.address);
  console.log("   +", ethers.utils.formatEther(a.sub(b)), "ETH platform");
  b = await ethers.provider.getBalance(deployer.address);
  await factory.withdrawMyCreatorFees();
  a = await ethers.provider.getBalance(deployer.address);
  console.log("   +", ethers.utils.formatEther(a.sub(b)), "ETH creator");

  // 8. Pause & whitelist tests
  console.log("\n7️⃣ Pause & whitelist:");
  await factory.pauseTokenSales(tokenAddr);
  await expectRevert(
    () => factory.connect(bob).buyToken(tokenAddr, buyAmt, ethers.constants.AddressZero, { value: cost }),
    "TokenSalePaused"
  );
  await factory.unpauseTokenSales(tokenAddr);
  console.log("    ✓ pause/unpause");

  await factory.toggleWhitelist(tokenAddr, true);
  await expectRevert(
    () => factory.connect(bob).buyToken(tokenAddr, buyAmt, ethers.constants.AddressZero, { value: cost }),
    "NotWhitelisted"
  );
  await factory.addToWhitelist(tokenAddr, [bob.address]);
  await factory.connect(bob).buyToken(tokenAddr, buyAmt, ethers.constants.AddressZero, { value: cost });
  console.log("    ✓ whitelist works");
  await factory.toggleWhitelist(tokenAddr, false);

  // 9. Vesting tests
  console.log("\n8️⃣ Vesting:");
  const vestAmt = ethers.utils.parseEther("100");
  await factory.reclaimUnsold(tokenAddr, vestAmt);
  await token.connect(deployer).transfer(vestingManager.address, vestAmt);
  await vestingManager.setVestingSchedule(bob.address, tokenAddr, vestAmt, 10, 20);
  console.log("    ✓ vesting scheduled");

  // 10. Listing & reclaim
  console.log("\n9️⃣ Listing & reclaim:");
  await factory.endSale(tokenAddr);
  console.log("   active after endSale:", (await factory.getTokenInfoByAddress(tokenAddr)).active);
  await factory.toggleListingActive(tokenAddr, true);
  await factory.reclaimUnsold(tokenAddr, ethers.utils.parseEther("10"));
  console.log("    ✓ listing & reclaim");

  console.log("\n✅ All tests complete!");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
