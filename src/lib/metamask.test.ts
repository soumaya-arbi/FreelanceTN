import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  HARDHAT_CHAIN,
  METAMASK_NONCE_ERROR,
  SEPOLIA_CHAIN,
  MetaMaskError,
  connectWallet,
  ensureNetwork,
  estimateTransferGas,
  getPendingWalletApproval,
  isAlreadyKnownError,
  isEvmAddress,
  isNonceError,
  isRequestPendingError,
  isSepoliaTxHash,
  metaMaskErrorMessage,
  networkFromConfig,
  quantityToWei,
  readAccountBalance,
  readPendingNonce,
  resetWalletTransport,
  sepoliaTxUrl,
  sendNativeTransfer,
  sendSepoliaTransfer,
  shortenAddress,
  switchToNetwork,
  switchToSepolia,
  tndToWeiEstimate,
  txUrlFor,
  waitForChainId,
  walletRequest,
  watchWallet,
  weiToEthString,
  weiToHex,
  type EthereumProvider,
} from "@/lib/metamask";

const HASH = `0x${"ab".repeat(32)}`;
const RECEIVER = "0x1111111111111111111111111111111111111111";
const SENDER = "0x2222222222222222222222222222222222222222";

const providerMock = (handler: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>): EthereumProvider => ({
  request: vi.fn(handler),
});

describe("weiToHex", () => {
  it("convertit le wei décimal du backend en hexadécimal RPC", () => {
    expect(weiToHex("100000000000000000")).toBe("0x16345785d8a0000");
    expect(weiToHex("0")).toBe("0x0");
  });

  it("refuse un montant non numérique", () => {
    expect(() => weiToHex("1.5")).toThrow(MetaMaskError);
    expect(() => weiToHex("")).toThrow(MetaMaskError);
  });
});

describe("helpers Sepolia", () => {
  it("reconnaît un hash de transaction Sepolia", () => {
    expect(isSepoliaTxHash(HASH)).toBe(true);
    expect(isSepoliaTxHash("0x1234")).toBe(false);
    expect(isSepoliaTxHash(null)).toBe(false);
  });

  it("abrège une adresse et conserve les valeurs invalides", () => {
    expect(shortenAddress(RECEIVER)).toBe("0x1111…1111");
    expect(shortenAddress("pas-une-adresse")).toBe("pas-une-adresse");
    expect(shortenAddress(null)).toBe("—");
  });

  it("construit un lien Etherscan uniquement pour un hash valide", () => {
    expect(sepoliaTxUrl(HASH)).toBe(`https://sepolia.etherscan.io/tx/${HASH}`);
    expect(sepoliaTxUrl("0x00")).toBeNull();
  });

  it("explique un refus MetaMask sans laisser croire à un paiement", () => {
    expect(metaMaskErrorMessage({ code: 4001 })).toContain("Aucun montant n'a été envoyé");
    expect(metaMaskErrorMessage({ code: -32002 })).toContain("déjà une demande en attente");
    expect(metaMaskErrorMessage({ code: -32002 })).toContain("Refuser");
  });
});

