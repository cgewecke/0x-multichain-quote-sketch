require("dotenv").config();
require("@nomiclabs/hardhat-ethers")

module.exports = {
  networks: {
    hardhat: {
      forking: {
        url: `https://mainnet.infura.io/v3/${process.env.INFURA_TOKEN}`,
      }
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_TOKEN}`,
      // @ts-ignore
      accounts: [`0x${process.env.PRIVATE_KEY}`],
    },
    polygon: {
      url: `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_TOKEN}`,
      // @ts-ignore
      accounts: [`0x${process.env.PRIVATE_KEY}`],
    },
  },
};
