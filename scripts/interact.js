// scripts/interact.js
require('dotenv').config();
const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Using deployer:', deployer.address);

  // Replace with your deployed factory address
  const FACTORY_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const factory = await ethers.getContractAt('MemeCoinFactory', FACTORY_ADDRESS, deployer);

  // 1) Check total tokens
  const totalBefore = await factory.totalTokens();
  console.log('Total tokens before:', totalBefore.toString());

  // 2) Create a new token
  const txCreate = await factory.createMemeCoin(
    'LocalToken',
    'LTK',
    'Local test token',
    ethers.utils.parseUnits('1000', 18),   // supply
    ethers.utils.parseUnits('0.005', 18),  // price
    'QmLocalCID'
  );
  const receiptCreate = await txCreate.wait();
  console.log('✅ createMemeCoin mined in tx:', receiptCreate.transactionHash);

  // 3) Confirm new total and get token address
  const totalAfter = await factory.totalTokens();
  console.log('Total tokens after:', totalAfter.toString());
  const [tokenAddr] = await factory.getTokenDetails(0);
  console.log('Token address:', tokenAddr);

  // 4) Attach to the ERC20
  const token = await ethers.getContractAt('IERC20', tokenAddr, deployer);

  // 5) Buy 10 LTK
  const amount = ethers.utils.parseUnits('10', 18);
  const pricePer = await factory.priceOf(tokenAddr);
  const totalCost = pricePer.mul(amount).div(ethers.constants.WeiPerEther);
  console.log('Buying 10 tokens for:', ethers.utils.formatEther(totalCost), 'ETH');

  const txBuy = await factory.buyToken(
    tokenAddr,
    amount,
    ethers.constants.AddressZero,
    { value: totalCost, gasPrice: ethers.utils.parseUnits('5', 'gwei') }
  );
  const receiptBuy = await txBuy.wait();
  console.log('✅ buyToken mined in tx:', receiptBuy.transactionHash);

  // 6) Check balance
  const balance = await token.balanceOf(deployer.address);
  console.log('Final LTK balance:', ethers.utils.formatUnits(balance, 18));
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Script error:', err);
    process.exit(1);
  });