describe("sendSepoliaTransfer", () => {
  it("envoie exactement la valeur en wei imposée par le backend", async () => {
    const provider = providerMock(async () => HASH);

    const hash = await sendSepoliaTransfer({
      provider,
      from: SENDER,
      to: RECEIVER,
      valueWei: "100000000000000000",
    });

    expect(hash).toBe(HASH);
    expect(provider.request).toHaveBeenCalledWith({
      method: "eth_sendTransaction",
      params: [{ from: SENDER, to: RECEIVER, value: "0x16345785d8a0000" }],
    });
  });

  it("refuse une adresse de réception invalide sans appeler MetaMask", async () => {
    const provider = providerMock(async () => HASH);

    await expect(
      sendSepoliaTransfer({ provider, from: SENDER, to: "0x1234", valueWei: "1" }),
    ).rejects.toBeInstanceOf(MetaMaskError);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("traduit un refus utilisateur en message explicite", async () => {
    const provider = providerMock(async () => {
      throw { code: 4001 };
    });

    await expect(
      sendSepoliaTransfer({ provider, from: SENDER, to: RECEIVER, valueWei: "1" }),
    ).rejects.toThrow("Transaction refusée dans MetaMask. Aucun montant n'a été envoyé : vous pouvez réessayer sans risque.");
  });

  it("refuse un hash absent ou mal formé", async () => {
    const provider = providerMock(async () => "0x1234");

    await expect(
      sendSepoliaTransfer({ provider, from: SENDER, to: RECEIVER, valueWei: "1" }),
    ).rejects.toThrow("hash de transaction valide");
  });
});

describe("switchToSepolia", () => {
  it("bascule vers Sepolia avec le chainId officiel", async () => {
    const provider = providerMock(async () => null);

    await switchToSepolia(provider);

    expect(provider.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN.chainIdHex }],
    });
  });

  it("ajoute le réseau quand MetaMask ne le connaît pas (4902)", async () => {
    const request = vi.fn(async (args: { method: string }) => {
      if (args.method === "wallet_switchEthereumChain") throw { code: 4902 };
      return null;
    });
    const provider: EthereumProvider = { request };

    await switchToSepolia(provider);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: SEPOLIA_CHAIN.chainIdHex,
          chainName: "Sepolia",
          nativeCurrency: SEPOLIA_CHAIN.nativeCurrency,
          rpcUrls: [...SEPOLIA_CHAIN.rpcUrls],
          blockExplorerUrls: [...SEPOLIA_CHAIN.blockExplorerUrls],
        },
      ],
    });
  });

  it("signale un refus de changement de réseau", async () => {
    const provider = providerMock(async () => {
      throw { code: 4001 };
    });

    await expect(switchToSepolia(provider)).rejects.toThrow("changement de réseau. Le paiement exige Sepolia");
  });
});

describe("réseau Hardhat local", () => {
  it("décrit le réseau local 31337 sans explorateur public", () => {
    expect(HARDHAT_CHAIN.chainId).toBe(31337);
    expect(HARDHAT_CHAIN.chainIdHex).toBe("0x7a69");
    expect(HARDHAT_CHAIN.blockExplorerUrls).toEqual([]);
    expect(txUrlFor(HARDHAT_CHAIN, HASH)).toBeNull();
  });

  it("construit le réseau MetaMask depuis la configuration backend", () => {
    const network = networkFromConfig({
      network: "Hardhat Local",
      networkKey: "hardhat",
      chainId: 31337,
      chainIdHex: "0x7a69",
      rpcUrl: "http://127.0.0.1:8545",
      explorerBaseUrl: "",
    });

    expect(network.name).toBe("Hardhat Local");
    expect(network.chainIdHex).toBe("0x7a69");
    expect(network.rpcUrls).toEqual(["http://127.0.0.1:8545"]);
    expect(network.blockExplorerUrls).toEqual([]);
  });

  it("bascule vers Hardhat et ajoute le réseau sans explorateur", async () => {
    const request = vi.fn(async (args: { method: string }) => {
      if (args.method === "wallet_switchEthereumChain") throw { code: 4902 };
      return null;
    });
    const provider: EthereumProvider = { request };

    await switchToNetwork(HARDHAT_CHAIN, provider);

    expect(request).toHaveBeenLastCalledWith({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x7a69",
          chainName: "Hardhat Local",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["http://127.0.0.1:8545"],
        },
      ],
    });
  });

  it("envoie le même transfert natif sur le réseau fourni", async () => {
    const provider = providerMock(async () => HASH);

    const hash = await sendNativeTransfer({
      network: HARDHAT_CHAIN,
      provider,
      from: SENDER,
      to: RECEIVER,
      valueWei: "100000000000000000",
    });

    expect(hash).toBe(HASH);
    expect(provider.request).toHaveBeenCalledWith({
      method: "eth_sendTransaction",
      params: [{ from: SENDER, to: RECEIVER, value: "0x16345785d8a0000" }],
    });
  });

  it("ne divulgue pas le nom du réseau de développement dans les erreurs", () => {
    const message = metaMaskErrorMessage({ code: 4902 }, HARDHAT_CHAIN);
    expect(message).toContain("n'est pas encore ajouté à MetaMask");
    expect(message).not.toContain("Hardhat");
  });

  it("conserve le lien Etherscan pour Sepolia uniquement", () => {
    expect(txUrlFor(SEPOLIA_CHAIN, HASH)).toBe(`https://sepolia.etherscan.io/tx/${HASH}`);
  });
});

