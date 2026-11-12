/**
 * Intégration MetaMask limitée aux réseaux Ethereum de test : Sepolia et
 * Hardhat Local (chainId 31337).
 *
 * Le navigateur ne fait que deux choses : demander à MetaMask d'envoyer un
 * transfert ETH vers l'adresse et sur le réseau figés par le backend, puis
 * transmettre le hash au serveur. Aucune clé privée, aucune signature
 * applicative, aucun appel Mainnet : tout le reste (réseau, destinataire,
 * montant, confirmations) est vérifié côté serveur par lecture JSON-RPC.
 */

import { HARDHAT_CHAIN } from "@/lib/blockchainConfig";

// Réexporté pour les appels existants : la définition vit dans
// `blockchainConfig.ts`, avec les deux comptes Hardhat (source unique).
export { HARDHAT_CHAIN };

export type EthereumNetworkConfig = {
  /** Clé technique stable (« sepolia » ou « hardhat »). */
  key: string;
  /** Nom lisible du réseau. */
  name: string;
  chainId: number;
  chainIdHex: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
};

export const SEPOLIA_CHAIN: EthereumNetworkConfig = {
  key: "sepolia",
  name: "Sepolia",
  chainId: 11155111,
  chainIdHex: "0xaa36a7",
  chainName: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

/** Paramètres réseau renvoyés par le backend (`/api/payments/blockchain/config`). */
export type NetworkConfigInput = {
  network?: string | null;
  networkKey?: string | null;
  chainId: number;
  chainIdHex: string;
  rpcUrl?: string | null;
  explorerBaseUrl?: string | null;
};

const NETWORKS: Record<string, EthereumNetworkConfig> = {
  sepolia: SEPOLIA_CHAIN,
  hardhat: HARDHAT_CHAIN,
};

/**
 * Construit la description MetaMask à partir de la configuration serveur.
 * Le réseau vient du backend : le frontend ne peut pas en imposer un autre.
 */
export const networkFromConfig = (config: NetworkConfigInput): EthereumNetworkConfig => {
  const known = NETWORKS[(config.networkKey || "").trim().toLowerCase()];
  if (known && known.chainId === config.chainId) {
    return {
      ...known,
      chainIdHex: (config.chainIdHex || known.chainIdHex).toLowerCase(),
      rpcUrls: config.rpcUrl ? [config.rpcUrl] : known.rpcUrls,
      blockExplorerUrls: config.explorerBaseUrl ? [config.explorerBaseUrl] : known.blockExplorerUrls,
    };
  }

  const name = (config.network || "").trim() || `Réseau ${config.chainId}`;
  return {
    key: (config.networkKey || "custom").trim().toLowerCase(),
    name,
    chainId: config.chainId,
    chainIdHex: (config.chainIdHex || `0x${config.chainId.toString(16)}`).toLowerCase(),
    chainName: name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: config.rpcUrl ? [config.rpcUrl] : [],
    blockExplorerUrls: config.explorerBaseUrl ? [config.explorerBaseUrl] : [],
  };
};

export type EthereumProvider = {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export class MetaMaskError extends Error {
  code?: number | string;

  constructor(message: string, code?: number | string) {
    super(message);
    this.name = "MetaMaskError";
    this.code = code;
  }
}

/** Nom du réseau compréhensible par l'utilisateur, sans détail de développement. */
export const networkDisplayName = (network: EthereumNetworkConfig): string =>
  network.key === "hardhat" || network.chainId === HARDHAT_CHAIN.chainId
    ? "le réseau de test local"
    : network.name;

export const getEthereumProvider = (): EthereumProvider | null => {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
};

export const isMetaMaskAvailable = () => Boolean(getEthereumProvider());

/** Convertit une quantité de wei (chaîne décimale du backend) en hexadécimal RPC. */
export const weiToHex = (wei: string): string => {
  const value = (wei || "").trim();
  if (!/^\d+$/.test(value)) {
    throw new MetaMaskError("Montant en wei invalide : le paiement est interrompu.");
  }
  return `0x${BigInt(value).toString(16)}`;
};

export const isTxHash = (value?: string | null) =>
  /^0x[0-9a-fA-F]{64}$/.test((value || "").trim());

/**
 * Vrai uniquement pour une adresse EVM complète (`0x` + 40 caractères hex).
 *
 * Toute requête `to`/`from` doit être validée AVANT d'atteindre MetaMask :
 * une requête sans `to` est interprétée par le nœud comme une **création de
 * contrat** (`Contract deployment: <UnrecognizedContract>`), jamais comme un
 * transfert. C'est exactement la trace observée avec `StackOverflow`.
 */
export const isEvmAddress = (value?: string | null): value is string =>
  typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.trim());

/** Ancien nom conservé (les hash sont identiques sur Sepolia et Hardhat). */
export const isSepoliaTxHash = isTxHash;

export const shortenAddress = (address?: string | null, size = 4) => {
  const value = (address || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return value || "—";
  return `${value.slice(0, 2 + size)}…${value.slice(-size)}`;
};

const errorCode = (error: unknown): number | string | undefined => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number" || typeof code === "string") return code;
  }
  return undefined;
};

