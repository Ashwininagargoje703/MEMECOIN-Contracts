// test/sample-test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MemeCoinFactory end-to-end", function () {
  let factory, owner, user;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MemeCoinFactory");
    factory = await Factory.deploy(200, 100);
    await factory.deployed();
  });

  it("creates a token and allows a buy", async () => {
    const totalSupply   = ethers.utils.parseUnits("1000", 18);
    
    const pricePerToken = ethers.utils.parseEther("0.01");

    // Deploy with description
    await (
      await factory.createMemeCoin(
        "TestCoin",              // name
        "TCC",                   // symbol
        "This is a test token",  // description
        totalSupply,
        pricePerToken,
        "QmHash"                 // IPFS hash
      )
    ).wait();

    const { token: tokenAddr } = await factory.allTokens(0);

    const buyAmount = ethers.utils.parseUnits("10", 18);
    const totalCost = pricePerToken.mul(buyAmount).div(ethers.utils.parseUnits("1", 18));

    await factory.connect(user).buyToken(
      tokenAddr,
      buyAmount,
      ethers.constants.AddressZero,
      { value: totalCost }
    );

    const Token = await ethers.getContractAt("MemeCoin", tokenAddr);
    const userBal = await Token.balanceOf(user.address);
    expect(userBal).to.equal(buyAmount);
  });
});
