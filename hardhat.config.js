require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();
require("hardhat-abi-exporter");
require("hardhat-contract-sizer");
require("hardhat-deploy");
require("hardhat-deploy-ethers");
require("solidity-coverage");
require("@nomiclabs/hardhat-vyper");

require("./tasks/launchtoken");
require("./tasks/enter");

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.6", 
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
      }, }, 
      { version: "0.5.16", 
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
      }, }, 
      { version: "0.6.6", 
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
      }, }
    ],
  },
  vyper: {
    version: "0.3.1"
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {},
    rinkeby: {
      url: `https://eth-rinkeby.alchemyapi.io/v2/${
        process.env.ALCHEMY_PROJECT_ID || ""
      }`,
      accounts: process.env.DEPLOY_PRIVATE_KEY
        ? [process.env.DEPLOY_PRIVATE_KEY]
        : [],
      gas: 2100000,
      gasPrice: 8000000000,
      saveDeployments: true,
    },
    avalanche: {
      url: "https://api.avax.network/ext/bc/C/rpc",
      gasPrice: 26000000000,
      chainId: 43114,
      accounts: process.env.DEPLOY_PRIVATE_KEY
        ? [process.env.DEPLOY_PRIVATE_KEY]
        : [],
    },
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 1000,
    },
  },
  contractSizer: {
    strict: true,
  },
  namedAccounts: {
    deployer: 0,
    dev: 1,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};