/**
 * Texte exploitable d'une erreur MetaMask / JSON-RPC.
 *
 * Selon la version de MetaMask et le transport, le message utile est tantôt
 * dans `message`, tantôt dans `data.message`, `error.message` ou
 * `originalError.message`. Les erreurs du nœud Hardhat (« Nonce too high… »)
 * arrivent souvent dans `data`, il faut donc les parcourir toutes.
 */
const errorText = (error: unknown): string => {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || value == null) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["message", "reason", "shortMessage"]) {
      if (typeof record[key] === "string") parts.push(record[key] as string);
    }
    for (const key of ["data", "error", "cause", "originalError", "info", "body"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  };
  visit(error, 0);
  return parts.join(" | ");
};

/** Code propre à l'intégration : nonce MetaMask obsolète (chaîne redémarrée). */
export const METAMASK_NONCE_ERROR = "nonce_error";

/** Le nœud a refusé le nonce proposé par MetaMask. */
export const isNonceError = (error: unknown): boolean =>
  /nonce too (high|low)|nonce has already been used|invalid nonce/i.test(errorText(error));

export const isNonceTooHighError = (error: unknown): boolean =>
  /nonce too high|nonce has already been used|invalid nonce/i.test(errorText(error));

export const isNonceTooLowError = (error: unknown): boolean =>
  /nonce too low/i.test(errorText(error));

/** La transaction a déjà été diffusée (double soumission / nouvel essai). */
export const isAlreadyKnownError = (error: unknown): boolean =>
  /(already known|known transaction|transaction already imported|already imported|replacement transaction underpriced)/i.test(
    errorText(error),
  );

export const isInsufficientFundsError = (error: unknown): boolean =>
  /insufficient funds|insufficient balance|exceeds balance/i.test(errorText(error));

/** Code MetaMask « une demande est déjà en attente » (request already pending). */
export const METAMASK_REQUEST_PENDING = -32002;

export const isRequestPendingError = (error: unknown): boolean =>
  errorCode(error) === METAMASK_REQUEST_PENDING;

/** Code d'une demande abandonnée côté site parce que MetaMask ne répond pas. */
export const METAMASK_REQUEST_TIMEOUT = "wallet_timeout";

export const isRequestTimeoutError = (error: unknown): boolean =>
  errorCode(error) === METAMASK_REQUEST_TIMEOUT;

/**
 * Méthodes qui ouvrent une fenêtre d'approbation MetaMask. Seules celles-ci
 * peuvent rester « en attente » et provoquer `-32002` au clic suivant : elles
 * sont donc journalisées pour pouvoir être nommées.
 */
export const WALLET_APPROVAL_METHODS = [
  "eth_requestAccounts",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "eth_sendTransaction",
] as const;

export type WalletApprovalMethod = (typeof WALLET_APPROVAL_METHODS)[number];

const isApprovalMethod = (method: string): method is WalletApprovalMethod =>
  (WALLET_APPROVAL_METHODS as readonly string[]).includes(method);

/**
 * Journal des demandes d'approbation.
 *
 * MetaMask ne permet pas au site de lire la demande qu'il a en attente : le
 * seul moyen de la nommer est de se souvenir de ce que *nous* avons demandé.
 * Le journal survit à un rechargement (sessionStorage) car `-32002` arrive
 * justement après un reload, quand la promesse d'origine a été perdue.
 * Une demande expirée côté site reste marquée comme non résolue : MetaMask
 * peut encore l'afficher, c'est donc bien elle qui bloque.
 */
const APPROVAL_JOURNAL_KEY = "freelancetn.metamask.approvals";
const APPROVAL_JOURNAL_LIMIT = 8;

type ApprovalRecord = {
  id: string;
  method: WalletApprovalMethod;
  startedAt: number;
  settled: boolean;
};

const approvalStorage = (): Storage | null => {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
};

const isApprovalRecord = (value: unknown): value is ApprovalRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ApprovalRecord>;
  return (
    typeof record.id === "string"
    && typeof record.method === "string"
    && isApprovalMethod(record.method)
    && typeof record.startedAt === "number"
    && Number.isFinite(record.startedAt)
    && typeof record.settled === "boolean"
  );
};

const readApprovalJournal = (): ApprovalRecord[] => {
  try {
    const raw = approvalStorage()?.getItem(APPROVAL_JOURNAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isApprovalRecord).slice(-APPROVAL_JOURNAL_LIMIT) : [];
  } catch {
    return [];
  }
};

let approvalJournal: ApprovalRecord[] = readApprovalJournal();
let approvalSequence = 0;

const persistApprovalJournal = () => {
  try {
    approvalStorage()?.setItem(APPROVAL_JOURNAL_KEY, JSON.stringify(approvalJournal));
  } catch {
    // Le journal est un diagnostic : son indisponibilité ne bloque aucun paiement.
  }
};

