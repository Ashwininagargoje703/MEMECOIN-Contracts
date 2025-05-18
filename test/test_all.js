const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MemeCoinFactory Core & Module Registration", function () {
  let deployer, alice, bob;
  let factory, whitelist, staking, airdrop, bridge, buyback;
  let tokenAddr, token;

  const SUPPLY = ethers.utils.parseUnits("1000", 18);
  const PRICE  = ethers.utils.parseEther("0.01");
  const IPFS   = "QmTestHash";

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();

    // 1) Deploy factory
    const Factory = await ethers.getContractFactory("MemeCoinFactory");
    factory = await Factory.deploy(ethers.constants.AddressZero, 200, 100);
    await factory.deployed();

    // 2) Deploy and register WhitelistPresale
    whitelist = await (await ethers.getContractFactory("WhitelistPresale"))
      .deploy(factory.address);
    await whitelist.deployed();
    await factory.setWhitelistModule(whitelist.address);

    // 3) Deploy and register StakingRewards (with a simple RewardToken)
    const Reward = await ethers.getContractFactory("RewardToken");
    const rewardToken = await Reward.deploy(
      ethers.utils.parseUnits("10000", 18)
    );
    await rewardToken.deployed();

    staking = await (await ethers.getContractFactory("StakingRewards"))
      .deploy(factory.address, rewardToken.address, rewardToken.address);
    await staking.deployed();
    await factory.setStakingModule(staking.address);

    // 4) Deploy and register AirdropMerkle
    airdrop = await (await ethers.getContractFactory("AirdropMerkle"))
      .deploy(factory.address, ethers.constants.HashZero);
    await airdrop.deployed();
    await factory.setAirdropModule(airdrop.address);

    // 5) Deploy and register BridgeAdapter (mock)
    const mockGas = await (await ethers.getContractFactory("MockGasService"))
      .deploy();
    const mockGate = await (await ethers.getContractFactory("MockGateway"))
      .deploy();
    bridge = await (await ethers.getContractFactory("BridgeAdapter"))
      .deploy(mockGas.address, mockGate.address);
    await bridge.deployed();
    await factory.setBridgeModule(bridge.address);

    // 6) Deploy and register BuybackBurn (mock router)
    const mockRouter = await (await ethers.getContractFactory("MockRouter"))
      .deploy();
    buyback = await (await ethers.getContractFactory("BuybackBurn"))
      .deploy(factory.address, mockRouter.address);
    await buyback.deployed();
    await factory.setBuybackModule(buyback.address);
  });

  it("creates & lists a new MemeCoin", async () => {
    await factory.createMemeCoin("TKN", "TKN", "desc", SUPPLY, PRICE, IPFS);

    const info = await factory.allTokens(0);
    expect(info.creator).to.equal(deployer.address);

    tokenAddr = info.token;
    token = await ethers.getContractAt("MemeCoin", tokenAddr);
    expect(await token.totalSupply()).to.equal(SUPPLY);
  });

  it("lets a user buy at fixed price", async () => {
    const amount = ethers.utils.parseUnits("10", 18);
    const cost   = PRICE.mul(amount).div(ethers.utils.parseUnits("1", 18));

    await factory.connect(alice).buyToken(tokenAddr, amount, bob.address, {
      value: cost,
    });
    expect(await token.balanceOf(alice.address)).to.equal(amount);
  });

  it("has all modules correctly registered", async () => {
    expect(await factory.whitelistModule()).to.equal(whitelist.address);
    expect(await factory.stakingModule()).to.equal(staking.address);
    expect(await factory.airdropModule()).to.equal(airdrop.address);
    expect(await factory.bridgeModule()).to.equal(bridge.address);
    expect(await factory.buybackModule()).to.equal(buyback.address);
  });
});
