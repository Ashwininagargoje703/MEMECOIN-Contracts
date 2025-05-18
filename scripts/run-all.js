// scripts/run-all.js
const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

async function main() {
  const [deployer, alice, bob] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // ─── 1) Deploy MemeCoinFactory ─────────────────
  const Factory = await ethers.getContractFactory("MemeCoinFactory");
  const factory = await Factory.deploy(
    ethers.constants.AddressZero,            // forwarder (no meta-tx)
    200,                                     // platformFeeBP = 2%
    100,                                     // referralFeeBP = 1%
    ethers.utils.parseEther("0.01"),         // basePrice
    ethers.utils.parseEther("0.000001"),     // slope
    ethers.constants.AddressZero,            // positionManager (use real address in prod)
    ethers.constants.AddressZero             // v2Factory       (use real address in prod)
  );
  await factory.deployed();
  console.log("Factory:", factory.address);

  // ─── 2) WhitelistPresale ──────────────────────
  const Whitelist = await ethers.getContractFactory("WhitelistPresale");
  const whitelist = await Whitelist.deploy(factory.address);
  await whitelist.deployed();
  await factory.setWhitelistModule(whitelist.address);

  // ─── 3) Disable UniswapV3Helper ───────────────
  await factory.setV3Helper(ethers.constants.AddressZero);

  // ─── 4) Deploy RewardToken ───────────────────
  const Reward = await ethers.getContractFactory("RewardToken");
  const rewardToken = await Reward.deploy(ethers.utils.parseUnits("20000", 18));
  await rewardToken.deployed();
  console.log("RewardToken:", rewardToken.address);

  // ─── 5) Deploy AirdropMerkle ──────────────────
  const Airdrop = await ethers.getContractFactory("AirdropMerkle");
  const airdrop = await Airdrop.deploy(rewardToken.address, ethers.constants.HashZero);
  await airdrop.deployed();
  await factory.setAirdropModule(airdrop.address);
  console.log("AirdropMerkle:", airdrop.address);

  // ─── 6) Deploy BridgeAdapter ──────────────────
  const mockGas  = await (await ethers.getContractFactory("MockGasService")).deploy();
  const mockGate = await (await ethers.getContractFactory("MockGateway")).deploy();
  const bridge   = await (await ethers.getContractFactory("BridgeAdapter"))
                        .deploy(mockGas.address, mockGate.address);
  await bridge.deployed();
  await factory.setBridgeModule(bridge.address);
  console.log("BridgeAdapter:", bridge.address);

  // ─── 7) Create DemoToken ───────────────────────
  const SUPPLY = ethers.utils.parseUnits("1000", 18);
  const txC    = await factory.createMemeCoin(
    "DemoToken","DMT","demo token",
    SUPPLY,
    ethers.utils.parseEther("0.01"),  // legacy, ignored by curve
    "QmTestHash"
  );
  const rc       = await txC.wait();
  const tokenAddr = rc.events.find(e => e.event === "TokenCreated").args.token;
  const token     = await ethers.getContractAt("MemeCoin", tokenAddr);
  console.log("DemoToken:", token.address);

  // seed factory
  let bal = await token.balanceOf(factory.address);
  if (bal.lt(SUPPLY)) {
    await token.transfer(factory.address, SUPPLY.sub(bal));
  }

  // ─── 8) Deploy StakingRewards ─────────────────
  const Staking = await ethers.getContractFactory("StakingRewards");
  const staking = await Staking.deploy(
    token.address,
    rewardToken.address,
    ethers.utils.parseUnits("0.1", 18)
  );
  await staking.deployed();
  await factory.setStakingModule(staking.address);
  console.log("StakingRewards:", staking.address);

  // fund staking & airdrop
  await rewardToken.transfer(staking.address, ethers.utils.parseUnits("10000", 18));
  await rewardToken.transfer(airdrop.address,  ethers.utils.parseUnits("1000", 18));

  // ─── 9) Alice buys 10 DMT via bonding curve ─────────────────
  const units        = ethers.BigNumber.from(10);
  const amountAtomic = ethers.utils.parseUnits("10", 18);
  const ts           = await factory.totalSold();
  const basePrice    = ethers.utils.parseEther("0.01");
  const slope        = ethers.utils.parseEther("0.000001");
  const cost         = basePrice.mul(units)
    .add(slope.mul(ts.mul(units).add(units.mul(units.sub(1)).div(2))));

  console.log("Alice buying 10 DMT for", cost.toString(), "wei");
  await factory.connect(alice).buyToken(token.address, amountAtomic, bob.address, { value: cost });
  console.log("Alice DMT balance:", (await token.balanceOf(alice.address)).toString());

  // ─── 10) Stake & partial withdraw ─────────────────
  await token.connect(alice).approve(staking.address, amountAtomic);
  await staking.connect(alice).stake(amountAtomic);
  console.log("Alice staked 10 DMT");

  const withdrawAmt = ethers.utils.parseUnits("5", 18);
  await staking.connect(alice).withdraw(withdrawAmt);
  console.log("Alice withdrew 5 DMT");

  await ethers.provider.send("evm_increaseTime", [3600]);
  await ethers.provider.send("evm_mine", []);
  await staking.connect(alice).getReward();
  console.log("Alice RewardToken balance:", (await rewardToken.balanceOf(alice.address)).toString());

  // ─── 11) Airdrop ─────────────────────────────
  console.log("\n--- Airdrop Flow ---");
  const claims = [{ address: alice.address, amount: 25 }];
  const leaves = claims.map(c => keccak256(
    Buffer.from(
      ethers.utils.solidityPack(["address","uint256"], [c.address,c.amount]).slice(2),
      "hex"
    )
  ));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();
  console.log("Merkle Root:", root);
  await airdrop.setMerkleRoot(root);
  const proof = tree.getHexProof(leaves[0]);
  await airdrop.connect(alice).claim(25, proof);
  console.log("Alice DMT after airdrop:", (await token.balanceOf(alice.address)).toString());

  // ─── 12) Bridge ──────────────────────────────
  await bridge.connect(alice).forwardWithToken(
    "ChainA","RecipientAddress",ethers.utils.toUtf8Bytes(""),token.address,1,{ value: 0 }
  );
  console.log("BridgeAdapter.forwardWithToken succeeded");

  // ─── 13) Deploy & fund MockRouter then BuybackBurn ──────────────────
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const mockRouter = await MockRouter.deploy(token.address);
  await mockRouter.deployed();
  await token.connect(alice).transfer(mockRouter.address, ethers.utils.parseUnits("1", 18));

  const Buyback = await ethers.getContractFactory("BuybackBurn");
  const buyback  = await Buyback.deploy(token.address, mockRouter.address);
  await buyback.deployed();
  await factory.setBuybackModule(buyback.address);
  console.log("BuybackBurn:", buyback.address);

  console.log("\n--- Buyback & Burn ---");
  const burnAmt = ethers.utils.parseEther("0.01");
  const path    = [ await mockRouter.WETH(), token.address ];
  try {
    const estimate = await buyback.connect(alice).estimateGas.buyAndBurn(0, path, { value: burnAmt });
    const tx = await buyback.connect(alice).buyAndBurn(0, path, { value: burnAmt, gasLimit: estimate.mul(120).div(100) });
    await tx.wait();
    console.log("✅ buyAndBurn succeeded");
  } catch (err) {
    console.error("❌ buyAndBurn failed:", err.error?.message || err);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