const beginApproval = (method: WalletApprovalMethod): string => {
  approvalSequence += 1;
  const id = `${Date.now()}-${approvalSequence}`;
  approvalJournal = [
    ...approvalJournal,
    { id, method, startedAt: Date.now(), settled: false },
  ].slice(-APPROVAL_JOURNAL_LIMIT);
  persistApprovalJournal();
  return id;
};

const settleApproval = (id: string) => {
  let changed = false;
  approvalJournal = approvalJournal.map((record) => {
    if (record.id !== id || record.settled) return record;
    changed = true;
    return { ...record, settled: true };
  });
  if (changed) persistApprovalJournal();
};

/** MetaMask a répondu : plus aucune demande de cet onglet n'est en attente. */
const settleAllApprovals = () => {
  if (!approvalJournal.some((record) => !record.settled)) return;
  approvalJournal = approvalJournal.map((record) => ({ ...record, settled: true }));
  persistApprovalJournal();
};

export type PendingWalletApproval = {
  method: WalletApprovalMethod;
  startedAt: number;
  ageMs: number;
};

/**
 * Dernière demande d'approbation connue comme non résolue. C'est exactement la
 * requête qui provoque `-32002` (y compris après un rechargement de la page).
 */
export const getPendingWalletApproval = (): PendingWalletApproval | null => {
  const record = [...approvalJournal].reverse().find((entry) => !entry.settled);
  if (!record) return null;
  return {
    method: record.method,
    startedAt: record.startedAt,
    ageMs: Math.max(0, Date.now() - record.startedAt),
  };
};

/** Réinitialise le journal (tests, ou déconnexion explicite du portefeuille). */
export const clearWalletApprovalLog = () => {
  approvalJournal = [];
  persistApprovalJournal();
};

/**
 * Réinitialise tout l'état de transport MetaMask (journal, place réservée,
 * file). Réservé aux tests et à une reconnexion explicite : en production, une
 * demande en cours ne doit jamais être « oubliée » par un simple rendu.
 */
export const resetWalletTransport = () => {
  walletQueue = Promise.resolve();
  approvalInFlight = null;
  clearWalletApprovalLog();
};

const describePendingApproval = (refusedMethod?: string): string => {
  const pending = getPendingWalletApproval();
  if (pending) {
    const seconds = Math.max(1, Math.round(pending.ageMs / 1000));
    return `La demande réellement en attente est ${pending.method} (émise il y a ${seconds} s).`;
  }
  if (refusedMethod) {
    return (
      `La requête refusée à l'instant est ${refusedMethod} ; la demande déjà en attente ` +
      "provient d'avant le chargement de la page, MetaMask ne permet pas de la nommer depuis le site."
    );
  }
  return "MetaMask ne permet pas d'identifier depuis le site la demande déjà en attente.";
};

/** Message lisible et non trompeur : un refus MetaMask n'a jamais payé quoi que ce soit. */
export const metaMaskErrorMessage = (
  error: unknown,
  network?: EthereumNetworkConfig,
  context?: { refusedMethod?: string; nodeNonce?: string | null },
): string => {
  const code = errorCode(error);
  // Un message déjà rédigé par l'intégration (réseau refusé, solde
  // insuffisant, demande en attente…) est plus précis qu'un code générique.
  if (error instanceof MetaMaskError && error.message) return error.message;
  if (code === 4001) {
    return "Transaction refusée dans MetaMask. Aucun montant n'a été envoyé : vous pouvez réessayer sans risque.";
  }
  if (code === METAMASK_REQUEST_PENDING) {
    return (
      `MetaMask a déjà une demande en attente. ${describePendingApproval(context?.refusedMethod)} ` +
      "Ouvrez l'extension MetaMask, terminez-la ou rejetez-la avec « Refuser », puis cliquez à nouveau sur Payer. " +
      "Aucun nouveau paiement n'a été créé."
    );
  }
  if (code === 4902) return "Le réseau demandé n'est pas encore ajouté à MetaMask. Acceptez son ajout pour continuer.";
  if (isNonceTooHighError(error) || isNonceTooLowError(error)) {
    const expected = typeof context?.nodeNonce === "string" && context.nodeNonce !== ""
      ? ` La chaîne attend actuellement le nonce ${context.nodeNonce}.`
      : "";
    const direction = isNonceTooLowError(error)
      ? "inférieur à celui déjà consommé par le compte"
      : "déjà utilisé sur cette instance de chaîne";
    return (
      `MetaMask a proposé un nonce ${direction}.${expected} ` +
      "La chaîne locale a probablement été redémarrée alors que MetaMask conserve le nonce de l'instance précédente. " +
      "Aucun montant n'a été envoyé et aucun nouveau paiement n'a été créé. " +
      "Dans MetaMask : Paramètres → Avancé → « Effacer les données d'activité et de nonce » " +
      "(Clear activity tab data), puis réessayez. Ne modifiez pas le nonce à la main."
    );
  }
  if (isAlreadyKnownError(error)) {
    return (
      "Cette transaction a déjà été soumise au réseau : elle n'est pas renvoyée une seconde fois. " +
      "Utilisez « Vérifier le paiement » pour relire son statut. Aucun second montant n'a été envoyé."
    );
  }
  if (isInsufficientFundsError(error)) {
    return (
      "Le réseau a refusé le transfert pour solde insuffisant. " +
      "Aucun montant n'a été envoyé : vérifiez le solde et les frais, puis réessayez."
    );
  }
  if (error instanceof Error && error.message) return error.message;
  return "MetaMask n'a pas pu signer la transaction. Aucun montant n'a été envoyé.";
};