describe("sérialisation et bascule réseau MetaMask", () => {
  beforeEach(() => {
    resetWalletTransport();
  });

  it("reconnaît l'erreur « demande déjà en attente »", () => {
    expect(isRequestPendingError({ code: -32002 })).toBe(true);
    expect(isRequestPendingError({ code: 4001 })).toBe(false);
    expect(isRequestPendingError(null)).toBe(false);
  });

  it("refuse la seconde demande au lieu de la laisser en file", async () => {
    let active = 0;
    let maxActive = 0;
    let release: ((accounts: string[]) => void) | null = null;
    const request = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          release = (accounts: string[]) => {
            active -= 1;
            resolve(accounts);
          };
        }),
    );
    const provider: EthereumProvider = { request };

    const first = connectWallet(provider);
    const second = connectWallet(provider);

    // La seconde demande est refusée immédiatement (comme -32002) et nomme
    // la requête réellement en attente, au lieu d'attendre indéfiniment.
    await expect(second).rejects.toThrow("déjà une demande en attente");
    await expect(second).rejects.toThrow("eth_requestAccounts");
    expect(request).toHaveBeenCalledTimes(1);

    release!([SENDER]);
    await expect(first).resolves.toBe(SENDER);
    expect(maxActive).toBe(1);
  });

  it("libère la file après un refus de l'utilisateur", async () => {
    let calls = 0;
    const provider = providerMock(async ({ method }) => {
      if (method === "eth_requestAccounts") {
        calls += 1;
        if (calls === 1) throw { code: 4001 };
        return [SENDER];
      }
      return "0x7a69";
    });

    await expect(connectWallet(provider)).rejects.toThrow("refusée");
    // Le refus ne laisse ni verrou ni place réservée.
    await expect(connectWallet(provider)).resolves.toBe(SENDER);
    expect(getPendingWalletApproval()).toBeNull();
  });

  it("abandonne une demande muette et libère la place", async () => {
    await expect(
      walletRequest("wallet_switchEthereumChain", () => new Promise<unknown>(() => {}), 20),
    ).rejects.toThrow("n'a pas répondu");

    await expect(
      walletRequest("eth_requestAccounts", async () => [SENDER], 50),
    ).resolves.toEqual([SENDER]);
  });

  it("nomme la demande expirée qui bloque encore MetaMask", async () => {
    // Popup fermée sans réponse : MetaMask peut garder la demande en attente,
    // même si le site a abandonné. Un -32002 ultérieur doit la nommer.
    await expect(
      walletRequest("wallet_addEthereumChain", () => new Promise<unknown>(() => {}), 20),
    ).rejects.toThrow("n'a pas répondu");

    const message = metaMaskErrorMessage({ code: -32002 }, HARDHAT_CHAIN, {
      refusedMethod: "eth_requestAccounts",
    });

    expect(message).toContain("déjà une demande en attente");
    expect(message).toContain("wallet_addEthereumChain");
    expect(message).toContain("Aucun nouveau paiement n'a été créé");
  });

  it("nomme la requête refusée quand la demande en attente est antérieure au rechargement", () => {
    const message = metaMaskErrorMessage({ code: -32002 }, HARDHAT_CHAIN, {
      refusedMethod: "eth_requestAccounts",
    });

    expect(message).toContain("déjà une demande en attente");
    expect(message).toContain("eth_requestAccounts");
    expect(message).toContain("avant le chargement de la page");
  });

  it("ne tente pas de bascule quand une demande est déjà en attente", async () => {
    const methods: string[] = [];
    const provider = providerMock(async ({ method }) => {
      methods.push(method);
      throw { code: -32002 };
    });

    await expect(ensureNetwork(HARDHAT_CHAIN, provider)).rejects.toThrow(
      "déjà une demande en attente",
    );

    // Aucune seconde demande (switch/add) n'a été ajoutée derrière la première.
    expect(methods).toEqual(["eth_chainId"]);
  });

  it("ne bascule pas si MetaMask est déjà sur le bon réseau", async () => {
    const methods: string[] = [];
    const provider: EthereumProvider = {
      request: async ({ method }) => {
        methods.push(method);
        return "0x7a69";
      },
    };

    const chainId = await ensureNetwork(HARDHAT_CHAIN, provider);

    expect(chainId).toBe(31337);
    expect(methods).not.toContain("wallet_switchEthereumChain");
    expect(methods).not.toContain("wallet_addEthereumChain");
  });

  it("attend que la chaîne soit réellement active avant d'envoyer", async () => {
    let chainReads = 0;
    const provider: EthereumProvider = {
      request: async ({ method }) => {
        if (method === "eth_chainId") {
          chainReads += 1;
          // 1re lecture : mauvais réseau ; ensuite : Hardhat appliqué.
          return chainReads <= 2 ? "0x1" : "0x7a69";
        }
        if (method === "wallet_switchEthereumChain") throw { code: 4902 };
        if (method === "wallet_addEthereumChain") return null;
        throw new Error(`méthode inattendue ${method}`);
      },
    };

    const chainId = await ensureNetwork(HARDHAT_CHAIN, provider);

    expect(chainId).toBe(31337);
    expect(chainReads).toBeGreaterThanOrEqual(3);
  });

  it("échoue clairement si MetaMask ne bascule jamais", async () => {
    const provider: EthereumProvider = { request: async () => "0x1" };

    await expect(waitForChainId(HARDHAT_CHAIN, provider, 60)).rejects.toThrow(
      "n'a pas encore basculé sur le réseau de test local",
    );
  });

  it("signale un changement de compte ou de réseau pendant le paiement", () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const provider: EthereumProvider = {
      request: async () => null,
      on: (event, handler) => { handlers[event] = handler; },
      removeListener: (event) => { delete handlers[event]; },
    };
    const onAccountsChanged = vi.fn();
    const onChainChanged = vi.fn();
    const onDisconnect = vi.fn();

    const stop = watchWallet({ onAccountsChanged, onChainChanged, onDisconnect }, provider);
    handlers.accountsChanged([RECEIVER]);
    handlers.chainChanged("0x1");
    handlers.disconnect();

    expect(onAccountsChanged).toHaveBeenCalledWith([RECEIVER]);
    expect(onChainChanged).toHaveBeenCalledWith(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);

    stop();
    expect(handlers.accountsChanged).toBeUndefined();
    expect(handlers.chainChanged).toBeUndefined();
    expect(handlers.disconnect).toBeUndefined();
  });
});

