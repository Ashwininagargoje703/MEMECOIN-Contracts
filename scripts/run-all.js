// scripts/run-all.js
const { ethers, network } = require("hardhat");

async function deployUniswapV2() {
  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth = await WETH9.deploy();
  await weth.deployed();
  console.log("WETH9 deployed to:", weth.address);

  const Factory = await ethers.getContractFactory("UniswapV2Factory");
  const factory = await Factory.deploy((await ethers.getSigners())[0].address);
  await factory.deployed();
  console.log("UniswapFactory:", factory.address);

  const Router = await ethers.getContractFactory("UniswapV2Router02");
  const router = await Router.deploy(factory.address, weth.address);
  await router.deployed();
  console.log("Router:", router.address);

  return { weth, factory, router };
}

async function testAnalytics(memeFactory, tokenAddr, deployer, alice) {
  console.log("\n=== Analytics Hooks ===");
  try {
    await memeFactory.releaseVault(tokenAddr);
    console.log("✔ VaultReleasedManual");
  } catch (e) {
    console.log("✖ Vault release:", e.reason || e.message);
  }
  try {
    await memeFactory.connect(alice).claimVault(tokenAddr);
    console.log("✔ VaultClaimed");
  } catch (e) {
    console.log("• Vault claim:", e.reason || e.message);
  }
  try {
    const [evt] = await memeFactory.queryFilter(
      memeFactory.filters.VestingCreated()
    );
    if (evt) {
      const vesting = await ethers.getContractAt(
        "SimpleVesting",
        evt.args.vestingContract
      );
      await vesting.release();
      console.log("✔ VestingReleased");
    } else {
      console.log("• No vesting contract");
    }
  } catch (e) {
    console.log("✖ Vesting release:", e.reason || e.message);
  }
  console.log("=== Done Analytics ===\n");
}

async function testPoolFlows(memeFactory, tokenAddr, deployer, router, weth) {
  console.log("\n=== Pool Flows ===");
  let pair;
  try {
    const factoryAddr = await memeFactory.v2Factory();
    const uniFactory = await ethers.getContractAt(
      "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol:IUniswapV2Factory",
      factoryAddr
    );
    const before = await uniFactory.getPair(tokenAddr, weth.address);
    console.log("Pair before:", before);

    await memeFactory.createV2Pool(tokenAddr, weth.address, {
      value: await memeFactory.POOL_CREATION_FEE(),
    });
    pair = await uniFactory.getPair(tokenAddr, weth.address);
    console.log("Pair after create:", pair);
  } catch (e) {
    console.log("✖ Pool creation:", e.reason || e.message);
  }

  try {
    if (!pair) throw new Error("No pair address");
    const token = await ethers.getContractAt(
      "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
      tokenAddr
    );
    const amtToken = ethers.utils.parseEther("10");
    const amtETH = ethers.utils.parseEther("1");
    await token.approve(router.address, amtToken);
    console.log("✔ Approved tokens");

    const { timestamp } = await ethers.provider.getBlock("latest");
    const deadline = timestamp + 600;

    await router.addLiquidityETH(
      tokenAddr,
      amtToken,
      0,
      0,
      deployer.address,
      deadline,
      { value: amtETH }
    );
    console.log("✔ Liquidity added");
  } catch (e) {
    console.log("✖ addLiquidityETH:", e.reason || e.message);
  }

  try {
    if (!pair) throw new Error("No pair address");
    const pairC = await ethers.getContractAt(
      "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol:IUniswapV2Pair",
      pair
    );
    const lpBal = await pairC.balanceOf(deployer.address);
    console.log("LP balance:", lpBal.toString());

    await pairC.approve(router.address, lpBal);
    console.log("✔ Approved LP tokens");

    const { timestamp: ts2 } = await ethers.provider.getBlock("latest");
    const deadline2 = ts2 + 600;

    await router.removeLiquidityETH(
      tokenAddr,
      lpBal,
      0,
      0,
      deployer.address,
      deadline2
    );
    console.log("✔ Liquidity removed");
  } catch (e) {
    console.log("✖ removeLiquidityETH:", e.reason || e.message);
  }

  console.log("=== Done Pool Flows ===\n");
}

