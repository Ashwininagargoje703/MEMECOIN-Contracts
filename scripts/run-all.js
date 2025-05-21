// scripts/run-all.js
// ──────────────────────────────
// Usage: npx hardhat run scripts/run-all.js [--network <network>]

require("dotenv").config();
const hre = require("hardhat");
const { ethers, network } = hre;

async function main() {
  console.log("⛓ Running on network:", network.name,"\n");

  const [deployer] = await ethers.getSigners();
  console.log("1) Deployer:", deployer.address,"\n");

  // 2) Deploy WETH9
  console.log("2) Deploying WETH9…");
  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth  = await WETH9.deploy();
  await weth.deployed();
  console.log("   ↳", weth.address,"\n");

  // 3) Deploy UniswapV2Factory
  console.log("3) Deploying UniswapV2Factory…");
  const UV2F = await ethers.getContractFactory(
    "@uniswap/v2-core/contracts/UniswapV2Factory.sol:UniswapV2Factory"
  );
  const uniFactory = await UV2F.deploy(deployer.address);
  await uniFactory.deployed();
  console.log("   ↳", uniFactory.address,"\n");

  // 4) Attach Router
  console.log("4) Attaching Router…");
  const ROUTER = process.env.UNISWAP_V2_ROUTER ||
    "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const router = await ethers.getContractAt(
    "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol:IUniswapV2Router02",
    ROUTER
  );
  console.log("   ↳", ROUTER,"\n");

  // 5) Deploy MemeCoinFactory (V2-only)
  console.log("5) Deploying MemeCoinFactory…");
  const MCF = await ethers.getContractFactory("MemeCoinFactory");
  const factory = await MCF.deploy(
    ethers.constants.AddressZero,         // forwarder
    200,                                  // platformFeeBP = 2%
    100,                                  // referralFeeBP = 1%
    ethers.utils.parseEther("0.01"),      // basePrice
    ethers.utils.parseEther("0.000001"),  // slope
    uniFactory.address                    // UniswapV2Factory
  );
  await factory.deployed();
  console.log("   ↳", factory.address,"\n");

  // 6) Deploy & wire WhitelistPresale
  console.log("6) Deploying WhitelistPresale…");
  const WP = await ethers.getContractFactory("WhitelistPresale");
  const presale = await WP.deploy(factory.address);
  await presale.deployed();
  await factory.setWhitelistModule(presale.address);
  console.log("   ↳", presale.address,"\n");

  // 7) Mint DemoToken
  console.log("7) Minting DemoToken…");
  const SUPPLY = ethers.utils.parseUnits("1000", 18);
  const txMint = await factory.createMemeCoin(
    "DemoToken","DMT","Demo token",
    SUPPLY,
    ethers.utils.parseEther("0.01"),
    "QmTestHash"
  );
  const rcMint = await txMint.wait();
  const tokenAddr = rcMint.events.find(e=>e.event==="TokenCreated").args.token;
  console.log("   ↳ Token at", tokenAddr,"\n");
  const token = await ethers.getContractAt("MemeCoin", tokenAddr);

  // 8) Whitelist EOA for presale (and wait for it!)
  console.log("8) Whitelisting for presale…");
  const txWL = await presale.whitelistUsers(tokenAddr, [deployer.address]);
  await txWL.wait();
  console.log("   ↳ isWhitelisted:",
    await presale.isWhitelisted(tokenAddr, deployer.address),"\n"
  );

  // 9) Buy via presale
  console.log("9) Buying via presale…");
  const presaleAmt   = ethers.utils.parseUnits("1", 18);
  const presalePrice = await factory.currentPrice();
  const txPre = await presale.buyPresale(
    tokenAddr, presaleAmt, presaleAmt,
    ethers.constants.AddressZero,
    [], { value: presalePrice }
  );
  await txPre.wait();
  console.log("   ↳ balance after presale:",
    (await token.balanceOf(deployer.address)).toString(),"\n"
  );

  // 10) Bonding-curve buy of 2 tokens
  console.log("10) Buying 2 tokens via bonding curve…");
  const buyCount = ethers.BigNumber.from(2);
  const baseP    = await factory.basePrice();
  const slope    = await factory.slope();
  const ts       = await factory.totalSold(); // currently 1
  const term1    = baseP.mul(buyCount);
  const term2    = slope.mul(
    ts.mul(buyCount)
    .add(buyCount.mul(buyCount.sub(1)).div(2))
  );
  const cost     = term1.add(term2);
  console.log("    ↳ cost =", ethers.utils.formatEther(cost), "ETH");
  const txBuy = await factory.buyToken(
    tokenAddr,
    buyCount.mul(ethers.constants.WeiPerEther), // 2*1e18
    ethers.constants.AddressZero,
    { value: cost }
  );
  await txBuy.wait();
  console.log("   ↳ balance after buyToken:",
    (await token.balanceOf(deployer.address)).toString(),"\n"
  );

  // 11) Create V2 Pool
  console.log("11) Creating V2 pool…");
  const txPool = await factory.createV2Pool(
    tokenAddr, weth.address,
    { value: ethers.utils.parseEther("0.002") }
  );
  const rcPool = await txPool.wait();
  const pairAddr = rcPool.events.find(e=>e.event==="V2PairCreated").args.pair;
  console.log("   ↳ pool at", pairAddr,"\n");

  // 12) Add Liquidity
  console.log("12) Adding liquidity 100 DMT + 1 WETH…");
  await weth.deposit({ value: ethers.utils.parseEther("1") });
  await token.approve(router.address, ethers.utils.parseUnits("100", 18));
  await weth.approve(router.address, ethers.utils.parseEther("1"));
  const deadline = Math.floor(Date.now()/1000) + 600;
  const txAdd    = await router.addLiquidity(
    tokenAddr, weth.address,
    ethers.utils.parseUnits("100", 18), ethers.utils.parseEther("1"),
    0, 0, deployer.address, deadline
  );
  await txAdd.wait();
  console.log("   ↳ liquidity added\n");

  // 13) Remove Liquidity
  console.log("13) Removing liquidity…");
  const pair = await ethers.getContractAt(
    "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol:IUniswapV2Pair",
    pairAddr
  );
  const lp     = await pair.balanceOf(deployer.address);
  const txRm   = await router.removeLiquidity(
    tokenAddr, weth.address,
    lp, 0, 0, deployer.address, deadline
  );
  await txRm.wait();
  console.log("   ↳ liquidity removed\n");

  console.log("✅ All features tested!");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
