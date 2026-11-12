/**
 * Configuration blockchain centralisée de FreelanceTN (réseau de test).
 *
 * Source unique des deux comptes Hardhat et du réseau utilisé par l'interface :
 *  - compte #0 : client / payeur (MetaMask) ;
 *  - compte #1 : freelancer / destinataire des paiements.
 *
 * Les adresses sont publiques (mnémonique de développement Hardhat, documenté
 * par Hardhat) : AUCUNE clé privée ne figure ici et le frontend n'en a jamais
 * besoin. Le backend reste seul juge du réseau, du destinataire et du montant.
 */

import type { EthereumNetworkConfig } from "@/lib/metamask";

/** RPC local du nœud Hardhat (`npm run node` dans `hardhat/`). */
export const HARDHAT_RPC_URL = "http://127.0.0.1:8545";
/** chainId Hardhat Local. */
export const HARDHAT_CHAIN_ID = 31337;
/** Même chainId en hexadécimal (format EIP-1193). */
export const HARDHAT_CHAIN_ID_HEX = "0x7a69";

/** Description MetaMask du réseau Hardhat Local. */
export const HARDHAT_CHAIN: EthereumNetworkConfig = {
  key: "hardhat",
  name: "Hardhat Local",
  chainId: HARDHAT_CHAIN_ID,
  chainIdHex: HARDHAT_CHAIN_ID_HEX,
  chainName: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [HARDHAT_RPC_URL],
  // Aucun explorateur public pour une chaîne locale.
  blockExplorerUrls: [],
};

/** Réseau de test utilisé par défaut par l'interface (le backend peut imposer Sepolia). */
export const BLOCKCHAIN_NETWORK = HARDHAT_CHAIN;

export type BlockchainAccountRole = "client" | "freelancer";

export type BlockchainAccount = {
  /** Rôle applicatif stable. */
  role: BlockchainAccountRole;
  /** Libellé affiché dans l'interface. */
  label: string;
  /** Index de dérivation Hardhat (0 ou 1). */
  index: number;
  /** Adresse publique checksumée. */
  address: string;
  /** Rôle fonctionnel en une phrase. */
  purpose: string;
};

/**
 * Les deux comptes du réseau Hardhat local. Ne jamais les intervertir :
 * le client paie depuis #0, le freelancer reçoit sur #1.
 */
export const BLOCKCHAIN_ACCOUNTS: Record<BlockchainAccountRole, BlockchainAccount> = {
  client: {
    role: "client",
    label: "Client / Payeur",
    index: 0,
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    purpose: "Compte utilisé par le client pour envoyer les ETH de test via MetaMask.",
  },
  freelancer: {
    role: "freelancer",
    label: "Freelancer / Destinataire",
    index: 1,
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    purpose: "Compte qui reçoit les paiements on-chain configurés côté serveur.",
  },
};

/** Adresse attendue du compte client (Hardhat #0). */
export const EXPECTED_CLIENT_ADDRESS = BLOCKCHAIN_ACCOUNTS.client.address;
/** Adresse attendue du compte destinataire (Hardhat #1). */
export const EXPECTED_FREELANCER_ADDRESS = BLOCKCHAIN_ACCOUNTS.freelancer.address;

/** Normalise une adresse pour comparaison (insensible à la casse et aux espaces). */
export const normalizeAddress = (address?: string | null): string =>
  (address || "").trim().toLowerCase();

/** Vrai si les deux adresses désignent le même compte (casse ignorée). */
export const addressesMatch = (left?: string | null, right?: string | null): boolean => {
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  return a.length > 0 && a === b;
};

/** Vrai si l'adresse est celle du compte client attendu (Hardhat #0). */
export const isExpectedClientAddress = (address?: string | null): boolean =>
  addressesMatch(address, EXPECTED_CLIENT_ADDRESS);

/** Vrai si l'adresse est celle du compte destinataire (Hardhat #1). */
export const isExpectedFreelancerAddress = (address?: string | null): boolean =>
  addressesMatch(address, EXPECTED_FREELANCER_ADDRESS);

/** Rôle applicatif d'une adresse, ou `null` si elle n'est pas un compte connu. */
export const accountRoleForAddress = (address?: string | null): BlockchainAccountRole | null => {
  if (isExpectedClientAddress(address)) return "client";
  if (isExpectedFreelancerAddress(address)) return "freelancer";
  return null;
};

/** Vrai si le réseau observé est celui de la configuration Hardhat. */
export const isHardhatChain = (chainId?: number | null): boolean =>
  chainId === HARDHAT_CHAIN_ID;

/**
 * Message explicite quand MetaMask est connecté avec un autre compte que le
 * compte client de test. Aucun compte n'est forcé : l'utilisateur reste maître
 * de la sélection dans MetaMask.
 */
export const clientAccountMismatchMessage = (connected?: string | null): string =>
  `MetaMask est connecté avec le compte ${connected || "inconnu"}, qui ne correspond pas au compte client de test Hardhat #0 (${EXPECTED_CLIENT_ADDRESS}). ` +
  "Aucun compte n'est sélectionné à votre place : changez de compte dans MetaMask si vous voulez payer depuis le compte client attendu.";
