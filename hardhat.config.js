// hardhat.config.js
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");

require("dotenv").config();

// OPTIONAL: for size reporting
// npm install --save-dev hardhat-contract-sizer
require("hardhat-contract-sizer");

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      // turn on the IR optimizer for extra bytecode shrinking
      viaIR: true,
      metadata: {
        // strip the metadata hash to save ~200 bytes
        bytecodeHash: "none"
      }
    }
  },

  networks: {
    hardhat: {
      // only for testing locally
      allowUnlimitedContractSize: true
    },
    localhost: {
      url: process.env.LOCALHOST_URL || "http://127.0.0.1:8545",
      allowUnlimitedContractSize: true
    },
    sepolia: {
      url: process.env.TESTNET_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
      // no more unlimited size here—now your real config will enforce the 24 576 B limit
    },
    mainnet: {
      url: process.env.MAINNET_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },

  // Optional: run size report after every compile
  contractSizer: {
    runOnCompile: true,
    only: [ "MemeCoinFactory" ]
  }
};