/**
 * File d'attente des demandes d'approbation EIP-1193.
 *
 * MetaMask n'affiche qu'une demande d'approbation à la fois : si deux appels
 * (`wallet_addEthereumChain`, `eth_sendTransaction`, …) partent en parallèle,
 * le second reste en file sans jamais ouvrir sa fenêtre de confirmation et la
 * tentative suivante échoue avec `-32002`. Les méthodes d'approbation passent
 * donc par cette file, une seule à la fois.
 *
 * Les lectures (`eth_chainId`, `eth_getBalance`, …) n'ouvrent aucune fenêtre :
 * elles ne passent pas par la file, afin de ne jamais rester bloquées derrière
 * une signature en attente. Chaque requête a une durée maximale, sauf
 * `eth_sendTransaction` (voir `sendNativeTransfer`).
 */
let walletQueue: Promise<unknown> = Promise.resolve();

/** Durée maximale d'une demande d'approbation (l'utilisateur peut hésiter). */
export const APPROVAL_TIMEOUT_MS = 120_000;
/** Durée maximale d'une lecture JSON-RPC (réseau, solde, gas). */
export const READ_TIMEOUT_MS = 15_000;

const timeoutFor = (method: string) =>
  isApprovalMethod(method) ? APPROVAL_TIMEOUT_MS : READ_TIMEOUT_MS;

const timeoutError = (method: string, timeoutMs: number) =>
  new MetaMaskError(
    `MetaMask n'a pas répondu à « ${method} » en ${Math.max(1, Math.round(timeoutMs / 1000))} s. ` +
      "La demande est abandonnée côté site et la file est libérée ; aucune demande suivante n'est laissée bloquée. " +
      "Ouvrez MetaMask, terminez ou refusez la demande en cours, puis réessayez. " +
      "Aucun montant n'a été envoyé.",
    METAMASK_REQUEST_TIMEOUT,
  );

/**
 * Demande d'approbation en cours dans cet onglet. Une seconde demande est
 * refusée immédiatement (comme le fait MetaMask avec `-32002`) au lieu d'être
 * mise en file : sans cela, le clic suivant n'ouvrirait aucune fenêtre et
 * resterait bloqué sans explication.
 */
let approvalInFlight: { method: WalletApprovalMethod; startedAt: number } | null = null;

export const getInFlightWalletApproval = (): PendingWalletApproval | null => {
  if (!approvalInFlight) return null;
  return {
    method: approvalInFlight.method,
    startedAt: approvalInFlight.startedAt,
    ageMs: Math.max(0, Date.now() - approvalInFlight.startedAt),
  };
};

const pendingApprovalError = (method: string) =>
  new MetaMaskError(
    metaMaskErrorMessage(
      { code: METAMASK_REQUEST_PENDING },
      undefined,
      { refusedMethod: method },
    ),
    METAMASK_REQUEST_PENDING,
  );

const withTimeout = <T>(
  run: Promise<T>,
  method: string,
  timeoutMs: number,
): Promise<T> => {
  // Une signature ne doit JAMAIS expirer côté site : le hash peut déjà être
  // diffusé, et une expiration autoriserait un second envoi (double paiement).
  if (method === "eth_sendTransaction") return run;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError(method, timeoutMs)), timeoutMs);
    run.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

/**
 * Exécute une requête EIP-1193 avec un délai maximal et un journal. Exporté
 * pour que les tests puissent vérifier la libération de la file.
 */