describe("lecture du solde et des frais réels", () => {
  it("convertit les wei en ETH sans arrondi flottant", () => {
    expect(weiToEthString("1000000000000000000")).toBe("1");
    expect(weiToEthString("20000000000000000")).toBe("0.02");
    expect(weiToEthString("1")).toBe("0.000000000000000001");
    expect(weiToEthString("0")).toBe("0");
  });

  it("estime le montant en wei au taux du backend, au wei supérieur", () => {
    expect(tndToWeiEstimate(70, 3500)).toBe("20000000000000000");
    expect(tndToWeiEstimate(1, 3)).toBe("333333333333333334");
    expect(() => tndToWeiEstimate(10, 0)).toThrow("Taux TND/ETH invalide");
  });

  it("refuse une quantité RPC mal formée", () => {
    expect(quantityToWei("0x2540be400")).toBe("10000000000");
    expect(() => quantityToWei("1000")).toThrow("illisible");
    expect(() => quantityToWei(null)).toThrow(MetaMaskError);
  });

  it("lit le solde réel du compte et la hauteur de bloc", async () => {
    const provider = providerMock(async ({ method }) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_getBalance") return "0xde0b6b3a7640000";
      if (method === "eth_blockNumber") return "0x2a";
      throw new Error(`méthode inattendue ${method}`);
    });

    const reading = await readAccountBalance(provider, HARDHAT_CHAIN, SENDER);

    expect(reading.balanceWei).toBe("1000000000000000000");
    expect(reading.blockNumber).toBe(42);
    expect(provider.request).toHaveBeenCalledWith({
      method: "eth_getBalance",
      params: [SENDER, "latest"],
    });
  });

  it("n'affiche aucun solde si MetaMask n'est pas sur le réseau imposé", async () => {
    const provider = providerMock(async () => "0x1");

    await expect(readAccountBalance(provider, HARDHAT_CHAIN, SENDER)).rejects.toThrow(
      "MetaMask n'est pas sur le réseau requis",
    );
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_getBalance" }),
    );
  });

  it("bloque quand le solde renvoyé est illisible", async () => {
    const provider = providerMock(async ({ method }) => {
      if (method === "eth_chainId") return "0x7a69";
      return "not-hex";
    });

    await expect(readAccountBalance(provider, HARDHAT_CHAIN, SENDER)).rejects.toThrow("illisible");
  });

  it("estime les frais avec une marge de 20 %", async () => {
    const provider = providerMock(async ({ method }) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_gasPrice") return "0x3b9aca00";
      throw new Error(`méthode inattendue ${method}`);
    });

    const gas = await estimateTransferGas(provider, HARDHAT_CHAIN, {
      from: SENDER,
      to: RECEIVER,
      valueWei: "100000000000000000",
    });

    expect(gas.gasLimit).toBe("21000");
    expect(gas.gasPriceWei).toBe("1000000000");
    expect(gas.feeWei).toBe("21000000000000");
    expect(gas.bufferedFeeWei).toBe("25200000000000");
    expect(provider.request).toHaveBeenCalledWith({
      method: "eth_estimateGas",
      params: [{ from: SENDER, to: RECEIVER, value: "0x16345785d8a0000" }],
    });
  });

  it("échoue fermé si l'estimation de gas échoue", async () => {
    const provider = providerMock(async ({ method }) => {
      if (method === "eth_chainId") return "0x7a69";
      throw new Error("estimate failed");
    });

    await expect(
      estimateTransferGas(provider, HARDHAT_CHAIN, {
        from: SENDER,
        to: RECEIVER,
        valueWei: "100000000000000000",
      }),
    ).rejects.toThrow("Impossible d'estimer les frais");
  });
});

