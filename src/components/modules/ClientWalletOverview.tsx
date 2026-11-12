"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import {
  paymentsApi,
  type BlockchainBalanceApi,
  type BlockchainConfigApi,
} from "@/lib/api";
import {
  BLOCKCHAIN_NETWORK,
} from "@/lib/blockchainConfig";
import {
  getEthereumProvider,
  getWalletChainId,
  networkFromConfig,
  readAccountBalance,
  walletRequest,
  weiToEthString,
} from "@/lib/metamask";
import type { EthereumNetworkConfig } from "@/lib/metamask";
import { openWalletSession } from "@/lib/walletPayment";
import {
  balanceIdentityError,
  providerSyncError,
  shortAddress,
} from "@/lib/walletBalance";

const errorMessage = () => "Le solde n'a pas pu être chargé.";

/** Message lisible : une erreur explicite prime sur le libellé générique. */
const readableError = (error: unknown) =>
  error instanceof Error && error.message ? error.message : errorMessage();

/** Message de connexion lisible : aucun détail technique n'est exposé. */
const friendlyWalletError = (error: unknown) =>
  error && typeof error === "object" && (error as { code?: number }).code === 4001
    ? "Vous avez refusé la demande dans MetaMask. Aucun montant n'a été envoyé."
    : "La connexion à MetaMask n'a pas abouti. Vérifiez que l'extension est déverrouillée, puis réessayez.";

/**
 * Affiche un montant wei en ETH : la conversion entière (BigInt) est faite une
 * seule fois puis la partie entière est groupée pour la lecture.
 */
const formatWeiAsEth = (wei?: string | null): string => {
  if (!wei) return "—";
  try {
    const exact = weiToEthString(wei);
    const [whole, fraction] = exact.split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return fraction ? `${grouped},${fraction} ETH` : `${grouped} ETH`;
  } catch {
    return "—";
  }
};

const balanceTime = (iso?: string) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("fr-FR");
};

type Reading = {
  data: BlockchainBalanceApi | null;
  error: string;
};

const EMPTY_READING: Reading = { data: null, error: "" };

/**
 * Portefeuille du client dans le centre de facturation.
 *
 * Le solde affiché est celui du compte MetaMask réellement connecté, lu par le
 * backend puis confronté à la lecture directe de MetaMask. Aucune adresse de
 * démonstration n'est utilisée : sans connexion, le composant ne prétend pas
 * connaître le solde. L'adresse et le réseau sont affichés pour que
 * l'utilisateur puisse les comparer avec MetaMask.
 */
