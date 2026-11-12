/**
 * Orchestration du paiement MetaMask, indépendante de React.
 *
 * Deux garanties, testées séparément du composant :
 * 1. la session portefeuille (compte + réseau) est ouverte AVANT que le
 *    backend ne crée l'intention : un refus ou une demande déjà en attente
 *    (-32002) n'engage donc aucun paiement ;
 * 2. une intention qui possède déjà un hash n'est jamais renvoyée sur le
 *    réseau : le même paiement ne peut pas transférer deux fois.
 */

import {
  MetaMaskError,
  connectWallet,
  ensureNetwork,
  estimateTransferGas,
  getWalletChainId,
  isEvmAddress,
  metaMaskErrorMessage,
  networkDisplayName,
  readAccountBalance,
  sendNativeTransfer,
  walletRequest,
  watchWallet,
  weiToEthString,
  type EthereumNetworkConfig,
  type EthereumProvider,
  type TransferCostEstimate,
} from "@/lib/metamask";

export type WalletSession = {
  provider: EthereumProvider;
  from: string;
  network: EthereumNetworkConfig;
};

const sameAddress = (left: string, right: string) =>
  (left || "").trim().toLowerCase() === (right || "").trim().toLowerCase();

/** Adresse actuellement sélectionnée dans MetaMask, ou `null` si aucune. */
const readSelectedAccount = async (provider: EthereumProvider): Promise<string | null> => {
  try {
    const accounts = await walletRequest(
      "eth_accounts",
      () => provider.request({ method: "eth_accounts" }),
      5000,
    );
    return Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
  } catch (error) {
    throw new MetaMaskError(metaMaskErrorMessage(error));
  }
};

/**
 * Vérifie, juste avant une signature, que MetaMask sert toujours le compte et
 * le réseau de la session ouverte. Les événements `accountsChanged` /
 * `chainChanged` peuvent arriver trop tard ou manquer (changement survenu
 * entre l'ouverture de session et l'attachement des écouteurs) : cette
 * relecture empêche d'envoyer depuis un compte ou un réseau qui a changé.
 */
export const assertWalletSession = async (session: WalletSession): Promise<void> => {
  const current = await readSelectedAccount(session.provider);
  if (!current) {
    throw new MetaMaskError(
      "Aucun compte MetaMask n'est sélectionné : aucun montant n'a été envoyé.",
    );
  }
  if (!sameAddress(current, session.from)) {
    throw new MetaMaskError(
      "Le compte MetaMask a changé depuis l'ouverture du paiement. " +
        "Aucun montant n'a été envoyé : relancez le paiement avec le compte affiché.",
      "account_changed",
    );
  }

  let chainId: number;
  try {
    chainId = await getWalletChainId(session.provider);
  } catch (error) {
    if (error instanceof MetaMaskError) throw error;
    throw new MetaMaskError(metaMaskErrorMessage(error));
  }
  if (chainId !== session.network.chainId) {
    throw new MetaMaskError(
      `MetaMask n'est plus sur ${networkDisplayName(session.network)}. ` +
        "Aucun montant n'a été envoyé : revenez sur le réseau requis puis relancez le paiement.",
      "wrong_network",
    );
  }
};

/** Résultat d'une vérification de solde avant paiement. */
export type WalletPreflight = {
  account: string;
  network: EthereumNetworkConfig;
  balanceWei: string;
  blockNumber: number;
  amountWei: string;
  gas: TransferCostEstimate | null;
  /** Montant + frais estimés (marge incluse). */
  requiredWei: string;
  /** 0 si le solde est suffisant. */
  shortfallWei: string;
  sufficient: boolean;
  /** « amount » si le principal manque, « fees » si seuls les frais manquent. */
  reason: "ok" | "amount" | "fees";
};

