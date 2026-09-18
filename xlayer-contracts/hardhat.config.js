require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x" + "0".repeat(64);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    xlayerTestnet: {
      url: "https://testrpc.xlayer.tech",
      chainId: 1952,
      accounts: [PRIVATE_KEY],
    },
    xlayerMainnet: {
      url: "https://rpc.xlayer.tech",
      chainId: 196,
      accounts: [PRIVATE_KEY],
    },
  },
};