export const walletRequest = <T>(
  method: string,
  task: () => Promise<T>,
  timeoutMs = timeoutFor(method),
): Promise<T> => {
  const approval = isApprovalMethod(method);
  if (approval && approvalInFlight) {
    return Promise.reject(pendingApprovalError(method));
  }

  const approvalId = approval ? beginApproval(method as WalletApprovalMethod) : null;
  if (approval) approvalInFlight = { method: method as WalletApprovalMethod, startedAt: Date.now() };

  const run = approval ? walletQueue.then(task, task) : Promise.resolve().then(task);
  const timed = withTimeout(run, method, timeoutMs);

  if (approval) {
    // Une demande rejetée ou expirée ne doit jamais verrouiller les suivantes.
    walletQueue = timed.then(
      () => undefined,
      () => undefined,
    );
  }

  const release = () => {
    if (approval && approvalInFlight?.method === method) approvalInFlight = null;
  };

  return timed.then(
    (value) => {
      if (approvalId) settleAllApprovals();
      release();
      return value;
    },
    (error) => {
      // Une demande expirée peut encore être affichée par MetaMask : elle reste
      // « non résolue » dans le journal et sera nommée si le clic suivant
      // reçoit -32002. Un refus (4001) ou un -32002 prouve au contraire que
      // MetaMask a répondu : notre propre demande est résolue.
      if (approvalId && !isRequestTimeoutError(error)) {
        if (isRequestPendingError(error)) {
          settleApproval(approvalId);
        } else {
          settleAllApprovals();
        }
      }
      release();
      throw error;
    },
  );
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const requireProvider = (): EthereumProvider => {
  const provider = getEthereumProvider();
  if (!provider) {
    throw new MetaMaskError(
      "MetaMask n'est pas détecté dans ce navigateur. Installez l'extension MetaMask puis rechargez la page.",
    );
  }
  return provider;
};

/** Demande l'accès au compte MetaMask et renvoie l'adresse sélectionnée. */
export const connectWallet = async (provider = requireProvider()): Promise<string> => {
  try {
    const accounts = await walletRequest(
      "eth_requestAccounts",
      () => provider.request({ method: "eth_requestAccounts" }),
    );
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
      throw new MetaMaskError("MetaMask n'a renvoyé aucun compte.");
    }
    return accounts[0];
  } catch (error) {
    throw new MetaMaskError(
      metaMaskErrorMessage(error, undefined, { refusedMethod: "eth_requestAccounts" }),
      errorCode(error),
    );
  }
};

/**
 * Impose le réseau demandé ; l'ajoute s'il n'est pas encore connu de MetaMask.
 * Le réseau provient toujours de la configuration backend.
 */
export const switchToNetwork = async (
  network: EthereumNetworkConfig,
  provider = requireProvider(),
): Promise<void> => {
  try {
    await walletRequest("wallet_switchEthereumChain", () =>
      provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: network.chainIdHex }],
      }),
    );
  } catch (error) {
    const code = errorCode(error);
    if (code === 4902) {
      const params: Record<string, unknown> = {
        chainId: network.chainIdHex,
        chainName: network.chainName,
        nativeCurrency: network.nativeCurrency,
        rpcUrls: [...network.rpcUrls],
      };
      if (network.blockExplorerUrls.length > 0) {
        params.blockExplorerUrls = [...network.blockExplorerUrls];
      }
      // L'ajout de réseau ferme sa propre fenêtre : on attend ensuite que la
      // chaîne soit réellement active avant d'envoyer la transaction.
      try {
        await walletRequest("wallet_addEthereumChain", () =>
          provider.request({ method: "wallet_addEthereumChain", params: [params] }),
        );
      } catch (addError) {
        if (errorCode(addError) === 4001) {
          throw new MetaMaskError(
            "Vous avez refusé l'ajout du réseau requis. Le paiement exige ce réseau.",
            4001,
          );
        }
        throw new MetaMaskError(
          metaMaskErrorMessage(addError, network, { refusedMethod: "wallet_addEthereumChain" }),
          errorCode(addError),
        );
      }
      return;
    }
    if (code === 4001) {
      throw new MetaMaskError(
        `Vous avez refusé le changement de réseau. Le paiement exige ${networkDisplayName(network)}.`,
        code,
      );
    }
    throw new MetaMaskError(
      metaMaskErrorMessage(error, network, { refusedMethod: "wallet_switchEthereumChain" }),
      code,
    );
  }
};

/** Lit le réseau courant de MetaMask (contrôle préalable, non utilisé comme preuve). */
export const getWalletChainId = async (
  provider = requireProvider(),
  timeoutMs = READ_TIMEOUT_MS,
): Promise<number> => {
  let value: unknown;
  try {
    value = await walletRequest("eth_chainId", () => provider.request({ method: "eth_chainId" }), timeoutMs);
  } catch (error) {
    throw new MetaMaskError(metaMaskErrorMessage(error), errorCode(error));
  }
  if (typeof value !== "string") {
    throw new MetaMaskError("MetaMask n'a pas renvoyé de réseau lisible.");
  }
  return Number.parseInt(value, 16);
};

/**
 * Attend que MetaMask serve réellement le réseau demandé.
 *
 * `wallet_addEthereumChain` / `wallet_switchEthereumChain` peuvent se résoudre
 * avant que la bascule soit appliquée. Envoyer `eth_sendTransaction` dans cet
 * intervalle place la demande derrière celle du réseau : elle n'est jamais
 * affichée et reste « en attente » (-32002 au clic suivant).
 */