describe("envoi unique et non bloquant", () => {
  beforeEach(() => {
    resetWalletTransport();
  });

  it("refuse une seconde signature pendant un envoi déjà en attente", async () => {
    let resolveHash: ((hash: string) => void) | null = null;
    const request = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveHash = resolve as (hash: string) => void;
        }),
    );
    const input = {
      provider: { request } as EthereumProvider,
      from: SENDER,
      to: RECEIVER,
      valueWei: "1",
    };

    const first = sendNativeTransfer(input);
    await expect(sendNativeTransfer(input)).rejects.toThrow("déjà en attente");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_sendTransaction" }),
    );

    resolveHash!(HASH);
    await expect(first).resolves.toBe(HASH);
  });

  it("continue de lire le réseau pendant qu'une signature est en attente", async () => {
    let resolveHash: ((hash: string) => void) | null = null;
    const request = vi.fn(
      (args: { method: string }) =>
        args.method === "eth_chainId"
          ? Promise.resolve("0x7a69")
          : new Promise<unknown>((resolve) => {
              resolveHash = resolve as (hash: string) => void;
            }),
    );
    const provider: EthereumProvider = { request };

    // La signature ne se résout pas tout de suite (popup ouverte)…
    const pending = sendNativeTransfer({ provider, from: SENDER, to: RECEIVER, valueWei: "1" });
    // …mais une lecture n'est pas mise en file derrière elle.
    await expect(
      walletRequest("eth_chainId", () => provider.request({ method: "eth_chainId" }), 100),
    ).resolves.toBe("0x7a69");

    resolveHash!(HASH);
    await expect(pending).resolves.toBe(HASH);
  });
});

