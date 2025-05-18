// scripts/deploy-mocks-and-buyback.js
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1) Deploy MockGasService
  const MockGas = await ethers.getContractFactory("MockGasService");
  const mockGas = await MockGas.deploy();
  await mockGas.deployed();
  console.log("mockGas:", mockGas.address);

  // 2) Deploy MockGateway
  const MockGate = await ethers.getContractFactory("MockGateway");
  const mockGate = await MockGate.deploy();
  await mockGate.deployed();
  console.log("mockGate:", mockGate.address);

  // 3) Deploy MockRouter (Uniswap‐router mock)
  const MockRouter = await ethers.getContractFactory("MockRouter");
  // Note: MockRouter constructor takes the token address; replace TOKEN_ADDR with your DemoToken
  const TOKEN_ADDR = "0xD5a0e4EA3F25f7027B2156372085093EAb1774C1";
  const mockRouter = await MockRouter.deploy(TOKEN_ADDR);
  await mockRouter.deployed();
  console.log("mockRouter:", mockRouter.address);

  // 4) Deploy BuybackBurn
  const Buyback = await ethers.getContractFactory("BuybackBurn");
  // constructor(args): (token_, router_)
  const buyback = await Buyback.deploy(TOKEN_ADDR, mockRouter.address);
  await buyback.deployed();
  console.log("buybackBurn:", buyback.address);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
