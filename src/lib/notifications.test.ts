import { describe, expect, it } from "vitest";
import { publicNotificationText } from "@/lib/notifications";

describe("publicNotificationText", () => {
  it("retire le réseau de test et le hash de transaction", () => {
    const message =
      "Votre paiement de 40.000 TND pour la facture FAC-HARDHAT-121823 a été confirmé " +
      "(MetaMask Hardhat Local, tx 0x8339afef42f7d0b8f33c0eb7c52e2a038235c16462a301569b62a7b55e518b82). " +
      "Reçu REC-2026-000015. Solde restant : 0.000 TND.";
    const text = publicNotificationText(message);

    expect(text).toContain("via MetaMask");
    expect(text).toContain("Reçu REC-2026-000015");
    expect(text).not.toContain("Hardhat");
    expect(text).not.toContain("0x8339");
    expect(text).not.toMatch(/\(\s*\)/);
  });

  it("retire aussi le nom du réseau entre parenthèses", () => {
    expect(publicNotificationText("Paiement MetaMask (Hardhat Local) confirmé.")).toBe(
      "Paiement MetaMask confirmé.",
    );
    expect(publicNotificationText("Paiement MetaMask (Sepolia) confirmé.")).toBe(
      "Paiement MetaMask confirmé.",
    );
  });

  it("laisse intact un texte sans repère technique", () => {
    expect(publicNotificationText("Facture réglée")).toBe("Facture réglée");
    expect(publicNotificationText("")).toBe("");
    expect(publicNotificationText(null)).toBe("");
  });
});