export const waitForChainId = async (
  network: EthereumNetworkConfig,
  provider = requireProvider(),
  timeoutMs = 15000,
): Promise<number> => {
  const deadline = Date.now() + timeoutMs;
  let observed: number | null = null;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      // Chaque lecture est bornée : une promesse MetaMask muette ne doit pas
      // faire dépasser la date limite de la boucle.
      observed = await getWalletChainId(provider, Math.min(4000, Math.max(250, deadline - Date.now())));
      lastError = null;
    } catch (error) {
      observed = null;
      lastError = error;
    }
    if (observed === network.chainId) return observed;
    await sleep(250);
  }
  // Une demande d'approbation déjà en attente explique mieux le blocage qu'un
  // simple « réseau non basculé ».
  if (isRequestPendingError(lastError)) {
    throw new MetaMaskError(
      metaMaskErrorMessage(lastError, network),
      METAMASK_REQUEST_PENDING,
    );
  }
  throw new MetaMaskError(
    `MetaMask n'a pas encore basculé sur ${networkDisplayName(network)}. ` +
      "Ouvrez MetaMask, acceptez le réseau demandé puis réessayez. Aucun montant n'a été envoyé.",
    "network_timeout",
  );
};

/**
 * Garantit que MetaMask est connecté et sur le bon réseau AVANT toute création
 * d'intention côté backend. Un refus ou une demande déjà en attente n'engage
 * ainsi aucun paiement.
 */
export const ensureNetwork = async (
  network: EthereumNetworkConfig,
  provider = requireProvider(),
): Promise<number> => {
  let current: number | null = null;
  try {
    current = await getWalletChainId(provider);
  } catch (error) {
    // Une demande déjà en attente ne doit pas être doublée par une bascule de
    // réseau : MetaMask la refuserait avec -32002 et l'erreur d'origine serait
    // perdue. On la remonte telle quelle.
    if (isRequestPendingError(error)) throw error;
    current = null;
  }
  if (current !== network.chainId) {
    await switchToNetwork(network, provider);
  }
  return waitForChainId(network, provider);
};

/** Bascule explicite vers Sepolia (compatibilité). */
export const switchToSepolia = async (provider = requireProvider()): Promise<void> =>
  switchToNetwork(SEPOLIA_CHAIN, provider);

/**
 * Lit le nonce `pending` réellement attendu par le nœud pour un compte.
 *
 * Sert uniquement au diagnostic : l'application n'impose JAMAIS de nonce à
 * MetaMask. Une lecture impossible renvoie `null` plutôt que d'inventer 0.
 */
export const readPendingNonce = async (
  provider: EthereumProvider,
  account: string,
): Promise<string | null> => {
  const address = (account || "").trim();
  if (!isEvmAddress(address)) return null;
  try {
    const value = await walletRequest(
      "eth_getTransactionCount",
      () => provider.request({ method: "eth_getTransactionCount", params: [address, "pending"] }),
      5000,
    );
    return quantityToWei(value, "nonce du compte");
  } catch {
    return null;
  }
};

/**
 * Envoie le transfert ETH sur le réseau actif. La valeur est imposée par le
 * backend : le client ne peut pas modifier le montant en wei dans l'interface.
 *
 * Un seul envoi peut être en attente : un second appel est refusé
 * immédiatement (jamais mis en file) pour qu'une transaction déjà soumise ne
 * puisse pas être renvoyée par un double clic ou un nouvel essai.
 */
let transferInFlight = false;

export const sendNativeTransfer = async (input: {
  network?: EthereumNetworkConfig;
  provider?: EthereumProvider;
  from: string;
  to: string;
  valueWei: string;
}): Promise<string> => {
  const provider = input.provider ?? requireProvider();
  const label = input.network?.name || "Ethereum";
  const from = (input.from || "").trim();
  const to = (input.to || "").trim();
  if (!isEvmAddress(from)) {
    throw new MetaMaskError(
      "Adresse du compte expéditeur invalide : paiement interrompu avant toute signature.",
    );
  }
  // Sans `to`, le nœud traite la requête comme un déploiement de contrat
  // (« Contract deployment ») : on refuse donc de l'envoyer.
  if (!isEvmAddress(to)) {
    throw new MetaMaskError(`Adresse de réception ${label} invalide : paiement interrompu.`);
  }
  if (transferInFlight) {
    throw new MetaMaskError(
      "Une transaction est déjà en attente dans MetaMask. Terminez-la ou refusez-la, " +
        "puis vérifiez l'historique : aucun second transfert n'est envoyé automatiquement.",
      "transfer_in_flight",
    );
  }

  // Le drapeau est posé de façon synchrone, avant toute attente.
  transferInFlight = true;
  let hash: unknown;
  try {
    hash = await walletRequest("eth_sendTransaction", () =>
      provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from,
            to,
            value: weiToHex(input.valueWei),
          },
        ],
      }),
    );
  } catch (error) {
    // Aucun nonce n'est imposé par l'application : MetaMask choisit le sien.
    // Quand il est obsolète (chaîne locale redémarrée), on relit le nonce
    // réellement attendu par le nœud pour produire un message actionnable.
    const nonceError = isNonceError(error);
    const nodeNonce = nonceError ? await readPendingNonce(provider, from) : null;
    throw new MetaMaskError(
      metaMaskErrorMessage(error, input.network, {
        refusedMethod: "eth_sendTransaction",
        nodeNonce,
      }),
      nonceError ? METAMASK_NONCE_ERROR : errorCode(error),
    );
  } finally {
    transferInFlight = false;
  }

  if (typeof hash !== "string" || !isTxHash(hash)) {
    throw new MetaMaskError("MetaMask n'a pas renvoyé de hash de transaction valide.");
  }
  return hash;
};