/**
 * Contrôle de solde réel avant signature : le principal est comparé au solde
 * `eth_getBalance` ; si le principal passe, les frais estimés (gas) sont
 * ajoutés avec une marge. Toute lecture impossible lève une erreur (échec
 * fermé), jamais une autorisation par défaut.
 */
export const preflightTransfer = async (
  session: WalletSession,
  receiver: string,
  amountWei: string,
): Promise<WalletPreflight> => {
  if (!isEvmAddress(session.from)) {
    throw new MetaMaskError("Adresse MetaMask invalide : vérification du solde impossible.");
  }
  // Même garde que l'envoi : sans destinataire valide, aucune estimation n'est
  // lancée (une requête sans `to` serait une création de contrat).
  if (!isEvmAddress(receiver)) {
    throw new MetaMaskError(
      "Adresse de réception invalide : vérification du solde impossible. Aucun montant n'a été envoyé.",
    );
  }
  if (!/^\d+$/.test((amountWei || "").trim())) {
    throw new MetaMaskError("Montant en wei invalide : vérification du solde impossible.");
  }
  const amount = BigInt(amountWei);
  const reading = await readAccountBalance(session.provider, session.network, session.from);
  const balance = BigInt(reading.balanceWei);

  // Solde déjà inférieur au principal : inutile d'estimer le gas pour savoir
  // que le paiement est impossible. Le manque affiché reste exact.
  if (balance < amount) {
    return {
      account: session.from,
      network: session.network,
      balanceWei: reading.balanceWei,
      blockNumber: reading.blockNumber,
      amountWei,
      gas: null,
      requiredWei: amountWei,
      shortfallWei: (amount - balance).toString(),
      sufficient: false,
      reason: "amount",
    };
  }

  const gas = await estimateTransferGas(session.provider, session.network, {
    from: session.from,
    to: receiver,
    valueWei: amountWei,
  });
  const required = amount + BigInt(gas.bufferedFeeWei);
  const sufficient = balance >= required;
  return {
    account: session.from,
    network: session.network,
    balanceWei: reading.balanceWei,
    blockNumber: reading.blockNumber,
    amountWei,
    gas,
    requiredWei: required.toString(),
    shortfallWei: sufficient ? "0" : (required - balance).toString(),
    sufficient,
    reason: sufficient ? "ok" : "fees",
  };
};

/** Message explicite et chiffré quand le solde ne couvre pas le paiement. */
export const insufficientFundsMessage = (check: WalletPreflight): string => {
  const available = weiToEthString(check.balanceWei);
  const shortfall = weiToEthString(check.shortfallWei);
  if (check.reason === "amount") {
    return (
      `Solde ETH insuffisant sur ${networkDisplayName(check.network)} : il manque ${shortfall} ETH pour ce paiement. ` +
      `Solde disponible : ${available} ETH, montant requis : ${weiToEthString(check.amountWei)} ETH. ` +
      "Aucun paiement n'a été envoyé."
    );
  }
  return (
    `Solde ETH insuffisant pour couvrir les frais de réseau sur ${networkDisplayName(check.network)} : il manque ${shortfall} ETH. ` +
    `Total requis (paiement + frais estimés) : ${weiToEthString(check.requiredWei)} ETH, ` +
    `solde disponible : ${available} ETH. Aucun paiement n'a été envoyé.`
  );
};

/** Bloque la signature si le contrôle de solde n'est pas concluant. */
export const assertSufficientFunds = (check: WalletPreflight): void => {
  if (!check.sufficient) {
    throw new MetaMaskError(insufficientFundsMessage(check), "insufficient_funds");
  }
};

/** Vue minimale d'une intention de paiement blockchain. */
export type BlockchainIntent = {
  id: string;
  receiver: string;
  amountWei: string;
  /** Hash déjà posé par une vérification précédente : ne jamais réenvoyer. */
  txHash?: string | null;
};

