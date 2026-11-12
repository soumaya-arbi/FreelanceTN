import { normalizeAddress } from "@/lib/blockchainConfig";
import { weiToEthString } from "@/lib/metamask";

/**
 * Contrôles de cohérence du solde affiché dans le portefeuille client.
 *
 * Le solde vient du backend (`eth_getBalance` sur le nœud du réseau actif),
 * mais il n'est affiché que si :
 *  - l'adresse renvoyée est bien celle du compte MetaMask connecté ;
 *  - le réseau renvoyé est bien celui de la configuration active ;
 *  - MetaMask et le backend lisent la même valeur pour cette adresse.
 *
 * Ces fonctions sont pures : elles ne lisent ni cache ni état global et
 * peuvent être testées sans navigateur ni nœud Hardhat.
 */

export type BlockchainNetworkIdentity = {
  chainId: number;
  networkKey: string;
  network: string;
};

export type BlockchainBalanceIdentity = {
  address: string;
  chainId: number;
  networkKey: string;
};

const isWei = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value.trim());

/** Adresse lisible et courte pour les messages utilisateur. */
export const shortAddress = (address: string): string =>
  address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;

const formatWei = (wei: string): string => {
  try {
    const exact = weiToEthString(wei);
    const [whole, fraction] = exact.split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return fraction ? `${grouped},${fraction} ETH` : `${grouped} ETH`;
  } catch {
    return "—";
  }
};

export type BalanceIdentityInput = {
  account: string;
  config: BlockchainNetworkIdentity;
  data: BlockchainBalanceIdentity;
};

/**
 * Vérifie que la réponse backend désigne réellement le compte connecté sur le
 * réseau actif. Retourne un message d'erreur explicite, ou `null` si tout est
 * cohérent.
 */
export const balanceIdentityError = ({ account, config, data }: BalanceIdentityInput): string | null => {
  if (!data || !data.address) {
    return "Le service de paiement n'a pas renvoyé d'adresse : aucun solde fiable ne peut être affiché.";
  }

  if (normalizeAddress(data.address) !== normalizeAddress(account)) {
    return (
      `Le service de paiement a lu le compte ${shortAddress(data.address)}, ` +
      `alors que MetaMask est connecté avec ${shortAddress(account)}. ` +
      "Aucun solde n'est affiché tant que les deux adresses ne correspondent pas."
    );
  }

  if (data.chainId !== config.chainId || data.networkKey !== config.networkKey) {
    return (
      `Le service de paiement a répondu sur un autre réseau (${data.networkKey || "inconnu"}) ` +
      `que celui attendu (${config.network}). Aucun solde n'est affiché.`
    );
  }

  return null;
};

export type ProviderSyncInput = {
  providerChainId: number;
  providerBalanceWei: string;
  data: BlockchainBalanceIdentity & { balanceWei: string };
  config: BlockchainNetworkIdentity;
  address: string;
};

/**
 * Compare la lecture du compte par MetaMask (`eth_getBalance` via le provider)
 * avec celle du backend. Une différence signifie que les deux sources ne
 * pointent pas vers la même instance de chaîne : le solde n'est alors pas
 * affiché pour éviter d'afficher une valeur qui contredit MetaMask.
 */
export const providerSyncError = ({
  providerChainId,
  providerBalanceWei,
  data,
  config,
  address,
}: ProviderSyncInput): string | null => {
  if (providerChainId !== config.chainId) {
    return (
      `MetaMask est connecté au réseau ${providerChainId}, alors que FreelanceTN ` +
      `utilise ${config.network} (chainId ${config.chainId}). ` +
      "Aucun solde n'est affiché tant que les deux ne sont pas sur le même réseau."
    );
  }

  if (!isWei(providerBalanceWei) || !isWei(data.balanceWei)) {
    return "Le solde reçu est illisible : aucun montant fiable ne peut être affiché.";
  }

  if (BigInt(providerBalanceWei) !== BigInt(data.balanceWei)) {
    return (
      `MetaMask lit ${formatWei(providerBalanceWei)} pour ${shortAddress(address)}, ` +
      `alors que le service de paiement lit ${formatWei(data.balanceWei)}. ` +
      `Les deux sources ne sont pas synchronisées sur ${config.network}. ` +
      "Aucun solde n'est affiché : actualisez MetaMask sur ce réseau puis cliquez sur « Actualiser le solde »."
    );
  }

  return null;
};
