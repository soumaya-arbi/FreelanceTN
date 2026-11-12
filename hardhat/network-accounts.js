/**
 * Comptes du réseau Hardhat local FreelanceTN.
 *
 * Ce fichier ne contient AUCUNE clé privée : seulement un mnémonique de
 * développement (public, documenté par Hardhat) et les paramètres de dérivation.
 * Les clés privées qui en découlent n'ont de valeur que sur la chaîne locale
 * 31337 : elles sont sans fonds réels et ne doivent jamais être utilisées sur
 * Mainnet, Sepolia ou un autre réseau public.
 *
 * Pour utiliser un mnémonique dédié, créer `hardhat/.env` (ignoré par Git) :
 *
 *     HARDHAT_MNEMONIC="mot1 mot2 ... mot12"
 *
 * Le backend ne reçoit jamais ce mnémonique : il ne lit que la blockchain.
 */
const DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";

const MNEMONIC = (process.env.HARDHAT_MNEMONIC || DEFAULT_MNEMONIC).trim();

/** Solde initial de chaque compte : 10 000 ETH locaux. */
const ACCOUNTS_BALANCE_WEI = "10000000000000000000000";

/** Nombre de comptes dérivés (les deux premiers sont utilisés par FreelanceTN). */
const ACCOUNT_COUNT = 10;

/** Rôles applicatifs des deux premiers comptes. */
const ROLES = {
  0: "FreelanceTN Client (payeur)",
  1: "FreelanceTN Receiver (destinataire)",
};

module.exports = {
  DEFAULT_MNEMONIC,
  MNEMONIC,
  ACCOUNTS_BALANCE_WEI,
  ACCOUNT_COUNT,
  ROLES,
};