describe("garde-fous adresses et nonce (déploiement accidentel interdit)", () => {
  beforeEach(() => {
    resetWalletTransport();
  });

  it("reconnaît une adresse EVM complète uniquement", () => {
    expect(isEvmAddress(RECEIVER)).toBe(true);
    expect(isEvmAddress(`  ${RECEIVER}  `)).toBe(true);
    expect(isEvmAddress("0x1234")).toBe(false);
    expect(isEvmAddress("")).toBe(false);
    expect(isEvmAddress(undefined)).toBe(false);
  });

  it("refuse une estimation de gas sans destinataire, sans appeler le nœud", async () => {
    const request = vi.fn(async () => "0x5208");
    const provider: EthereumProvider = { request };

    await expect(
      estimateTransferGas(provider, HARDHAT_CHAIN, {
        from: SENDER,
        to: "",
        valueWei: "1",
      }),
    ).rejects.toThrow("Adresse de réception invalide");
    expect(request).not.toHaveBeenCalled();
  });

  it("refuse une estimation de gas avec un expéditeur invalide", async () => {
    const request = vi.fn(async () => "0x5208");
    const provider: EthereumProvider = { request };

    await expect(
      estimateTransferGas(provider, HARDHAT_CHAIN, {
        from: "0x1234",
        to: RECEIVER,
        valueWei: "1",
      }),
    ).rejects.toThrow("Adresse du compte expéditeur invalide");
    expect(request).not.toHaveBeenCalled();
  });

  it("refuse un transfert sans destinataire : jamais de création de contrat", async () => {
    const request = vi.fn(async () => HASH);
    const provider: EthereumProvider = { request };

    await expect(
      sendNativeTransfer({
        provider,
        from: SENDER,
        to: "0x",
        valueWei: "1",
      }),
    ).rejects.toThrow("Adresse de réception");
    expect(request).not.toHaveBeenCalled();
  });

  it("refuse un transfert avec un expéditeur invalide", async () => {
    const request = vi.fn(async () => HASH);
    const provider: EthereumProvider = { request };

    await expect(
      sendNativeTransfer({
        provider,
        from: "",
        to: RECEIVER,
        valueWei: "1",
      }),
    ).rejects.toThrow("Adresse du compte expéditeur invalide");
    expect(request).not.toHaveBeenCalled();
  });

  it("lit le nonce pending réel attendu par le nœud", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_getTransactionCount") return "0x2a";
      throw new Error(`méthode inattendue ${method}`);
    });

    await expect(readPendingNonce({ request } as EthereumProvider, SENDER)).resolves.toBe("42");
    expect(request).toHaveBeenCalledWith({
      method: "eth_getTransactionCount",
      params: [SENDER, "pending"],
    });
  });

  it("ne lit aucun nonce pour une adresse invalide", async () => {
    const request = vi.fn(async () => "0x0");
    await expect(readPendingNonce({ request } as EthereumProvider, "0x1")).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("traduit « Nonce too high » et relit le nonce attendu, sans renvoyer", async () => {
    resetWalletTransport();
    const methods: string[] = [];
    const provider = providerMock(async ({ method }) => {
      methods.push(method);
      if (method === "eth_sendTransaction") {
        throw {
          code: -32000,
          message:
            "Nonce too high. Expected nonce to be 0 but got 3. " +
            "Note that transactions can't be queued when automining.",
        };
      }
      if (method === "eth_getTransactionCount") return "0x0";
      throw new Error(`méthode inattendue ${method}`);
    });

    const error = await sendNativeTransfer({
      network: HARDHAT_CHAIN,
      provider,
      from: SENDER,
      to: RECEIVER,
      valueWei: "1",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MetaMaskError);
    expect((error as MetaMaskError).code).toBe(METAMASK_NONCE_ERROR);
    expect((error as MetaMaskError).message).toContain("nonce déjà utilisé");
    expect((error as MetaMaskError).message).toContain("nonce 0");
    expect((error as MetaMaskError).message).toContain("Effacer les données d'activité");
    expect((error as MetaMaskError).message).toContain("Aucun montant n'a été envoyé");
    expect(methods.filter((method) => method === "eth_sendTransaction")).toHaveLength(1);
    expect(methods).toContain("eth_getTransactionCount");
  });

  it("traduit « nonce too low » sans imposer de nonce", async () => {
    const provider = providerMock(async ({ method }) => {
      if (method === "eth_sendTransaction") {
        throw { code: -32000, message: "nonce too low" };
      }
      if (method === "eth_getTransactionCount") return "0x5";
      throw new Error(`méthode inattendue ${method}`);
    });

    await expect(
      sendNativeTransfer({ provider, from: SENDER, to: RECEIVER, valueWei: "1" }),
    ).rejects.toThrow("nonce inférieur à celui déjà consommé");
  });

  it("ne renvoie jamais une transaction déjà connue du nœud", async () => {
    resetWalletTransport();
    let sends = 0;
    const provider = providerMock(async ({ method }) => {
      if (method !== "eth_sendTransaction") throw new Error(`méthode inattendue ${method}`);
      sends += 1;
      throw { code: -32000, message: "already known" };
    });

    await expect(
      sendNativeTransfer({ provider, from: SENDER, to: RECEIVER, valueWei: "1" }),
    ).rejects.toThrow("déjà été soumise au réseau");
    expect(sends).toBe(1);
    expect(isAlreadyKnownError({ message: "already known" })).toBe(true);
  });

  it("libère le verrou d'envoi après un refus de nonce", async () => {
    resetWalletTransport();
    let attempt = 0;
    const provider = providerMock(async ({ method }) => {
      if (method === "eth_getTransactionCount") return "0x0";
      if (method !== "eth_sendTransaction") throw new Error(`méthode inattendue ${method}`);
      attempt += 1;
      if (attempt === 1) throw { code: -32000, message: "Nonce too high. Expected nonce to be 0 but got 3." };
      return HASH;
    });
    const input = { provider, from: SENDER, to: RECEIVER, valueWei: "1" };

    await expect(sendNativeTransfer(input)).rejects.toThrow("nonce déjà utilisé");
    await expect(sendNativeTransfer(input)).resolves.toBe(HASH);
  });

  it("reconnaît les erreurs de nonce dans les objets imbriqués de MetaMask", () => {
    const nested = {
      code: -32603,
      message: "Internal JSON-RPC error.",
      data: { originalError: { message: "Nonce too high. Expected nonce to be 0 but got 3." } },
    };
    expect(isNonceError(nested)).toBe(true);
    expect(metaMaskErrorMessage(nested)).toContain("nonce déjà utilisé");
  });
});
