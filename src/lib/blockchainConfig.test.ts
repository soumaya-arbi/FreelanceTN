import { describe, expect, it } from "vitest";
import {
  BLOCKCHAIN_ACCOUNTS,
  BLOCKCHAIN_NETWORK,
  EXPECTED_CLIENT_ADDRESS,
  EXPECTED_FREELANCER_ADDRESS,
  HARDHAT_CHAIN_ID,
  HARDHAT_CHAIN_ID_HEX,
  HARDHAT_RPC_URL,
  accountRoleForAddress,
  addressesMatch,
  clientAccountMismatchMessage,
  isExpectedClientAddress,
  isExpectedFreelancerAddress,
  isHardhatChain,
  normalizeAddress,
} from "@/lib/blockchainConfig";

describe("blockchainConfig", () => {
  it("configure les deux comptes Hardhat sans les intervertir", () => {
    expect(BLOCKCHAIN_ACCOUNTS.client.index).toBe(0);
    expect(BLOCKCHAIN_ACCOUNTS.client.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(BLOCKCHAIN_ACCOUNTS.freelancer.index).toBe(1);
    expect(BLOCKCHAIN_ACCOUNTS.freelancer.address).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(BLOCKCHAIN_ACCOUNTS.client.address).not.toBe(BLOCKCHAIN_ACCOUNTS.freelancer.address);
    expect(EXPECTED_CLIENT_ADDRESS).toBe(BLOCKCHAIN_ACCOUNTS.client.address);
    expect(EXPECTED_FREELANCER_ADDRESS).toBe(BLOCKCHAIN_ACCOUNTS.freelancer.address);
  });

  it("décrit le réseau Hardhat Local attendu", () => {
    expect(HARDHAT_RPC_URL).toBe("http://127.0.0.1:8545");
    expect(HARDHAT_CHAIN_ID).toBe(31337);
    expect(HARDHAT_CHAIN_ID_HEX).toBe("0x7a69");
    expect(BLOCKCHAIN_NETWORK).toMatchObject({
      key: "hardhat",
      name: "Hardhat Local",
      chainId: 31337,
      chainIdHex: "0x7a69",
      nativeCurrency: { symbol: "ETH", decimals: 18 },
      rpcUrls: ["http://127.0.0.1:8545"],
    });
    expect(isHardhatChain(31337)).toBe(true);
    expect(isHardhatChain(11155111)).toBe(false);
    expect(isHardhatChain(null)).toBe(false);
  });

  it("compare les adresses sans tenir compte de la casse ni des espaces", () => {
    const lower = EXPECTED_CLIENT_ADDRESS.toLowerCase();
    expect(normalizeAddress(`  ${lower}  `)).toBe(lower);
    expect(addressesMatch(lower, EXPECTED_CLIENT_ADDRESS)).toBe(true);
    expect(addressesMatch(EXPECTED_CLIENT_ADDRESS, EXPECTED_CLIENT_ADDRESS)).toBe(true);
    expect(addressesMatch("", "")).toBe(false);
    expect(addressesMatch(null, EXPECTED_CLIENT_ADDRESS)).toBe(false);
  });

  it("identifie séparément le compte client et le compte destinataire", () => {
    expect(isExpectedClientAddress(EXPECTED_CLIENT_ADDRESS)).toBe(true);
    expect(isExpectedClientAddress(EXPECTED_FREELANCER_ADDRESS)).toBe(false);
    expect(isExpectedFreelancerAddress(EXPECTED_FREELANCER_ADDRESS)).toBe(true);
    expect(isExpectedFreelancerAddress(EXPECTED_CLIENT_ADDRESS)).toBe(false);
    // Une autre adresse Hardhat valide n'est ni le client ni le destinataire.
    expect(isExpectedClientAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC")).toBe(false);
  });

  it("renvoie le rôle applicatif d'une adresse connue", () => {
    expect(accountRoleForAddress(EXPECTED_CLIENT_ADDRESS)).toBe("client");
    expect(accountRoleForAddress(EXPECTED_FREELANCER_ADDRESS)).toBe("freelancer");
    expect(accountRoleForAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC")).toBeNull();
    expect(accountRoleForAddress(undefined)).toBeNull();
  });

  it("explique un compte MetaMask différent sans forcer le compte attendu", () => {
    const message = clientAccountMismatchMessage("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    expect(message).toContain("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    expect(message).toContain(EXPECTED_CLIENT_ADDRESS);
    expect(message).toContain("Aucun compte n'est sélectionné à votre place");
  });
});
