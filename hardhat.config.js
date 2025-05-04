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
      chainId: 31337 
    },
    testnet: {
      url: TESTNET_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gasPrice: 5_000_000_000,           // 5 gwei
      chainId: 11155111,           // <— explicitly set Sepolia’s chain ID

      // Uncomment below instead to use EIP-1559 style fees:
      // maxPriorityFeePerGas: 1_000_000_000,  // 1 gwei
      // maxFeePerGas:        10_000_000_000, // 10 gwei
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
