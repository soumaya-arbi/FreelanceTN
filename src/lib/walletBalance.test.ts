import { describe, expect, it } from "vitest";
import {
  balanceIdentityError,
  providerSyncError,
  shortAddress,
} from "@/lib/walletBalance";

const CLIENT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const CONFIG = { chainId: 31337, networkKey: "hardhat", network: "Hardhat Local" };
const TEN_THOUSAND = "10000000000000000000000";
const NINE_NINE = "9999799000000000000000";

describe("contrôle d'identité du solde", () => {
  const data = { address: CLIENT, chainId: 31337, networkKey: "hardhat" };

  it("accepte la même adresse, le même réseau et le même chainId", () => {
    expect(balanceIdentityError({ account: CLIENT.toLowerCase(), config: CONFIG, data })).toBeNull();
  });

  it("refuse une réponse qui concerne un autre compte", () => {
    const error = balanceIdentityError({
      account: CLIENT,
      config: CONFIG,
      data: { ...data, address: OTHER },
    });
    expect(error).toContain("ne correspondent pas");
    expect(error).toContain(shortAddress(OTHER));
    expect(error).toContain(shortAddress(CLIENT));
  });

  it("refuse une réponse d'un autre réseau", () => {
    const error = balanceIdentityError({
      account: CLIENT,
      config: CONFIG,
      data: { ...data, chainId: 11155111, networkKey: "sepolia" },
    });
    expect(error).toContain("autre réseau");
    expect(error).toContain("Hardhat Local");
  });

  it("refuse une réponse sans adresse", () => {
    expect(
      balanceIdentityError({ account: CLIENT, config: CONFIG, data: { ...data, address: "" } }),
    ).toContain("aucun solde fiable");
  });
});

describe("comparaison MetaMask / backend", () => {
  const data = {
    address: CLIENT,
    chainId: 31337,
    networkKey: "hardhat",
    balanceWei: TEN_THOUSAND,
  };

  it("accepte deux lectures identiques du même compte", () => {
    expect(
      providerSyncError({
        providerChainId: 31337,
        providerBalanceWei: TEN_THOUSAND,
        data,
        config: CONFIG,
        address: CLIENT,
      }),
    ).toBeNull();
  });

  it("refuse un provider resté sur un autre réseau", () => {
    const error = providerSyncError({
      providerChainId: 11155111,
      providerBalanceWei: TEN_THOUSAND,
      data,
      config: CONFIG,
      address: CLIENT,
    });
    expect(error).toContain("11155111");
    expect(error).toContain("31337");
  });

  it("signale une désynchronisation au lieu d'afficher une valeur fausse", () => {
    const error = providerSyncError({
      providerChainId: 31337,
      providerBalanceWei: NINE_NINE,
      data,
      config: CONFIG,
      address: CLIENT,
    });
    expect(error).toContain("9 999,799");
    expect(error).toContain("10 000");
    expect(error).toContain("ne sont pas synchronisées");
  });

  it("refuse un montant en wei illisible", () => {
    expect(
      providerSyncError({
        providerChainId: 31337,
        providerBalanceWei: "0x21e19e0c9bab2400000",
        data,
        config: CONFIG,
        address: CLIENT,
      }),
    ).toContain("illisible");
  });
});