async function testNewFeatures(memeFactory, tokenAddr, deployer, alice) {
  console.log("\n=== New Features Test ===");

  // 1) register a referral code
  const code = ethers.utils.formatBytes32String("REF123");
  await memeFactory.connect(deployer).registerReferralCode(code);
  console.log("✔ Referral code registered:", code);

  // 2) buyToken with referral code & slippage guard
  const one = ethers.utils.parseEther("0.5");
  const cost = await memeFactory.costToBuy(tokenAddr, one);
  await memeFactory.connect(alice).buyToken(
    tokenAddr,
    one,
    code,
    cost,
    { value: cost } // <–– pass the Eth!
  );
  console.log("✔ buyToken with referral succeeded");

  // 3) update audit report URI
  const auditURI = "ipfs://QmAuditReportHash";
  await memeFactory.connect(deployer).updateAuditReport(auditURI);
  console.log("✔ Audit report updated:", await memeFactory.auditReportURI());

  console.log("=== Done New Features Test ===\n");
}

async function main() {
  const [deployer, alice] = await ethers.getSigners();

  // 1) Deploy Uniswap V2
  const { weth, factory: uniFactory, router } = await deployUniswapV2();

  // 2) Deploy MemeCoinFactory
  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const memeFactory = await Factory.deploy(
    200,
    50,
    uniFactory.address,
    router.address
  );
  await memeFactory.deployed();
  console.log("MemeCoinFactory:", memeFactory.address);

  // 3) Launch token w/ 2-min vault
  const now = (await ethers.provider.getBlock()).timestamp;
  const vaultWindow = 120;
  const tx = await memeFactory.createMemeCoin(
    "DemoToken",
    "DMT",
    0,
    1_000_000,
    0,
    ethers.utils.parseEther("0.01"),
    ethers.utils.parseEther("0.005"),
    0,
    1,
    ethers.utils.parseEther("0.05"),
    100,
    300,
    now,
    now + 3600,
    now + vaultWindow,
    ethers.utils.parseEther("0.001"),
    now + 10,
    60,
    ethers.utils.parseEther("1000000"),
    "QmYourIpfsHashHere"
  );
  const rec = await tx.wait();
  const tokenAddr = rec.events.find((e) => e.event === "TokenCreated").args
    .token;
  console.log("Token:", tokenAddr);

  // 4) Vault deposit
  await memeFactory.connect(alice).depositVault(tokenAddr, {
    value: ethers.utils.parseEther("0.02"),
  });
  console.log("Vault deposit done.");

  // 5) Fast-forward
  await ethers.provider.send("evm_increaseTime", [vaultWindow + 1]);
  await ethers.provider.send("evm_mine");
  console.log("⏱ Fast-forwarded");

  // 6) Buy & Sell (with ETH passed!)
  const oneCost = await memeFactory.costToBuy(
    tokenAddr,
    ethers.utils.parseEther("1")
  );
  await memeFactory
    .connect(alice)
    .buyToken(
      tokenAddr,
      ethers.utils.parseEther("1"),
      ethers.constants.HashZero,
      oneCost,
      { value: oneCost }
    );
  console.log("Bought 1 token");

  const tokenContract = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    tokenAddr
  );
  await tokenContract
    .connect(alice)
    .approve(memeFactory.address, ethers.utils.parseEther("1"));
  await memeFactory
    .connect(alice)
    .sellToken(tokenAddr, ethers.utils.parseEther("1"), 0);
  console.log("Sold 1 token");

  // 7) Withdraw fees
  const pFees = await memeFactory.platformFeesAccrued();
  const cFees = await memeFactory.creatorFeesAccrued(deployer.address);
  await deployer.sendTransaction({
    to: memeFactory.address,
    value: pFees.add(cFees),
  });
  await memeFactory.withdrawCreatorFees();
  await memeFactory.withdrawPlatformFees(deployer.address);
  console.log("Fees withdrawn");

  // 8) Fund factory for gas
  await deployer.sendTransaction({
    to: memeFactory.address,
    value: ethers.utils.parseEther("0.1"),
  });
  console.log("Factory funded with ETH for gas");

  // 9) Impersonate factory & top up deployer
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [memeFactory.address],
  });
  const factorySigner = await ethers.getSigner(memeFactory.address);
  await tokenContract
    .connect(factorySigner)
    .transfer(deployer.address, ethers.utils.parseEther("10"));
  console.log("Tokens transferred to deployer");
  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [memeFactory.address],
  });

  // 10) Test new UX features
  await testNewFeatures(memeFactory, tokenAddr, deployer, alice);

  // 11) Pool flows + analytics
  await testPoolFlows(memeFactory, tokenAddr, deployer, router, weth);
  await testAnalytics(memeFactory, tokenAddr, deployer, alice);

  console.log("🎉 All done!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
