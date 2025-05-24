// hardhat.config.js
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan"); 
require("hardhat-contract-sizer");
require("dotenv").config();

const makeNetwork = (envVar) => {
  if (!process.env[envVar]) return undefined;
  return {
    url: process.env[envVar],
    accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
  };
};

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
             metadata: { bytecodeHash: "none" }        // ← strip the metadata hash
        }
      },
      { version: "0.6.6" },   // for UniswapV2Router02
      { version: "0.5.16" }   // for UniswapV2Factory & Pair
    ],
    overrides: {
      // Only override the actual Uniswap contracts in node_modules:
      "node_modules/@uniswap/v2-core/contracts/UniswapV2Factory.sol":           { version: "0.5.16" },
      "node_modules/@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol":  { version: "0.5.16" },
      "node_modules/@uniswap/v2-periphery/contracts/UniswapV2Router02.sol":     { version: "0.6.6" }
    }
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    },
    localhost: {
      url: process.env.LOCALHOST_URL || "http://127.0.0.1:8545",
      allowUnlimitedContractSize: true
    },
    ...(makeNetwork("TESTNET_URL") && { sepolia: makeNetwork("TESTNET_URL") }),
    ...(makeNetwork("MAINNET_URL") && { mainnet: makeNetwork("MAINNET_URL") }),
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ""
  },
  contractSizer: {
    runOnCompile: true,
    only: [ "MemeCoinFactory" ]
  }
};
