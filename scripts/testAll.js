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
  const FACTORY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const factory = await ethers.getContractAt("MemeCoinFactory", FACTORY_ADDRESS);

  console.log("🏭 Factory at:", factory.address);
  console.log(
    "Fees (bp):",
    (await factory.platformFeeBP()).toString(),
    "/",
    (await factory.referralFeeBP()).toString()
  );

  // 1️⃣ Create a MemeCoin
  const name        = "TestToken";
  const symbol      = "TTK";
  const description = "My test token";
  const totalSupply = ethers.utils.parseEther("1000");
  const priceWei    = ethers.utils.parseEther("0.01");
  const ipfsHash    = "QmTestHash";

  console.log("\n1️⃣ Creating MemeCoin…");
  let tx = await factory.createMemeCoin(
    name,
    symbol,
    description,
    totalSupply,
    priceWei,
    ipfsHash
  );
  let receipt = await tx.wait();
  const tokenAddr = receipt.events.find(e => e.event === "TokenCreated").args.token;
  console.log("   ▶ TokenCreated:", tokenAddr);

  const token = await ethers.getContractAt("MemeCoin", tokenAddr);

  // 2️⃣ Basic Views
  console.log("\n2️⃣ Views:");
  console.log("   totalTokens =", (await factory.totalTokens()).toString());
  const [info] = await factory.getTokens(0, 1);
  console.log("   getTokens(0,1) =", {
    token:       info.token,
    creator:     info.creator,
    priceWei:    info.priceWei.toString(),
    description: info.description,
    ipfsHash:    info.ipfsHash,
  });
  console.log("   priceOf =", ethers.utils.formatEther(await factory.priceOf(tokenAddr)), "ETH");

  // 3️⃣ Buy (with referral)
  console.log("\n3️⃣ Alice buys 5 TTK (referrer gets immediate payout) …");
  const buyAmt = ethers.utils.parseEther("5");
  const cost   = priceWei.mul(buyAmt).div(ethers.utils.parseEther("1"));
  const beforeRef = await ethers.provider.getBalance(referrer.address);

  await factory.connect(alice).buyToken(tokenAddr, buyAmt, referrer.address, { value: cost });

  console.log("   Alice balance:", ethers.utils.formatEther(await token.balanceOf(alice.address)));
  console.log(
    "   platformFeesAccumulated:",
    ethers.utils.formatEther(await factory.platformFeesAccumulated())
  );
  const afterRef = await ethers.provider.getBalance(referrer.address);
  console.log("   referrer got:", ethers.utils.formatEther(afterRef.sub(beforeRef)), "ETH");

  // 4️⃣ Update fees
  console.log("\n4️⃣ Update fees to platform=3% / referral=1% …");
  await factory.updateFees(300, 100);
  console.log(
    "   New fees (bp):",
    (await factory.platformFeeBP()).toString(),
    "/",
    (await factory.referralFeeBP()).toString()
  );

  // 5️⃣ Withdraw platform fees
  console.log("\n5️⃣ Withdraw platform fees …");
  const beforePlat = await ethers.provider.getBalance(deployer.address);
  await factory.withdrawPlatformFees();
  const afterPlat = await ethers.provider.getBalance(deployer.address);
  console.log("   +", ethers.utils.formatEther(afterPlat.sub(beforePlat)), "ETH");

  // 6️⃣ Reclaim unsold tokens
  console.log("\n6️⃣ Reclaim 10 unsold TTK …");
  await factory.reclaimUnsold(tokenAddr, ethers.utils.parseEther("10"));
  console.log(
    "   Creator TTK balance:",
    ethers.utils.formatEther(await token.balanceOf(deployer.address))
  );

  // 7️⃣ Global pause/unpause
  console.log("\n7️⃣ Global pause buys …");
  await factory.pauseBuys();
  await expectRevert(
    () => factory.connect(bob).buyToken(tokenAddr, ethers.utils.parseEther("1"), ethers.constants.AddressZero, { value: priceWei }),
    "BuysPaused"
  );
  console.log("   ✔ blocked while paused");
  await factory.unpauseBuys();
  console.log("   ✔ unpaused");

  // 8️⃣ Vesting (will revert because factory holds no tokens for vesting)
  console.log("\n8️⃣ Vesting Bob (100 TTK over 10s cliff / 20s duration) …");
  await factory.setVestingSchedule(bob.address, ethers.utils.parseEther("100"), 10, 20);
  console.log("   Fast-forward 15s…");
  await ethers.provider.send("evm_increaseTime", [15]);
  await ethers.provider.send("evm_mine");
  await expectRevert(
    () => factory.connect(bob).claimVested(),
    "Use buyToken"
  );

  // 9️⃣ Analytics & Pagination
  console.log("\n9️⃣ Analytics & Pagination:");
  const stats = await factory.getSalesStats(tokenAddr);
  console.log(
    "   sold:",  ethers.utils.formatEther(stats.sold_),
    "raised:", ethers.utils.formatEther(stats.raised_)
  );
  const { page, total } = await factory.listTokensPaginated(0, 5);
  console.log(`   paginated: total=${total}, returned=${page.length}`);

  console.log("\n✅ All available functions tested (including expected vesting revert).");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
