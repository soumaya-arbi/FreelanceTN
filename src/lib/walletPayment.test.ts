import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  HARDHAT_CHAIN,
  MetaMaskError,
  resetWalletTransport,
  type EthereumProvider,
} from "@/lib/metamask";
import { openWalletSession, preflightTransfer, sendIntentTransfer, assertSufficientFunds, insufficientFundsMessage } from "@/lib/walletPayment";

const HASH = `0x${"cd".repeat(32)}`;
const SENDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const RECEIVER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

type Handler = (...args: unknown[]) => void;

const fakeProvider = (
  handler: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>,
) => {
  const handlers: Record<string, Handler> = {};
  const request = vi.fn(handler);
  const provider: EthereumProvider = {
    request,
    on: (event, callback) => {
      handlers[event] = callback;
    },
    removeListener: (event) => {
      delete handlers[event];
    },
  };
  return { provider, request, handlers };
};

/**
 * Provider complet pour `sendIntentTransfer` : il répond aussi aux lectures
 * `eth_accounts` / `eth_chainId` faites juste avant la signature, et conserve
 * les `eth_sendTransaction` réellement tentés.
 */
const sessionProvider = (
  handler: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>,
  options: { account?: string | null; chainId?: string } = {},
) => {
  const { account = SENDER, chainId = "0x7a69" } = options;
  const sends: Array<{ method: string; params?: unknown[] | Record<string, unknown> }> = [];
  const fake = fakeProvider(async (args) => {
    if (args.method === "eth_accounts") return account === null ? [] : [account];
    if (args.method === "eth_chainId") return chainId;
    if (args.method === "eth_sendTransaction") sends.push(args);
    return handler(args);
  });
  return { ...fake, sends };
};

describe("openWalletSession", () => {
  beforeEach(() => {
    resetWalletTransport();
  });

  it("connecte puis impose le réseau, dans cet ordre", async () => {
    const methods: string[] = [];
    const { provider } = fakeProvider(async ({ method }) => {
      methods.push(method);
      if (method === "eth_requestAccounts") return [SENDER];
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts") return [SENDER];
      throw new Error(`méthode inattendue ${method}`);
    });

    const session = await openWalletSession(provider, HARDHAT_CHAIN);

    expect(session.from).toBe(SENDER);
    expect(session.network.chainId).toBe(31337);
    expect(methods[0]).toBe("eth_requestAccounts");
    expect(methods).not.toContain("eth_sendTransaction");
  });

  it("n'ouvre aucune session si MetaMask a déjà une demande en attente", async () => {
    const { provider, request } = fakeProvider(async () => {
      throw { code: -32002 };
    });

    await expect(openWalletSession(provider, HARDHAT_CHAIN)).rejects.toThrow(
      "déjà une demande en attente",
    );
    // Une seule demande a été tentée : aucune bascule, aucun envoi.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("propage un refus de connexion", async () => {
    const { provider } = fakeProvider(async () => {
      throw { code: 4001 };
    });

    await expect(openWalletSession(provider, HARDHAT_CHAIN)).rejects.toThrow("Transaction refusée");
  });

  it("ne demande qu'une seule connexion pour deux clics simultanés", async () => {
    const { provider, request } = fakeProvider(async ({ method }) => {
      if (method === "eth_requestAccounts") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [SENDER];
      }
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts") return [SENDER];
      throw new Error(`méthode inattendue ${method}`);
    });

    const [first, second] = await Promise.all([
      openWalletSession(provider, HARDHAT_CHAIN),
      openWalletSession(provider, HARDHAT_CHAIN),
    ]);

    // Même session partagée : une seule fenêtre MetaMask, aucun second appel
    // en attente derrière elle.
    expect(second).toBe(first);
    expect(first.from).toBe(SENDER);
    expect(request.mock.calls.filter(([args]) => args.method === "eth_requestAccounts")).toHaveLength(1);
  });

  it("permet de réessayer après un -32002 déjà résolu dans MetaMask", async () => {
    let attempts = 0;
    const { provider } = fakeProvider(async ({ method }) => {
      if (method === "eth_requestAccounts") {
        attempts += 1;
        if (attempts === 1) throw { code: -32002 };
        return [SENDER];
      }
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts") return [SENDER];
      throw new Error(`méthode inattendue ${method}`);
    });

    await expect(openWalletSession(provider, HARDHAT_CHAIN)).rejects.toThrow(
      "déjà une demande en attente",
    );

    // Le refus ne laisse ni session partagée ni place réservée.
    await expect(openWalletSession(provider, HARDHAT_CHAIN)).resolves.toMatchObject({
      from: SENDER,
    });
    expect(attempts).toBe(2);
  });

  it("refuse une session si le compte change pendant la connexion", async () => {
    const { provider } = fakeProvider(async ({ method }) => {
      if (method === "eth_requestAccounts") return [SENDER];
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts") return [RECEIVER];
      throw new Error(`méthode inattendue ${method}`);
    });

    await expect(openWalletSession(provider, HARDHAT_CHAIN)).rejects.toThrow(
      "Le compte MetaMask a changé pendant la connexion",
    );
  });
});

