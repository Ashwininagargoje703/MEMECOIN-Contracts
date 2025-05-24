// test/MemeCoinFactory.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MemeCoinFactory end-to-end", function () {
  let deployer, alice;
  let WETH9, UniswapFactory, UniswapRouter;
  let weth, factory, router;
  let MemeCoinFactory, memeFactory;
  let tokenAddr, token;

  before(async () => {
    [deployer, alice] = await ethers.getSigners();

    // Deploy Uniswap V2
    WETH9 = await ethers.getContractFactory("WETH9");
    weth = await WETH9.deploy();
    await weth.deployed();

    UniswapFactory = await ethers.getContractFactory("UniswapV2Factory");
    factory = await UniswapFactory.deploy(deployer.address);
    await factory.deployed();

    UniswapRouter = await ethers.getContractFactory("UniswapV2Router02");
    router = await UniswapRouter.deploy(factory.address, weth.address);
    await router.deployed();

    // Deploy MemeCoinFactory
    MemeCoinFactory = await ethers.getContractFactory("MemeCoinFactory");
    memeFactory = await MemeCoinFactory.deploy(
      200, // platformFeeBP
      50,  // referralFeeBP
      factory.address,
      router.address
    );
    await memeFactory.deployed();
  });

  it("should have correct initial parameters", async () => {
    expect(await memeFactory.platformFeeBP()).to.equal(200);
    expect(await memeFactory.referralFeeBP()).to.equal(50);
  });

  it("should create a new MemeCoin and vesting contract", async () => {
    const now = (await ethers.provider.getBlock()).timestamp;
    const tx = await memeFactory.createMemeCoin(
      "TestToken",
      "TTK",
      0,
      1000,
      0,
      ethers.utils.parseEther("0.01"),
      ethers.utils.parseEther("0.001"),
      0,
      1,
      ethers.utils.parseEther("0.05"),
      50,
      100,
      now,
      now + 3600,
      0,
      ethers.utils.parseEther("100"),
      now + 10,
      1000,
      ethers.utils.parseEther("10000"),
      "QmTestHash"
    );
    const receipt = await tx.wait();
    const evt = receipt.events.find(e => e.event === "TokenCreated");
    tokenAddr = evt.args.token;
    expect(tokenAddr).to.properAddress;

    token = await ethers.getContractAt(
      "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
      tokenAddr
    );
  });

  it("should return correct pricing functions", async () => {
    const price0 = await memeFactory.currentPrice(tokenAddr);
    expect(price0).to.equal(ethers.utils.parseEther("0.01"));

    const cost1 = await memeFactory.costToBuy(tokenAddr, ethers.utils.parseEther("1"));
    expect(cost1).to.equal(price0);
  });

  it("should allow buy and sell operations", async () => {
    const one = ethers.utils.parseEther("1");
    const cost = await memeFactory.costToBuy(tokenAddr, one);

    // buy
    await memeFactory.connect(alice).buyToken(tokenAddr, one, ethers.constants.AddressZero, { value: cost });
    expect(await token.balanceOf(alice.address)).to.equal(one);

    // sell
    await token.connect(alice).approve(memeFactory.address, one);
    await memeFactory.connect(alice).sellToken(tokenAddr, one);
    expect(await token.balanceOf(alice.address)).to.equal(0);
  });

  it("should accrue and allow withdrawals of fees", async () => {
    const one = ethers.utils.parseEther("1");
    const cost = await memeFactory.costToBuy(tokenAddr, one);
    // fund factory
    await deployer.sendTransaction({ to: memeFactory.address, value: cost });

    // accrue fees by buying
    await memeFactory.connect(alice).buyToken(tokenAddr, one, ethers.constants.AddressZero, { value: cost });

    const pf = await memeFactory.platformFeesAccrued();
    const cf = await memeFactory.creatorFeesAccrued(deployer.address);
    expect(pf).to.be.gt(0);
    expect(cf).to.be.gt(0);

    // fund to cover withdraws
    const total = pf.add(cf);
    await deployer.sendTransaction({ to: memeFactory.address, value: total });

    // withdraw creator fees
    const balC_before = await ethers.provider.getBalance(memeFactory.address);
    await memeFactory.withdrawCreatorFees();
    const balC_after  = await ethers.provider.getBalance(memeFactory.address);
    expect(balC_before.sub(balC_after)).to.equal(cf);

    // withdraw platform fees
    const balP_before = await ethers.provider.getBalance(memeFactory.address);
    await memeFactory.withdrawPlatformFees(deployer.address);
    const balP_after  = await ethers.provider.getBalance(memeFactory.address);
    expect(balP_before.sub(balP_after)).to.equal(pf);
  });
});