/**
 * Étape 1 : connecter MetaMask puis imposer le réseau. Aucun appel backend
 * n'est fait ici, donc aucune intention ne peut être créée si l'utilisateur
 * refuse ou si MetaMask a déjà une demande en attente.
 *
 * Deux clics simultanés (« Connecter et vérifier » + « Payer », ou un double
 * clic) partagent la même session : une seule demande `eth_requestAccounts`
 * peut partir, donc aucune seconde demande concurrente ne peut rester
 * « en attente » (-32002).
 */
let sessionFlight: {
  provider: EthereumProvider;
  chainId: number;
  promise: Promise<WalletSession>;
} | null = null;

export const openWalletSession = (
  provider: EthereumProvider,
  network: EthereumNetworkConfig,
): Promise<WalletSession> => {
  if (
    sessionFlight
    && sessionFlight.provider === provider
    && sessionFlight.chainId === network.chainId
  ) {
    return sessionFlight.promise;
  }

  const promise = (async (): Promise<WalletSession> => {
    const from = await connectWallet(provider);
    await ensureNetwork(network, provider);
    // Le compte peut avoir changé pendant la bascule réseau : on relit le
    // compte réellement sélectionné plutôt que de figer celui du début.
    const current = await readSelectedAccount(provider);
    if (!current) {
      throw new MetaMaskError(
        "MetaMask n'a renvoyé aucun compte après la connexion. Aucun montant n'a été envoyé.",
      );
    }
    if (!sameAddress(current, from)) {
      throw new MetaMaskError(
        "Le compte MetaMask a changé pendant la connexion. " +
          "Aucun montant n'a été envoyé : relancez le paiement avec le compte affiché.",
        "account_changed",
      );
    }
    return { provider, from: current, network };
  })().finally(() => {
    // Un refus, un -32002 ou une expiration libère la session : le clic
    // suivant doit pouvoir redemander une connexion.
    if (sessionFlight?.promise === promise) sessionFlight = null;
  });

  sessionFlight = { provider, chainId: network.chainId, promise };
  return promise;
};

/**
 * Étape 3 : envoyer une seule fois le montant exact fixé par le backend.
 * - si l'intention porte déjà un hash, aucun nouvel envoi n'est effectué ;
 * - un changement de compte ou de réseau pendant l'attente annule l'envoi.
 */
export const sendIntentTransfer = async (
  session: WalletSession,
  intent: BlockchainIntent,
): Promise<string> => {
  if (intent.txHash) return intent.txHash;

  if (!intent.receiver || !intent.amountWei) {
    throw new MetaMaskError(
      `Intention ${networkDisplayName(session.network)} incomplète : recommencez le paiement.`,
    );
  }

  let accountChanged = false;
  let chainChanged = false;
  const stopWatching = watchWallet(
    {
      onAccountsChanged: (accounts) => {
        if (!accounts.some((address) => address.toLowerCase() === session.from.toLowerCase())) {
          accountChanged = true;
        }
      },
      onChainChanged: (chainId) => {
        if (chainId !== session.network.chainId) chainChanged = true;
      },
      onDisconnect: () => {
        accountChanged = true;
      },
    },
    session.provider,
  );

  try {
    if (accountChanged || chainChanged) {
      throw new MetaMaskError(
        "Le compte ou le réseau MetaMask a changé pendant le paiement. Aucun montant n'a été envoyé.",
      );
    }
    // Relecture du compte et du réseau juste avant la signature : ferme la
    // fenêtre où un changement survenu avant l'attachement des écouteurs ne
    // serait signalé par aucun événement.
    await assertWalletSession(session);
    if (accountChanged || chainChanged) {
      throw new MetaMaskError(
        "Le compte ou le réseau MetaMask a changé pendant le paiement. Aucun montant n'a été envoyé.",
      );
    }
    return await sendNativeTransfer({
      network: session.network,
      provider: session.provider,
      from: session.from,
      to: intent.receiver,
      valueWei: intent.amountWei,
    });
  } finally {
    stopWatching();
  }
};
