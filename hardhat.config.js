require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
require("dotenv").config();

const {
  PRIVATE_KEY,
  TESTNET_URL,
  MAINNET_URL,
  LOCALHOST_URL,
  ETHERSCAN_API_KEY
} = process.env;

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    localhost: {
      url: LOCALHOST_URL || "http://127.0.0.1:8545",
    },
    sepolia: {
      url: TESTNET_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],

    },
    
    mainnet: {
      url: MAINNET_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      // You can set mainnet-specific gas settings here too
      // gasPrice: 50_000_000_000, // 50 gwei
    }
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || ""
  },
  mocha: {
    timeout: 200000
  }
};
