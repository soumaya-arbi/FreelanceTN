import { describe, expect, it } from "vitest";
import { createPaymentJournal, type PaymentJournalStorage } from "@/lib/paymentJournal";

const HASH = `0x${"ef".repeat(32)}`;
const OTHER_HASH = `0x${"12".repeat(32)}`;

const fakeStorage = (): PaymentJournalStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
};

describe("journal de paiement local", () => {
  it("réutilise la même clé d'idempotence après un rechargement", () => {
    const storage = fakeStorage();
    const beforeReload = createPaymentJournal(storage);
    const key = beforeReload.idempotencyKey("invoice-1|metamask|70.000", () => "pay-key-1");

    // Nouvelle instance = nouveau montage de l'interface / page rechargée.
    const afterReload = createPaymentJournal(storage);

    expect(key).toBe("pay-key-1");
    expect(afterReload.idempotencyKey("invoice-1|metamask|70.000", () => "pay-key-2")).toBe(
      "pay-key-1",
    );
  });

  it("crée une clé distincte quand le montant ou le moyen change", () => {
    const journal = createPaymentJournal(fakeStorage());

    const full = journal.idempotencyKey("invoice-1|metamask|70.000", () => "key-full");
    const partial = journal.idempotencyKey("invoice-1|metamask|35.000", () => "key-partial");
    const card = journal.idempotencyKey("invoice-1|card|70.000", () => "key-card");

    expect(new Set([full, partial, card]).size).toBe(3);
  });

  it("mémorise le hash soumis pour empêcher un second envoi après reload", () => {
    const storage = fakeStorage();
    createPaymentJournal(storage).rememberSubmittedHash("tx-1", HASH);

    const afterReload = createPaymentJournal(storage);

    expect(afterReload.submittedHash("tx-1")).toBe(HASH);
    expect(afterReload.submittedHash("tx-2")).toBeNull();
  });

  it("ne remplace jamais un hash déjà mémorisé", () => {
    const storage = fakeStorage();
    const journal = createPaymentJournal(storage);

    journal.rememberSubmittedHash("tx-1", HASH);
    journal.rememberSubmittedHash("tx-1", OTHER_HASH);

    expect(journal.submittedHash("tx-1")).toBe(HASH);
  });

  it("ignore un hash invalide", () => {
    const journal = createPaymentJournal(fakeStorage());

    journal.rememberSubmittedHash("tx-1", "0x1234");

    expect(journal.submittedHash("tx-1")).toBeNull();
  });

  it("oublie une intention sur demande", () => {
    const journal = createPaymentJournal(fakeStorage());
    journal.rememberSubmittedHash("tx-1", HASH);

    journal.forget("tx-1");

    expect(journal.submittedHash("tx-1")).toBeNull();
  });

  it("oublie la clé d'idempotence pour ouvrir un nouveau paiement", () => {
    const storage = fakeStorage();
    const journal = createPaymentJournal(storage);
    const signature = "invoice-1|metamask|70.000";

    const first = journal.idempotencyKey(signature, () => "key-first");
    journal.forgetKey(signature);
    const second = createPaymentJournal(storage).idempotencyKey(signature, () => "key-second");

    expect(first).toBe("key-first");
    expect(second).toBe("key-second");
  });

  it("ignore une clé d'idempotence absente", () => {
    const journal = createPaymentJournal(fakeStorage());

    expect(() => journal.forgetKey("")).not.toThrow();
    expect(() => journal.forgetKey("invoice-inconnue|metamask|1.000")).not.toThrow();
  });

  it("repart proprement si le stockage contient des données illisibles", () => {
    const storage = fakeStorage();
    storage.setItem("freelancetn.payment.attempts", "not-json");

    const journal = createPaymentJournal(storage);

    expect(journal.submittedHash("tx-1")).toBeNull();
    expect(journal.idempotencyKey("invoice-1|metamask|70.000", () => "pay-key-1")).toBe("pay-key-1");
  });
});
