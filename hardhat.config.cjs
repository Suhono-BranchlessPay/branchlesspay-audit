/**
 * Hardhat config — CommonJS (.cjs) required when package.json has "type":"module".
 */
require("@nomicfoundation/hardhat-toolbox");

function getPrivateKey() {
  const key        = process.env.DEPLOYER_PRIVATE_KEY || "";
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  const hex        = normalized.slice(2).replace(/\s/g, "");
  if (hex.length === 64) return normalized;
  // Hardhat built-in test account #0 — only used for local compilation checks
  return "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
}

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    monad_testnet: {
      url:      "https://testnet-rpc.monad.xyz",
      chainId:  10143,
      accounts: [getPrivateKey()],
    },
    hardhat: {
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      monad_testnet: "placeholder",
    },
    customChains: [
      {
        network: "monad_testnet",
        chainId: 10143,
        urls: {
          apiURL:      "https://testnet.monadexplorer.com/api",
          browserURL:  "https://testnet.monadexplorer.com",
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
  },
};