/** Ancien nom conservé pour les appels Sepolia existants. */
export const sendSepoliaTransfer = async (input: {
  provider?: EthereumProvider;
  from: string;
  to: string;
  valueWei: string;
}): Promise<string> => sendNativeTransfer({ ...input, network: SEPOLIA_CHAIN });

const WEI_PER_ETH = 10n ** 18n;

/** Convertit une quantité hexadécimale RPC (`0x…`) en wei décimal exact. */
export const quantityToWei = (value: unknown, label = "quantité"): string => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value.trim())) {
    throw new MetaMaskError(
      `MetaMask a renvoyé une ${label} illisible. Le paiement est bloqué tant que la vérification n'est pas fiable.`,
    );
  }
  return BigInt(value.trim()).toString();
};

/** Convertit un wei décimal en chaîne ETH exacte (sans notation scientifique). */
export const weiToEthString = (wei: string): string => {
  const value = (wei || "").trim();
  if (!/^\d+$/.test(value)) {
    throw new MetaMaskError("Solde en wei illisible : affichage impossible.");
  }
  const amount = BigInt(value);
  const whole = amount / WEI_PER_ETH;
  const fraction = (amount % WEI_PER_ETH).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

/** Valeur numérique d'un wei pour l'affichage (6 décimales maximum côté UI). */
export const weiToEthNumber = (wei: string): number => Number(weiToEthString(wei));

/** Estime le montant en wei d'un paiement TND au taux fixe du backend. */
export const tndToWeiEstimate = (amountTnd: number, tndPerEth: number): string => {
  if (!Number.isFinite(amountTnd) || amountTnd <= 0) {
    throw new MetaMaskError("Montant TND invalide : impossible d'estimer le paiement en ETH.");
  }
  if (!Number.isFinite(tndPerEth) || tndPerEth <= 0) {
    throw new MetaMaskError("Taux TND/ETH invalide : impossible d'estimer le paiement en ETH.");
  }
  // Arithmétique entière (6 décimales) pour reproduire exactement l'arrondi
  // au wei supérieur du backend, sans dérive flottante.
  const SCALE = 1_000_000n;
  const decimals = 6;
  const scaled = (value: number) => {
    const [whole, fraction = ""] = value.toFixed(decimals).split(".");
    return BigInt(whole) * SCALE + BigInt(fraction.padEnd(decimals, "0"));
  };
  const amount = scaled(amountTnd);
  const rate = scaled(tndPerEth);
  const weiPerEth = 1_000_000_000_000_000_000n;
  return ((amount * weiPerEth) / rate + ((amount * weiPerEth) % rate === 0n ? 0n : 1n)).toString();
};

export type WalletBalanceReading = {
  account: string;
  network: EthereumNetworkConfig;
  balanceWei: string;
  blockNumber: number;
};

export type TransferCostEstimate = {
  /** Unités de gas estimées par `eth_estimateGas`. */
  gasLimit: string;
  gasPriceWei: string;
  /** Frais de base (gas × prix du gas), en wei. */
  feeWei: string;
  /** Frais avec marge de sécurité de 20 %, utilisés pour le contrôle de solde. */
  bufferedFeeWei: string;
};

const assertWalletNetwork = async (provider: EthereumProvider, network: EthereumNetworkConfig) => {
  const observed = await getWalletChainId(provider);
  if (observed !== network.chainId) {
    throw new MetaMaskError(
      `MetaMask n'est pas sur le réseau requis (${networkDisplayName(network)}). ` +
        "Aucun solde n'est affiché et aucun paiement n'est envoyé hors du réseau configuré.",
      "wrong_network",
    );
  }
};

/**
 * Lit le solde réel du compte avec `eth_getBalance`, sur le réseau imposé par
 * le backend. Toute réponse douteuse lève une erreur : aucun solde n'est
 * inventé ni repris d'un état local.
 */
export const readAccountBalance = async (
  provider: EthereumProvider,
  network: EthereumNetworkConfig,
  account: string,
): Promise<WalletBalanceReading> => {
  if (!/^0x[0-9a-fA-F]{40}$/.test((account || "").trim())) {
    throw new MetaMaskError("Adresse du compte MetaMask invalide : solde non consultable.");
  }
  await assertWalletNetwork(provider, network);

  try {
    const rawBalance = await walletRequest("eth_getBalance", () =>
      provider.request({ method: "eth_getBalance", params: [account, "latest"] }),
    );
    const rawBlock = await walletRequest("eth_blockNumber", () =>
      provider.request({ method: "eth_blockNumber" }),
    );
    return {
      account,
      network,
      balanceWei: quantityToWei(rawBalance, "solde"),
      blockNumber: Number.parseInt(quantityToWei(rawBlock, "hauteur de bloc"), 10),
    };
  } catch (error) {
    if (error instanceof MetaMaskError) throw error;
    throw new MetaMaskError(
      `Impossible de lire le solde du compte sur ${networkDisplayName(network)}. Aucun paiement n'est autorisé sans vérification fiable.`,
      errorCode(error),
    );
  }
};

/**
 * Estime les frais d'un transfert ETH avec `eth_estimateGas` et `eth_gasPrice`.
 * Une estimation indisponible lève une erreur : le paiement est bloqué plutôt
 * que validé sur une hypothèse.
 */
export const estimateTransferGas = async (
  provider: EthereumProvider,
  network: EthereumNetworkConfig,
  input: { from: string; to: string; valueWei: string },
): Promise<TransferCostEstimate> => {
  const from = (input.from || "").trim();
  const to = (input.to || "").trim();
  // Validation AVANT toute requête : une estimation sans `to` serait exécutée
  // par le nœud comme une création de contrat (« Contract deployment »).
  if (!isEvmAddress(from)) {
    throw new MetaMaskError(
      "Adresse du compte expéditeur invalide : estimation des frais impossible.",
    );
  }
  if (!isEvmAddress(to)) {
    throw new MetaMaskError(
      "Adresse de réception invalide : estimation des frais impossible. Aucune requête n'a été envoyée.",
    );
  }
  if (!/^\d+$/.test((input.valueWei || "").trim())) {
    throw new MetaMaskError("Montant en wei invalide : estimation des frais impossible.");
  }

  await assertWalletNetwork(provider, network);

  try {
    const rawGasLimit = await walletRequest("eth_estimateGas", () =>
      provider.request({
        method: "eth_estimateGas",
        params: [{ from, to, value: weiToHex(input.valueWei) }],
      }),
    );
    const rawGasPrice = await walletRequest("eth_gasPrice", () =>
      provider.request({ method: "eth_gasPrice" }),
    );

    const gasLimit = BigInt(quantityToWei(rawGasLimit, "estimation de gas"));
    const gasPrice = BigInt(quantityToWei(rawGasPrice, "prix du gas"));
    const fee = gasLimit * gasPrice;
    // Marge de 20 % : le solde doit couvrir l'estimation, pas la sous-estimer.
    const buffered = (fee * 120n + 99n) / 100n;
    return {
      gasLimit: gasLimit.toString(),
      gasPriceWei: gasPrice.toString(),
      feeWei: fee.toString(),
      bufferedFeeWei: buffered.toString(),
    };
  } catch (error) {
    if (error instanceof MetaMaskError) throw error;
    throw new MetaMaskError(
      `Impossible d'estimer les frais de réseau sur ${networkDisplayName(network)}. ` +
        "Le paiement est bloqué tant que les frais ne peuvent pas être vérifiés.",
      errorCode(error),
    );
  }
};

export type WalletWatchHandlers = {
  onAccountsChanged?: (accounts: string[]) => void;
  onChainChanged?: (chainId: number) => void;
  onDisconnect?: () => void;
};

/**
 * Surveille les changements de compte / réseau pendant un paiement.
 * Retourne la fonction de désabonnement à appeler dans `finally`.
 */
export const watchWallet = (
  handlers: WalletWatchHandlers,
  provider = requireProvider(),
): (() => void) => {
  const accountHandler = (...args: unknown[]) => {
    const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
    handlers.onAccountsChanged?.(accounts);
  };
  const chainHandler = (...args: unknown[]) => {
    const value = args[0];
    if (typeof value === "string") handlers.onChainChanged?.(Number.parseInt(value, 16));
  };
  const disconnectHandler = () => handlers.onDisconnect?.();
  provider.on?.("accountsChanged", accountHandler);
  provider.on?.("chainChanged", chainHandler);
  provider.on?.("disconnect", disconnectHandler);
  return () => {
    provider.removeListener?.("accountsChanged", accountHandler);
    provider.removeListener?.("chainChanged", chainHandler);
    provider.removeListener?.("disconnect", disconnectHandler);
  };
};

/** Lien vers l'explorateur du réseau, uniquement s'il en existe un. */
export const txUrlFor = (network: EthereumNetworkConfig, hash?: string | null) => {
  if (!isTxHash(hash)) return null;
  const base = network.blockExplorerUrls[0];
  return base ? `${base.replace(/\/+$/, "")}/tx/${(hash || "").trim()}` : null;
};

export const sepoliaTxUrl = (hash?: string | null) => txUrlFor(SEPOLIA_CHAIN, hash);