export function ClientWalletOverview({
  loadBlockchainConfig,
  refreshToken = 0,
}: {
  loadBlockchainConfig: () => Promise<BlockchainConfigApi>;
  refreshToken?: number;
}) {
  const [config, setConfig] = useState<BlockchainConfigApi | null>(null);
  const [configError, setConfigError] = useState("");
  const [reading, setReading] = useState<Reading>(EMPTY_READING);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [detected, setDetected] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [connectError, setConnectError] = useState("");
  const [connectNotice, setConnectNotice] = useState("");

  const connectedRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const applyConnected = useCallback((address: string | null) => {
    connectedRef.current = address;
    setConnectedAddress(address);
  }, []);

  /**
   * Relit systématiquement la configuration puis le solde réel.
   *
   * Aucune valeur de solde n'est conservée entre deux lectures : la
   * configuration n'est pas mise en cache, l'adresse vient de MetaMask et la
   * valeur est lue par le backend (`eth_getBalance`) sur le réseau actif.
   * La lecture n'est affichée que si MetaMask et le backend désignent la même
   * adresse, le même réseau et la même valeur on-chain.
   */
  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);

    let current: BlockchainConfigApi;
    try {
      current = await loadBlockchainConfig();
      if (requestId !== requestRef.current) return;
      setConfig(current);
      setConfigError("");
    } catch (error) {
      if (requestId === requestRef.current) {
        setConfig(null);
        setReading(EMPTY_READING);
        setConfigError(readableError(error));
        setLoading(false);
      }
      return;
    }

    const account = connectedRef.current;
    if (!account || !current.enabled) {
      if (requestId === requestRef.current) {
        setReading(EMPTY_READING);
        setLoading(false);
      }
      return;
    }

    const provider = getEthereumProvider();
    if (!provider) {
      if (requestId === requestRef.current) {
        setReading({ data: null, error: "MetaMask n'est pas détecté : aucun solde ne peut être lu." });
        setLoading(false);
      }
      return;
    }

    try {
      // 1. Le réseau de MetaMask doit être celui imposé par le backend.
      const providerChainId = await getWalletChainId(provider);
      if (requestId !== requestRef.current) return;
      if (providerChainId !== current.chainId) {
        setReading({
          data: null,
          error:
            `MetaMask est connecté au réseau ${providerChainId}, alors que FreelanceTN ` +
            `utilise ${current.network} (chainId ${current.chainId}). ` +
            "Aucun solde n'est affiché tant que les deux ne sont pas sur le même réseau.",
        });
        return;
      }

      // 2. Le backend relit le solde on-chain du compte connecté.
      const data = await paymentsApi.blockchainBalance(account);
      if (requestId !== requestRef.current) return;

      const identityError = balanceIdentityError({ account, config: current, data });
      if (identityError) {
        setReading({ data: null, error: identityError });
        return;
      }

      // 3. MetaMask relit la même adresse sur le même réseau : les deux
      //    lectures doivent être identiques, sinon rien n'est affiché.
      const providerReading = await readAccountBalance(
        provider,
        networkFromConfig(current),
        account,
      );
      if (requestId !== requestRef.current) return;

      const syncError = providerSyncError({
        providerChainId,
        providerBalanceWei: providerReading.balanceWei,
        data,
        config: current,
        address: account,
      });
      if (syncError) {
        setReading({ data: null, error: syncError });
        return;
      }

      setReading({ data, error: "" });
    } catch (error) {
      if (requestId === requestRef.current) {
        setReading({ data: null, error: readableError(error) });
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [loadBlockchainConfig]);

  // Ouverture du centre de facturation : configuration + solde réel éventuel.
  useEffect(() => {
    void load();
  }, [load]);

  // Rafraîchissement après un paiement confirmé (signal du parent).
  const previousRefreshToken = useRef(refreshToken);
  useEffect(() => {
    if (previousRefreshToken.current === refreshToken) return;
    previousRefreshToken.current = refreshToken;
    void load();
  }, [refreshToken, load]);

  // Détection MetaMask + compte déjà autorisé (eth_accounts n'ouvre aucune popup).
  useEffect(() => {
    const provider = getEthereumProvider();
    setDetected(Boolean(provider));
    if (!provider) return;
    let active = true;
    void (async () => {
      try {
        const accounts = await walletRequest("eth_accounts", () =>
          provider.request({ method: "eth_accounts" }),
        );
        if (!active) return;
        const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
        applyConnected(first);
        if (first) void load();
      } catch {
        // Un compte non autorisé est un état normal : la connexion reste disponible.
      }
    })();
    return () => {
      active = false;
    };
  }, [applyConnected, load]);

  // Changement de compte / réseau : adresse réelle, configuration et solde relus.
  useEffect(() => {
    const provider = getEthereumProvider();
    if (!provider) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      const first = typeof accounts[0] === "string" ? accounts[0] : null;
      applyConnected(first);
      setConnectError("");
      setReading(EMPTY_READING);
      if (!first) {
        setConnectNotice("Aucun compte n'est sélectionné dans MetaMask. Cliquez sur « Connecter MetaMask » pour en choisir un.");
      }
      void load();
    };
    const onChainChanged = () => {
      setConnectError("");
      setConnectNotice("Réseau MetaMask modifié : relecture de la configuration et du solde…");
      setConfig(null);
      setReading(EMPTY_READING);
      void load();
    };
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [applyConnected, load]);

  // Retour sur l'onglet : le solde on-chain a pu changer (paiement confirmé
  // dans un autre onglet). Relecture systématique, sans valeur mise en cache.
  useEffect(() => {
    const reloadIfConnected = () => {
      if (connectedRef.current) void load();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") reloadIfConnected();
    };
    window.addEventListener("focus", reloadIfConnected);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", reloadIfConnected);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  /** Réseau imposé par le backend, ou valeur de repli si la config est illisible. */
  const activeNetwork = (): EthereumNetworkConfig =>
    config ? networkFromConfig(config) : BLOCKCHAIN_NETWORK;

  /** Clic réel : demande eth_requestAccounts puis bascule/ajout du réseau. */
  const connect = async () => {
    if (connecting || loading) return;
    setConnecting(true);
    setConnectError("");
    setConnectNotice("");
    const provider = getEthereumProvider();
    const network = activeNetwork();
    setDetected(Boolean(provider));
    if (!provider) {
      setConnecting(false);
      setConnectError(
        "MetaMask n'est pas installé dans ce navigateur. Installez l'extension MetaMask puis rechargez la page.",
      );
      return;
    }
    try {
      const session = await openWalletSession(provider, network);
      applyConnected(session.from);
      setReading(EMPTY_READING);
      setConnectNotice("Portefeuille connecté. Votre solde est lu auprès du service de paiement.");
      await load();
    } catch (error) {
      setConnectError(friendlyWalletError(error));
    } finally {
      setConnecting(false);
    }
  };

  const connectionLabel = !detected
    ? "MetaMask non détecté"
    : connectedAddress
      ? "Compte connecté"
      : "Aucun compte autorisé";

  return (
    <div className="wallet-overview">
      <div className="wallet-overview-head">
        <div>
          <h2>Portefeuille MetaMask</h2>
          <p>
            Connectez votre portefeuille pour régler vos factures. Le solde affiché est celui du
            compte sélectionné dans MetaMask, lu auprès du service de paiement.
          </p>
        </div>
        <div className="wallet-balance-actions">
          <Button
            type="button"
            variant="secondary"
            icon="wallet"
            onClick={() => void connect()}
            disabled={connecting || loading}
          >
            {connecting ? "Connexion en cours…" : "Connecter MetaMask"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon="refresh"
            onClick={() => void load()}
            disabled={loading || !connectedAddress}
          >
            {loading ? "Actualisation…" : "Actualiser le solde"}
          </Button>
        </div>
      </div>

      {configError && (
        <p className="form-error" role="alert">
          {configError}
        </p>
      )}

      {config && !config.enabled && (
        <p className="form-error" role="alert">
          Le paiement par portefeuille n&apos;est pas disponible pour le moment.
        </p>
      )}

      {connectError && <p className="form-error" role="alert">{connectError}</p>}
      {connectNotice && (
        <p className="billing-note" role="status">
          <Icon name="check" size={14} />
          {connectNotice}
        </p>
      )}

      {connectedAddress ? (
        <section className="wallet-balance-card billing-center-wallet" aria-label="Votre portefeuille">
          <div className="wallet-balance-head">
            <div>
              <h2>Votre portefeuille</h2>
              <p>Solde disponible pour régler vos factures avec MetaMask.</p>
            </div>
            <div className="wallet-balance-actions">
              <Button
                type="button"
                variant="secondary"
                icon="refresh"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? "Actualisation…" : "Actualiser"}
              </Button>
            </div>
          </div>

          {reading.error && (
            <p className="form-error" role="alert">
              {reading.error}
            </p>
          )}

          {!reading.error && reading.data && (
            <div className="wallet-balance-grid">
              <div>
                <span>Solde disponible</span>
                <b>{formatWeiAsEth(reading.data.balanceWei)}</b>
              </div>
              <div>
                <span>Dernière actualisation</span>
                <b>{balanceTime(reading.data.checkedAt)}</b>
              </div>
            </div>
          )}

          {!reading.error && !reading.data && (
            <p className="billing-note" role="status">
              <Icon name="clock" size={14} />
              {loading ? "Actualisation du solde…" : "Aucun solde à afficher pour le moment."}
            </p>
          )}

          <div className="wallet-connection">
            <div>
              <span>Statut MetaMask</span>
              <b>{connectionLabel}</b>
            </div>
            <div>
              <span>Compte vérifié</span>
              <b title={connectedAddress || undefined}>{shortAddress(connectedAddress || "")}</b>
            </div>
            <div>
              <span>Réseau</span>
              <b>
                {reading.data
                  ? `${reading.data.network} (${reading.data.chainId})`
                  : config
                    ? `${config.network} (${config.chainId})`
                    : "—"}
              </b>
            </div>
          </div>
        </section>
      ) : (
        <p className="billing-note" role="status">
          <Icon name="wallet" size={14} />
          {detected
            ? "Connectez votre portefeuille MetaMask pour afficher votre solde et payer une facture."
            : "MetaMask n'est pas détecté dans ce navigateur. Installez l'extension MetaMask puis rechargez la page."}
        </p>
      )}
    </div>
  );
}
