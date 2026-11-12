/**
 * Mémoire locale (sessionStorage) des tentatives de paiement.
 *
 * Deux valeurs doivent survivre à un rechargement de page, sinon le même
 * paiement peut être recréé ou renvoyé :
 * 1. la clé d'idempotence d'un couple (facture, moyen, montant) : elle est
 *    renvoyée au backend tel quel, qui reprend l'intention existante au lieu
 *    d'en créer une seconde ;
 * 2. le hash déjà obtenu pour une intention : une transaction soumise à
 *    MetaMask n'est jamais renvoyée, même si la vérification serveur a échoué
 *    et que la page a été rechargée entre-temps.
 *
 * Le stockage est volontairement local à l'onglet et sans secret : ni clé
 * privée, ni montant, ni adresse. En cas d'indisponibilité (navigation privée,
 * tests), une mémoire de module prend le relais.
 */

export type PaymentJournalStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type PaymentJournalData = {
  keys: Record<string, string>;
  hashes: Record<string, string>;
};

const JOURNAL_KEY = "freelancetn.payment.attempts";
const JOURNAL_LIMIT = 20;

const EMPTY: PaymentJournalData = { keys: {}, hashes: {} };

const memoryValues = new Map<string, string>();
const memoryStorage: PaymentJournalStorage = {
  getItem: (key) => memoryValues.get(key) ?? null,
  setItem: (key, value) => {
    memoryValues.set(key, value);
  },
  removeItem: (key) => {
    memoryValues.delete(key);
  },
};

const browserStorage = (): PaymentJournalStorage => {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
  } catch {
    // Stockage refusé par le navigateur : la mémoire de module suffit.
  }
  return memoryStorage;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const onlyStrings = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );
  return Object.fromEntries(entries.slice(-JOURNAL_LIMIT));
};

const read = (storage: PaymentJournalStorage): PaymentJournalData => {
  try {
    const raw = storage.getItem(JOURNAL_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return EMPTY;
    return { keys: onlyStrings(parsed.keys), hashes: onlyStrings(parsed.hashes) };
  } catch {
    return EMPTY;
  }
};

const write = (storage: PaymentJournalStorage, data: PaymentJournalData) => {
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify(data));
  } catch {
    // Journal indisponible : aucune protection n'est retirée côté paiement.
  }
};

const isHash = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value.trim());

const defaultKey = () =>
  `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type PaymentJournal = {
  /** Clé stable pour un couple (facture, moyen, montant), y compris après reload. */
  idempotencyKey: (signature: string, generate?: () => string) => string;
  /** Oublie la clé d'idempotence d'un couple, pour ouvrir un nouveau paiement. */
  forgetKey: (signature: string) => void;
  /** Mémorise le hash d'une intention : elle ne sera plus jamais renvoyée. */
  rememberSubmittedHash: (transactionId: string, hash: string) => void;
  /** Hash déjà soumis pour cette intention, ou `null`. */
  submittedHash: (transactionId: string) => string | null;
  /** Oublie une intention (paiement confirmé ou abandonné explicitement). */
  forget: (transactionId: string) => void;
};

export const createPaymentJournal = (
  storage: PaymentJournalStorage = browserStorage(),
): PaymentJournal => ({
  idempotencyKey: (signature, generate = defaultKey) => {
    const data = read(storage);
    const existing = data.keys[signature];
    if (existing) return existing;
    const key = generate();
    write(storage, { ...data, keys: onlyStrings({ ...data.keys, [signature]: key }) });
    return key;
  },

  forgetKey: (signature) => {
    if (!signature) return;
    const data = read(storage);
    if (!data.keys[signature]) return;
    const keys = { ...data.keys };
    delete keys[signature];
    write(storage, { ...data, keys });
  },

  rememberSubmittedHash: (transactionId, hash) => {
    const value = (hash || "").trim();
    if (!transactionId || !isHash(value)) return;
    const data = read(storage);
    // Un hash déjà connu reste prioritaire : on ne remplace jamais une preuve
    // d'envoi par une autre valeur.
    if (data.hashes[transactionId]) return;
    write(storage, {
      ...data,
      hashes: onlyStrings({ ...data.hashes, [transactionId]: value }),
    });
  },

  submittedHash: (transactionId) => {
    if (!transactionId) return null;
    const hash = read(storage).hashes[transactionId];
    return hash && isHash(hash) ? hash : null;
  },

  forget: (transactionId) => {
    const data = read(storage);
    if (!data.hashes[transactionId]) return;
    const hashes = { ...data.hashes };
    delete hashes[transactionId];
    write(storage, { ...data, hashes });
  },
});

/** Journal utilisé par l'interface de paiement (sessionStorage). */
export const paymentJournal = createPaymentJournal();
