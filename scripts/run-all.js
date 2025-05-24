// scripts/run-all.js
const { ethers } = require("hardhat");

async function deployUniswapV2() {
  const WETH9   = await ethers.getContractFactory("WETH9");
  const weth    = await WETH9.deploy();
  await weth.deployed();
  console.log("WETH9 deployed to:", weth.address);

  const Factory = await ethers.getContractFactory("UniswapV2Factory");
  const factory = await Factory.deploy((await ethers.getSigners())[0].address);
  await factory.deployed();
  console.log("UniswapFactory:", factory.address);

  const Router  = await ethers.getContractFactory("UniswapV2Router02");
  const router  = await Router.deploy(factory.address, weth.address);
  await router.deployed();
  console.log("Router:", router.address);

  return { weth, factory, router };
}

async function main() {
  const [deployer, alice] = await ethers.getSigners();

  // 1) Deploy local Uniswap V2
  const { weth, factory: uniFactory, router } = await deployUniswapV2();

  // 2) Deploy MemeCoinFactory
  const platformFeeBP = 200;  // 2%
  const referralFeeBP = 50;   // 0.5%
  const MemeCoinFactory = await ethers.getContractFactory("MemeCoinFactory");
  const memeFactory = await MemeCoinFactory.deploy(
    platformFeeBP,
    referralFeeBP,
    uniFactory.address,
    router.address
  );
  await memeFactory.deployed();
  console.log("MemeCoinFactory:", memeFactory.address);

  // 3) createMemeCoin parameters
  const now         = (await ethers.provider.getBlock()).timestamp;
  const params = {
    name:        "DemoToken",
    symbol:      "DMT",
    launchMode:  0,
    preMintCap:  1_000_000,
    curveType:   0,
    basePrice:   ethers.utils.parseEther("0.01"),
    slope:       ethers.utils.parseEther("0.005"),
    exponent:    0,
    stepSize:    1,
    fundingGoal: ethers.utils.parseEther("0.05"),
    startFeeBP:  100,
    endFeeBP:    300,
    feeStart:    now,
    feeEnd:      now + 3600,
    vaultEnd:    0,
    vestAmount:  ethers.utils.parseEther("1000"),
    vestStart:   now + 60,
    vestDur:     86400,
    totalSupply: ethers.utils.parseEther("1000000"),
    ipfsHash:    "QmYourIpfsHashHere"
  };

  // 4) createMemeCoin
  const txCreate = await memeFactory.createMemeCoin(
    params.name,
    params.symbol,
    params.launchMode,
    params.preMintCap,
    params.curveType,
    params.basePrice,
    params.slope,
    params.exponent,
    params.stepSize,
    params.fundingGoal,
    params.startFeeBP,
    params.endFeeBP,
    params.feeStart,
    params.feeEnd,
    params.vaultEnd,
    params.vestAmount,
    params.vestStart,
    params.vestDur,
    params.totalSupply,
    params.ipfsHash
  );
  const receipt   = await txCreate.wait();
  const tokenAddr = receipt.events.find(e => e.event === "TokenCreated").args.token;
  console.log("Demo Token:", tokenAddr);

  // 5) BUY 1 token (auto‐pool)
  const one         = ethers.utils.parseEther("1");
  const costToBuy1  = await memeFactory.costToBuy(tokenAddr, one);
  console.log(`\n⏳ Buying 1 token for ${ethers.utils.formatEther(costToBuy1)} ETH…`);
  await memeFactory.connect(alice).buyToken(tokenAddr, one, ethers.constants.AddressZero, { value: costToBuy1 });
  console.log("✅ Bought 1 token");

  // 6) Inspect auto-pool pair
  const pair = await uniFactory.getPair(tokenAddr, weth.address);
  console.log("Auto-pool pair:", pair);

  // 7) Check Alice’s balance
  const token   = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    tokenAddr
  );
  let aliceBal  = await token.balanceOf(alice.address);
  console.log("Alice token balance:", ethers.utils.formatUnits(aliceBal, 18));

  // 8) SELL 1 token
  console.log("\n⏳ Selling 1 token back…");
  await token.connect(alice).approve(memeFactory.address, one);
  await memeFactory.connect(alice).sellToken(tokenAddr, one);
  console.log("✅ Sold 1 token");

  // 9) Final balances & fee accruals
  aliceBal        = await token.balanceOf(alice.address);
  const platformFees = await memeFactory.platformFeesAccrued();
  const creatorFees  = await memeFactory.creatorFeesAccrued(deployer.address);
  console.log("Alice balance after sell:", ethers.utils.formatUnits(aliceBal, 18));
  console.log("Platform fees accrued:", ethers.utils.formatEther(platformFees));
  console.log("Creator fees accrued: ", ethers.utils.formatEther(creatorFees));

  // 10) Fund factory so withdraws can succeed
  const totalToFund = platformFees.add(creatorFees);
  console.log(`\n⏳ Funding factory with ${ethers.utils.formatEther(totalToFund)} ETH…`);
  await deployer.sendTransaction({ to: memeFactory.address, value: totalToFund });

  // 11) Withdraw creator & platform fees
  await memeFactory.withdrawCreatorFees();
  await memeFactory.withdrawPlatformFees(deployer.address);
  console.log("✅ Withdrawals complete");

  // ── READ-VIEW FUNCTIONS ───────────────────────────────────────
  console.log("\n=== READ-VIEW FUNCTIONS ===");
  console.log("platformFeeBP:", (await memeFactory.platformFeeBP()).toString());
  console.log("referralFeeBP:", (await memeFactory.referralFeeBP()).toString());
  console.log("POOL_CREATION_FEE:", ethers.utils.formatEther(await memeFactory.POOL_CREATION_FEE()), "ETH");
  console.log("v2Factory:", await memeFactory.v2Factory());
  console.log("router:", await memeFactory.router());
  console.log("WETH:", await memeFactory.WETH());

  // TokenInfo[0]
  const t0 = await memeFactory.allTokens(0);
  console.log("allTokens[0]:", {
    token: t0.token,
    creator: t0.creator,
    launchMode: t0.launchMode.toString(),
    preMintCap: t0.preMintCap.toString(),
    active: t0.active,
    vaultEnd: t0.vaultEnd.toString()
  });

  console.log("tokenIndexPlusOne:", (await memeFactory.tokenIndexPlusOne(tokenAddr)).toString());

  // CurveInfo for our token
  const c = await memeFactory.curves(tokenAddr);
  console.log("curves[token]:", {
    curveType:      c.curveType.toString(),
    basePrice:      ethers.utils.formatEther(c.basePrice),
    slope:          ethers.utils.formatEther(c.slope),
    exponent:       c.exponent.toString(),
    stepSize:       c.stepSize.toString(),
    totalSold:      c.totalSold.toString(),
    fundingGoal:    ethers.utils.formatEther(c.fundingGoal),
    poolCreated:    c.poolCreated,
    startFeeBP:     c.startFeeBP.toString(),
    endFeeBP:       c.endFeeBP.toString(),
    feeChangeStart: c.feeChangeStart.toString(),
    feeChangeEnd:   c.feeChangeEnd.toString()
  });

  // Vaults
  console.log("vaultDeposits(alice):", (await memeFactory.vaultDeposits(tokenAddr, alice.address)).toString());
  console.log("vaultTotal:", (await memeFactory.vaultTotal(tokenAddr)).toString());
  console.log("vaultReleased:", await memeFactory.vaultReleased(tokenAddr));

  // Modules
  console.log("whitelistModule:", await memeFactory.whitelistModule());
  console.log("stakingModule:", await memeFactory.stakingModule());
  console.log("airdropModule:", await memeFactory.airdropModule());

  // Pricing helpers
  console.log("currentPrice:", ethers.utils.formatEther(await memeFactory.currentPrice(tokenAddr)), "ETH");
  console.log("costToBuy(5):", ethers.utils.formatEther(await memeFactory.costToBuy(tokenAddr, ethers.utils.parseEther("5"))), "ETH");

  console.log("\n🎉 All read/view calls complete!");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