describe("sendIntentTransfer", () => {
  const session = { provider: null as unknown as EthereumProvider, from: SENDER, network: HARDHAT_CHAIN };

  it("envoie exactement une fois le montant en wei imposé par le backend", async () => {
    const { provider, sends } = sessionProvider(async () => HASH);

    const hash = await sendIntentTransfer(
      { ...session, provider },
      { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
    );

    expect(hash).toBe(HASH);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toEqual({
      method: "eth_sendTransaction",
      params: [{ from: SENDER, to: RECEIVER, value: "0x16345785d8a0000" }],
    });
  });

  it("ne renvoie jamais une intention qui possède déjà un hash", async () => {
    const { provider, request } = sessionProvider(async () => HASH);

    const hash = await sendIntentTransfer(
      { ...session, provider },
      { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000", txHash: HASH },
    );

    expect(hash).toBe(HASH);
    expect(request).not.toHaveBeenCalled();
  });

  it("reste à un seul transfert si la même intention est resoumise", async () => {
    const { provider, sends } = sessionProvider(async () => HASH);

    const first = await sendIntentTransfer(
      { ...session, provider },
      { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
    );
    const second = await sendIntentTransfer(
      { ...session, provider },
      { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000", txHash: first },
    );

    expect(second).toBe(first);
    expect(sends).toHaveLength(1);
  });

  it("remonte l'erreur -32002 sans nouvelle tentative", async () => {
    const { provider, sends } = sessionProvider(async () => {
      throw { code: -32002 };
    });

    await expect(
      sendIntentTransfer(
        { ...session, provider },
        { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
      ),
    ).rejects.toBeInstanceOf(MetaMaskError);
    expect(sends).toHaveLength(1);
  });

  it("refuse une intention incomplète sans appeler MetaMask", async () => {
    const { provider, request } = fakeProvider(async () => HASH);

    await expect(
      sendIntentTransfer(
        { ...session, provider },
        { id: "pay-1", receiver: "", amountWei: "100000000000000000" },
      ),
    ).rejects.toThrow("incomplète");
    expect(request).not.toHaveBeenCalled();
  });

  it("annule l'envoi si le compte change avant la signature", async () => {
    const request = vi.fn(async () => HASH);
    const provider: EthereumProvider = {
      request,
      on: (event, callback) => {
        // MetaMask signale le changement de compte avant que l'envoi ne parte.
        if (event === "accountsChanged") callback([RECEIVER]);
      },
      removeListener: () => undefined,
    };

    await expect(
      sendIntentTransfer(
        { ...session, provider },
        { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
      ),
    ).rejects.toThrow("Le compte ou le réseau MetaMask a changé");
    expect(request).not.toHaveBeenCalled();
  });

  it("annule l'envoi si le réseau change avant la signature", async () => {
    const request = vi.fn(async () => HASH);
    const provider: EthereumProvider = {
      request,
      on: (event, callback) => {
        if (event === "chainChanged") callback("0x1");
      },
      removeListener: () => undefined,
    };

    await expect(
      sendIntentTransfer(
        { ...session, provider },
        { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
      ),
    ).rejects.toThrow("Le compte ou le réseau MetaMask a changé");
    expect(request).not.toHaveBeenCalled();
  });

  it("se désabonne après l'envoi", async () => {
    const removed: string[] = [];
    const { provider } = sessionProvider(async () => HASH);
    const originalRemove = provider.removeListener!;
    provider.removeListener = (event, handler) => {
      removed.push(event);
      originalRemove(event, handler);
    };

    await sendIntentTransfer(
      { ...session, provider },
      { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
    );

    expect(removed).toContain("accountsChanged");
    expect(removed).toContain("chainChanged");
    expect(removed).toContain("disconnect");
  });

  it("refuse d'envoyer si le compte sélectionné a changé avant la signature", async () => {
    const { provider, sends } = sessionProvider(async () => HASH, { account: RECEIVER });

    await expect(
      sendIntentTransfer(
        { ...session, provider },
        { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
      ),
    ).rejects.toThrow("Le compte MetaMask a changé depuis l'ouverture du paiement");
    expect(sends).toHaveLength(0);
  });

  it("refuse d'envoyer si le réseau a changé avant la signature", async () => {
    const { provider, sends } = sessionProvider(async () => HASH, { chainId: "0x1" });

    await expect(
      sendIntentTransfer(
        { ...session, provider },
        { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
      ),
    ).rejects.toThrow("MetaMask n'est plus sur");
    expect(sends).toHaveLength(0);
  });

  it("refuse d'envoyer si aucun compte n'est sélectionné", async () => {
    const { provider, sends } = sessionProvider(async () => HASH, { account: null });

    await expect(
      sendIntentTransfer(
        { ...session, provider },
        { id: "pay-1", receiver: RECEIVER, amountWei: "100000000000000000" },
      ),
    ).rejects.toThrow("Aucun compte MetaMask n'est sélectionné");
    expect(sends).toHaveLength(0);
  });
});

describe("preflightTransfer", () => {
  const session = { provider: null as unknown as EthereumProvider, from: SENDER, network: HARDHAT_CHAIN };
  const ONE_ETH = "1000000000000000000";
  const GAS_FEE = "25200000000000"; // 21 000 gas × 1 gwei + marge de 20 %

  const fundedProvider = (balanceWei: string, overrides: Record<string, unknown> = {}) => {
    const methods: string[] = [];
    const provider: EthereumProvider = {
      request: async ({ method }) => {
        methods.push(method);
        if (method === "eth_chainId") return "0x7a69";
        if (method === "eth_getBalance") return `0x${BigInt(balanceWei).toString(16)}`;
        if (method === "eth_blockNumber") return "0x2a";
        if (method === "eth_estimateGas") return "0x5208";
        if (method === "eth_gasPrice") return "0x3b9aca00";
        throw new Error(`méthode inattendue ${method}`);
      },
    };
    return { provider: { ...provider, ...overrides }, methods };
  };

  it("autorise le paiement quand le solde couvre le montant et les frais", async () => {
    const { provider } = fundedProvider(ONE_ETH);

    const check = await preflightTransfer({ ...session, provider }, RECEIVER, "100000000000000000");

    expect(check.sufficient).toBe(true);
    expect(check.reason).toBe("ok");
    expect(check.balanceWei).toBe(ONE_ETH);
    expect(check.requiredWei).toBe("100025200000000000");
    expect(check.shortfallWei).toBe("0");
    expect(check.gas?.bufferedFeeWei).toBe(GAS_FEE);
    expect(check.blockNumber).toBe(42);
  });

  it("bloque quand le solde est inférieur au montant du paiement", async () => {
    const { provider, methods } = fundedProvider("50000000000000000");

    const check = await preflightTransfer({ ...session, provider }, RECEIVER, "100000000000000000");

    expect(check.sufficient).toBe(false);
    expect(check.reason).toBe("amount");
    expect(check.shortfallWei).toBe("50000000000000000");
    expect(methods).not.toContain("eth_estimateGas");
    expect(() => assertSufficientFunds(check)).toThrow("il manque 0.05 ETH");
  });

  it("bloque quand le montant passe mais pas les frais de réseau", async () => {
    const { provider } = fundedProvider("100000000000000000");

    const check = await preflightTransfer({ ...session, provider }, RECEIVER, "100000000000000000");

    expect(check.sufficient).toBe(false);
    expect(check.reason).toBe("fees");
    expect(check.shortfallWei).toBe(GAS_FEE);
    expect(insufficientFundsMessage(check)).toContain("frais de réseau");
    expect(insufficientFundsMessage(check)).toContain("0.0000252 ETH");
  });

  it("échoue fermé si la lecture du solde échoue", async () => {
    const provider: EthereumProvider = {
      request: async ({ method }) => {
        if (method === "eth_chainId") return "0x7a69";
        throw new Error("rpc down");
      },
    };

    await expect(
      preflightTransfer({ ...session, provider }, RECEIVER, "100000000000000000"),
    ).rejects.toThrow("Impossible de lire le solde");
  });

  it("échoue fermé si l'estimation des frais est indisponible", async () => {
    const provider: EthereumProvider = {
      request: async ({ method }) => {
        if (method === "eth_chainId") return "0x7a69";
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        if (method === "eth_blockNumber") return "0x2a";
        if (method === "eth_estimateGas") throw new Error("estimate unavailable");
        throw new Error(`méthode inattendue ${method}`);
      },
    };

    await expect(
      preflightTransfer({ ...session, provider }, RECEIVER, "100000000000000000"),
    ).rejects.toThrow("Impossible d'estimer les frais");
  });

  it("refuse une adresse de réception invalide sans lancer de lecture", async () => {
    const methods: string[] = [];
    const provider: EthereumProvider = {
      request: async ({ method }) => {
        methods.push(method);
        return "0x0";
      },
    };

    await expect(
      preflightTransfer({ ...session, provider }, "0x1234", "100000000000000000"),
    ).rejects.toThrow("Adresse de réception invalide");
    expect(methods).toHaveLength(0);
  });

  it("refuse de lire un solde sur un autre réseau", async () => {
    const provider: EthereumProvider = {
      request: async ({ method }) => {
        if (method === "eth_chainId") return "0x1";
        return "0x0";
      },
    };

    await expect(
      preflightTransfer({ ...session, provider }, RECEIVER, "100000000000000000"),
    ).rejects.toThrow("MetaMask n'est pas sur le réseau requis");
  });
});
