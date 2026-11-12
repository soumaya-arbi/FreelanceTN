require("@nomicfoundation/hardhat-ethers");

const { MNEMONIC, ACCOUNTS_BALANCE_WEI, ACCOUNT_COUNT } = require("./network-accounts");

/**
 * Réseau Hardhat local FreelanceTN.
 *
 * - chainId 31337, écoute sur 127.0.0.1:8545 (jamais exposé publiquement) ;
 * - comptes dérivés d'un mnémonique de développement (voir network-accounts.js) ;
 * - 10 000 ETH locaux par compte pour enchaîner les paiements et les frais ;
 * - minage instantané d'un bloc par transaction, ce qui permet au backend
 *   d'obtenir rapidement les confirmations exigées.
 *
 * Aucune clé privée n'est écrite dans ce fichier. Le backend ne signe rien :
 * il interroge ce nœud en lecture seule via JSON-RPC.
 */
module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: {
        mnemonic: MNEMONIC,
        count: ACCOUNT_COUNT,
        accountsBalance: ACCOUNTS_BALANCE_WEI,
      },
      mining: { auto: true, interval: 0 },
      allowUnlimitedContractSize: true,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
