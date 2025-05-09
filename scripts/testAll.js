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
  const factory = await ethers.getContractAt(
    "MemeCoinFactory",
    process.env.FACTORY_ADDRESS
  );

  console.log("🏭 Factory at:", factory.address);
  console.log(
    "Fees (bp):",
    (await factory.platformFeeBP()).toString(),
    "/",
    (await factory.referralFeeBP()).toString()
  );

  // 1️⃣ Create a MemeCoin
  console.log("\n1️⃣ Creating MemeCoin…");
  const name        = "TestToken";
  const symbol      = "TTK";
  const description = "My test token";
  const totalSupply = ethers.utils.parseEther("1000");
  const priceWei    = ethers.utils.parseEther("0.01");
  const ipfsHash    = "QmTestHash";
  let tx = await factory.createMemeCoin(
    name, symbol, description, totalSupply, priceWei, ipfsHash
  );
  let receipt = await tx.wait();
  const tokenAddr = receipt.events.find(e => e.event === "TokenCreated").args.token;
  console.log("   ▶ TokenCreated at:", tokenAddr);

  const token = await ethers.getContractAt("MemeCoin", tokenAddr);

  // 2️⃣ Views & Metadata
  console.log("\n2️⃣ Views & Metadata:");
  console.log("   totalTokens =", (await factory.totalTokens()).toString());
  console.log("   priceOf      =", ethers.utils.formatEther(await factory.priceOf(tokenAddr)), "ETH");

  // Update price
  const newPrice = ethers.utils.parseEther("0.02");
  await factory.updatePrice(tokenAddr, newPrice);
  console.log("   priceOf after update =", ethers.utils.formatEther(await factory.priceOf(tokenAddr)));

  // Update metadata
  await factory.updateMetadata(tokenAddr, "NewDesc", "NewHash");
  let [info] = await factory.getTokens(0,1);
  console.log("   metadata after update =", info.description, info.ipfsHash);

  // 3️⃣ Buy (with referral)
  console.log("\n3️⃣ Alice buys 5 TTK…");
  const buyAmt = ethers.utils.parseEther("5");
  const cost   = newPrice.mul(buyAmt).div(ethers.utils.parseEther("1"));
  await factory.connect(alice).buyToken(tokenAddr, buyAmt, referrer.address, { value: cost });
  console.log("   Alice balance:", ethers.utils.formatEther(await token.balanceOf(alice.address)));
  console.log("   platformFeesAccrued:", ethers.utils.formatEther(await factory.platformFeesAccumulated()));
  console.log("   referralFeesAccrued:", ethers.utils.formatEther(await factory.referralFees(referrer.address)));

  // 4️⃣ getRevenueSplit
  const [pf, rf, cf] = await factory.getRevenueSplit(cost);
  console.log("\n4️⃣ Revenue split for", ethers.utils.formatEther(cost), "ETH →", {
    platform: ethers.utils.formatEther(pf),
    referral: ethers.utils.formatEther(rf),
    creator:  ethers.utils.formatEther(cf),
  });

  // 5️⃣ Update fees
  console.log("\n5️⃣ Update fees to 3% / 1% …");
  await factory.updateFees(300, 100);
  console.log("   New fees (bp):", (await factory.platformFeeBP()).toString(), "/", (await factory.referralFeeBP()).toString());

  // 6️⃣ Withdraw referral fees
  console.log("\n6️⃣ Withdraw referral fees …");
  let balBefore = await ethers.provider.getBalance(referrer.address);
  await factory.connect(referrer).withdrawReferralFees();
  let balAfter  = await ethers.provider.getBalance(referrer.address);
  console.log("   Received:", ethers.utils.formatEther(balAfter.sub(balBefore)), "ETH");

  // 7️⃣ Withdraw platform fees
  console.log("\n7️⃣ Withdraw platform fees …");
  balBefore = await ethers.provider.getBalance(deployer.address);
  await factory.withdrawPlatformFees();
  balAfter  = await ethers.provider.getBalance(deployer.address);
  console.log("   Received:", ethers.utils.formatEther(balAfter.sub(balBefore)), "ETH");

  // 8️⃣ Withdraw creator fees (should revert “NoFees”)
  console.log("\n8️⃣ Withdraw creator fees (none yet) …");
  await expectRevert(
    () => factory.withdrawCreatorFees(tokenAddr),
    "NoFees"
  );

  // 9️⃣ Reclaim unsold tokens
  console.log("\n9️⃣ Reclaim 10 unsold TTK …");
  await factory.reclaimUnsold(tokenAddr, ethers.utils.parseEther("10"));
  console.log("   Creator TTK balance:", ethers.utils.formatEther(await token.balanceOf(deployer.address)));

  // 🔟 Token pause/unpause
  console.log("\n🔟 Pause sales for this token …");
  await factory.pauseTokenSales(tokenAddr);
  await expectRevert(
    () => factory.connect(bob).buyToken(tokenAddr, ethers.utils.parseEther("1"), ethers.constants.AddressZero, { value: newPrice }),
    "TokenPaused"
  );
  console.log("   ✔ blocked while paused");
  await factory.unpauseTokenSales(tokenAddr);
  console.log("   ✔ unpaused");

  // 1️⃣1️⃣ Global pause/unpause
  console.log("\n1️⃣1️⃣ Global pause …");
  await factory.pause();
  await expectRevert(
    () => factory.connect(bob).buyToken(tokenAddr, ethers.utils.parseEther("1"), ethers.constants.AddressZero, { value: newPrice }),
    "Pausable: paused"
  );
  console.log("   ✔ blocked globally");
  await factory.unpause();
  console.log("   ✔ unpaused globally");

  // 1️⃣2️⃣ Whitelist
  console.log("\n1️⃣2️⃣ Whitelist tests …");
  await factory.toggleWhitelist(tokenAddr, true);
  await expectRevert(
    () => factory.connect(bob).buyToken(tokenAddr, ethers.utils.parseEther("1"), ethers.constants.AddressZero, { value: newPrice }),
    "NotWhitelisted"
  );
  await factory.addToWhitelist(tokenAddr, [bob.address]);
  await factory.connect(bob).buyToken(tokenAddr, ethers.utils.parseEther("1"), ethers.constants.AddressZero, { value: newPrice });
  console.log("   Bob balance:", ethers.utils.formatEther(await token.balanceOf(bob.address)));

  // 1️⃣3️⃣ Vesting
  console.log("\n1️⃣3️⃣ Vesting Bob …");
  const vestAmt = ethers.utils.parseEther("100");
  await token.connect(deployer).approve(factory.address, vestAmt);
  await factory.setVestingSchedule(bob.address, tokenAddr, vestAmt, 10, 20);
  // before cliff
  await expectRevert(() => factory.connect(bob).claimVested(), "NothingToClaim");
  // after cliff but before full duration
  await ethers.provider.send("evm_increaseTime", [15]);
  await ethers.provider.send("evm_mine");
  await factory.connect(bob).claimVested();
  console.log("   Bob vested balance:", ethers.utils.formatEther(await token.balanceOf(bob.address)));
  // after duration
  await ethers.provider.send("evm_increaseTime", [10]);
  await ethers.provider.send("evm_mine");
  await factory.connect(bob).claimVested();
  console.log("   Bob total vested:", ethers.utils.formatEther(await token.balanceOf(bob.address)));

  // 1️⃣4️⃣ Analytics & Pagination
  console.log("\n1️⃣4️⃣ Analytics & Pagination:");
  const stats = await factory.getSalesStats(tokenAddr);
  console.log("   sold:", ethers.utils.formatEther(stats.sold_), "raised:", ethers.utils.formatEther(stats.raised_));
  const { page, total } = await factory.listTokensPaginated(0, 5);
  console.log(`   total listings: ${total}, returned page length: ${page.length}`);

  console.log("\n✅ All tests complete!");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
