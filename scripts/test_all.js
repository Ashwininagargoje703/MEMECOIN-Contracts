// test/test_all.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("End-to-End: MemeCoinFactory + Modules", function () {
  let deployer, user, referrer;
  let factory;
  let whitelist, dexHelper, staking, airdrop, bridge, buyback;
  let rewardToken;
  let tokenAddr, token;

  const INITIAL_SUPPLY = ethers.utils.parseUnits("1000", 18);
  const PRICE = ethers.utils.parseEther("0.01");
  const IPFS = "QmTestHash";

  before(async () => {
    [deployer, user, referrer] = await ethers.getSigners();

    // --- 1) Deploy Factory ---
    const Factory = await ethers.getContractFactory("MemeCoinFactory");
    factory = await Factory.deploy(
      ethers.constants.AddressZero, // no trusted forwarder in tests
      200, // 2%
      100  // 1%
    );
    await factory.deployed();

    // --- 2) Deploy & register WhitelistPresale ---
    const Whitelist = await ethers.getContractFactory("WhitelistPresale");
    whitelist = await Whitelist.deploy(factory.address);
    await whitelist.deployed();
    await factory.setWhitelistModule(whitelist.address);

    // --- 3) Deploy & register UniswapV3Helper ---
    const V3Helper = await ethers.getContractFactory("UniswapV3Helper");
    // use position manager address zero for now (we won't mint)
    dexHelper = await V3Helper.deploy(ethers.constants.AddressZero);
    await dexHelper.deployed();
    await factory.setV3Helper(dexHelper.address);

    // --- 4) Deploy RewardToken & StakingRewards ---
    const Reward = await ethers.getContractFactory("RewardToken");
    rewardToken = await Reward.deploy(ethers.utils.parseUnits("10000", 18));
    await rewardToken.deployed();

    const Staking = await ethers.getContractFactory("StakingRewards");
    staking = await Staking.deploy(factory.address, rewardToken.address, rewardToken.address);
    await staking.deployed();
    await factory.setStakingModule(staking.address);

    // --- 5) Deploy & register AirdropMerkle ---
    const Airdrop = await ethers.getContractFactory("AirdropMerkle");
    // initial root = zero
    airdrop = await Airdrop.deploy(factory.address, ethers.constants.HashZero);
    await airdrop.deployed();
    await factory.setAirdropModule(airdrop.address);

    // --- 6) Deploy mocks for BridgeAdapter ---
    const MockGas = await ethers.getContractFactory("MockGasService");
    const mockGas = await MockGas.deploy();
    await mockGas.deployed();
    const MockGate = await ethers.getContractFactory("MockGateway");
    const mockGate = await MockGate.deploy();
    await mockGate.deployed();
    const Bridge = await ethers.getContractFactory("BridgeAdapter");
    bridge = await Bridge.deploy(mockGas.address, mockGate.address);
    await bridge.deployed();
    await factory.setBridgeModule(bridge.address);

    // --- 7) Deploy & register BuybackBurn ---
    const MockRouter = await ethers.getContractFactory("MockRouter");
    const mockRouter = await MockRouter.deploy();
    await mockRouter.deployed();
    const Buyback = await ethers.getContractFactory("BuybackBurn");
    buyback = await Buyback.deploy(factory.address, mockRouter.address);
    await buyback.deployed();
    await factory.setBuybackModule(buyback.address);
  });

  it("should create a new MemeCoin and list it", async () => {
    await expect(factory.createMemeCoin(
      "TestToken","TT","A test", INITIAL_SUPPLY, PRICE, IPFS
    )).to.emit(factory, "TokenCreated");

    tokenAddr = (await factory.allTokens(0)).token;
    token = await ethers.getContractAt("MemeCoin", tokenAddr);
    expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
  });

  it("should allow buying fixed-price tokens", async () => {
    const amount = ethers.utils.parseUnits("10", 18);
    await expect(
      factory.connect(user).buyToken(tokenAddr, amount, referrer.address, { value: PRICE.mul(amount).div(ethers.utils.parseUnits("1",18)) })
    ).to.emit(factory, "Bought").withArgs(tokenAddr, user.address, amount);
    expect(await token.balanceOf(user.address)).to.equal(amount);
  });

  it("should whitelist and buy via presale", async () => {
    // on-chain whitelist
    await whitelist.whitelistUsers(tokenAddr, [user.address]);
    const amount = ethers.utils.parseUnits("5", 18);
    await expect(
      factory.connect(user).buyPresale(tokenAddr, amount, 0, ethers.constants.AddressZero, [])
    ).to.emit(whitelist, "PresalePurchase");
  });

  it("should allow staking and reward claims", async () => {
    // give user some reward tokens to distribute
    await rewardToken.mint(staking.address, ethers.utils.parseUnits("500",18));
    // user stakes their TT
    await token.connect(user).approve(staking.address, ethers.utils.parseUnits("5",18));
    await staking.connect(user).stake(ethers.utils.parseUnits("5",18));
    // advance time & distribute
    await ethers.provider.send("evm_increaseTime",[3600]);
    await ethers.provider.send("evm_mine");
    await staking.connect(user).getReward();
    expect(await rewardToken.balanceOf(user.address)).to.be.gt(0);
  });

  it("should allow airdrop claims via Merkle", async () => {
    // set a dummy Merkle root containing (user, 100)
    const leaf = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["address","uint256"],[user.address,100]));
    await airdrop.setPresaleRoot(leaf);
    // create proof = [leaf] for simplicity
    await expect(
      airdrop.connect(user).claim(100, [leaf])
    ).to.emit(airdrop, "Claimed").withArgs(user.address, 100);
  });

  it("should allow bridgeToken calls via adapter", async () => {
    await expect(
      bridge.connect(user).bridgeToken("chain","dest", tokenAddr, 1, { value: 0 })
    ).to.not.be.reverted;
  });

  it("should allow buybackAndBurn calls via adapter", async () => {
    await expect(
      buyback.connect(user).buyAndBurn(0, [tokenAddr])
    ).to.not.be.reverted;
  });
});
