// scripts/interact.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [owner, creator, buyer, referrer] = await ethers.getSigners();

  // 1) Deploy the factory
  const Factory = await ethers.getContractFactory("MemeCoinFactory", owner);
  const factory = await Factory.deploy(
    100 /* platformFeeBP */,
    200 /* referralFeeBP */
  );
  await factory.deployed();
  console.log("Factory deployed at:", factory.address);

  // 2) Check initial totals
  console.log(
    "Total tokens before creation:",
    (await factory.totalTokens()).toString()
  );

  // 3) Creator launches a token
  const supply = ethers.utils.parseUnits("1000", 18);
  const price = ethers.utils.parseEther("0.005");
  const createTx = await factory
    .connect(creator)
    .createMemeCoin(
      "LocalToken",
      "LTK",
      "Local test token",
      supply,
      price,
      "QmLocalCID"
    );
  await createTx.wait();
  console.log("Token created by creator");

  // 4) Read-after-create
  console.log(
    "Total tokens after creation:",
    (await factory.totalTokens()).toString()
  );
  const [tokenAddr] = await factory.getTokenDetails(0);
  console.log("New token address:", tokenAddr);

  // 5) Read views
  console.log("Tokens list:", await factory.getTokens(0, 10));
  console.log(
    "Details by address:",
    await factory.getTokenDetailsByAddress(tokenAddr)
  );
  console.log(
    "Price of token:",
    ethers.utils.formatEther(await factory.priceOf(tokenAddr)),
    "ETH"
  );
  console.log(
    "Token index:",
    (await factory.getTokenIndex(tokenAddr)).toString()
  );
  console.log(
    "Tokens by creator:",
    await factory.getTokensByCreator(creator.address)
  );
  console.log(
    "Unsold supply:",
    ethers.utils.formatUnits(await factory.unsoldSupply(tokenAddr), 18)
  );

  // 6) Buyer purchases without referrer
  const token = await ethers.getContractAt("IERC20", tokenAddr, buyer);
  const amountToBuy = ethers.utils.parseUnits("10", 18);
  const cost = price.mul(amountToBuy).div(ethers.constants.WeiPerEther);
  const buyTx1 = await factory
    .connect(buyer)
    .buyToken(tokenAddr, amountToBuy, ethers.constants.AddressZero, {
      value: cost,
    });
  await buyTx1.wait();
  console.log(
    "Buyer purchased 10 LTK without referrer. Balance:",
    ethers.utils.formatUnits(await token.balanceOf(buyer.address), 18)
  );

  // 7) Buyer purchases with referrer
  const buyTx2 = await factory
    .connect(buyer)
    .buyToken(tokenAddr, amountToBuy, referrer.address, { value: cost });
  await buyTx2.wait();
  console.log(
    "Buyer purchased 10 LTK with referrer. Referrer received:",
    ethers.utils.formatEther(
      await ethers.provider.getBalance(referrer.address)
    ),
    "ETH"
  );

  // 8) Creator updates price
  const newPrice = ethers.utils.parseEther("0.01");
  await (
    await factory.connect(creator).updatePrice(tokenAddr, newPrice)
  ).wait();
  console.log(
    "Price updated to:",
    ethers.utils.formatEther(await factory.priceOf(tokenAddr)),
    "ETH"
  );

  // 9) Creator updates metadata
  await (
    await factory
      .connect(creator)
      .updateMetadata(tokenAddr, "Updated desc", "QmNewHash")
  ).wait();
  console.log("Metadata updated:", await factory.getTokenDetails(0));

  // 10) Creator reclaims some unsold tokens
  const reclaimAmount = ethers.utils.parseUnits("100", 18);
  await (
    await factory.connect(creator).reclaimUnsold(tokenAddr, reclaimAmount)
  ).wait();
  console.log(
    "Creator reclaimed",
    ethers.utils.formatUnits(reclaimAmount, 18),
    "tokens"
  );

  // 11) Owner pauses/unpauses token
  await (await factory.connect(owner).pauseToken(tokenAddr)).wait();
  console.log("Token paused:", await factory.tokenPaused(tokenAddr));
  await (await factory.connect(owner).unpauseToken(tokenAddr)).wait();
  console.log("Token unpaused:", await factory.tokenPaused(tokenAddr));

  // 12) Owner pauses/unpauses contract
  await (await factory.connect(owner).pause()).wait();
  console.log("Contract paused");
  await (await factory.connect(owner).unpause()).wait();
  console.log("Contract unpaused");

  // 13) Owner updates fees
  await (await factory.connect(owner).updateFees(50, 50)).wait();
  console.log(
    "Fees updated:",
    (await factory.platformFeeBP()).toString(),
    (await factory.referralFeeBP()).toString()
  );

  // 14) Test ETH fallback and withdrawETH
  try {
    await owner.sendTransaction({
      to: factory.address,
      value: ethers.utils.parseEther("1"),
    });
    console.log("Unexpected: direct ETH send succeeded");
  } catch (e) {
    console.log("Direct ETH send reverted as expected:", e.reason || e.message);
  }

  try {
    await factory.connect(owner).withdrawETH(ethers.utils.parseEther("0.5"));
    console.log("Unexpected: withdrawETH succeeded");
  } catch (e) {
    console.log("withdrawETH reverted as expected:", e.reason || e.message);
  }

  // 15) Owner rescues ERC20
  const Dummy = await ethers.getContractFactory("DailyUSDC", owner);
  const dummy = await Dummy.deploy(ethers.utils.parseUnits("1000", 18));
  await dummy.deployed();
  // Mint extra to contract
  await (
    await dummy.mint(factory.address, ethers.utils.parseUnits("200", 18))
  ).wait();
  await (
    await factory
      .connect(owner)
      .rescueERC20(dummy.address, ethers.utils.parseUnits("200", 18))
  ).wait();
  console.log("Owner rescued 200 dummy tokens");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Script error:", err);
    process.exit(1);
  });
