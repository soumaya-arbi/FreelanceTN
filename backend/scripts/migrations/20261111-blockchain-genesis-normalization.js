/**
 * Migration — empreinte Genesis et normalisation des hashes blockchain
 * =====================================================================
 *
 * Objectif : rendre l'identité d'un transfert blockchain = (Genesis normalisé,
 * hash normalisé), puis remplacer l'ancien index unique global
 * `ux_payments_blockchainTxHash` par `ux_payments_genesis_txHash`.
 *
 * ÉTAT : préparée, JAMAIS exécutée dans le cadre de la Phase 1.
 * Aucun code applicatif ne supprime l'ancien index : cette migration est la
 * seule voie de suppression, et elle refuse de le faire si l'audit détecte une
 * collision.
 *
 * Exécution (depuis la racine du dépôt) :
 *
 *   # 1) Audit en lecture seule (par défaut) — aucune écriture
 *   mongosh "mongodb://localhost:27017/freelancetn_dev" \
 *     backend/scripts/migrations/20261111-blockchain-genesis-normalization.js
 *
 *   # 2) Application réelle, après validation de l'audit
 *   MIGRATION_MODE=apply \
 *   mongosh "mongodb://localhost:27017/freelancetn_dev" \
 *     backend/scripts/migrations/20261111-blockchain-genesis-normalization.js
 *
 * Sur PowerShell :
 *   $env:MIGRATION_MODE="apply"
 *   mongosh "mongodb://localhost:27017/freelancetn_dev" backend/scripts/migrations/...
 *
 * Le script est idempotent : relancé en mode apply, il ne réécrit rien
 * d'utile et ne recrée pas les index existants.
 */

const COLL = "paymentTransactions";
const AUDITS = "paymentAudits";
const BACKUP = "paymentTransactions_backup_20261111_genesis";

const LEGACY_HASH_INDEX = "ux_payments_blockchainTxHash";
const COMPOSITE_INDEX = "ux_payments_genesis_txHash";
const HASH_LOOKUP_INDEX = "ix_payments_blockchainTxHash";

const MODE = (() => {
  try {
    if (typeof process !== "undefined" && process.env && process.env.MIGRATION_MODE) {
      return String(process.env.MIGRATION_MODE).toLowerCase();
    }
  } catch (_) {
    /* mongosh sans process : mode sûr */
  }
  return "audit";
})();

if (MODE !== "audit" && MODE !== "apply") {
  print(`Mode inconnu : "${MODE}". Valeurs acceptées : audit | apply.`);
  quit(2);
}

const APPLY = MODE === "apply";
const payments = db.getCollection(COLL);
const audits = db.getCollection(AUDITS);

const log = (message) => print(message);
const heading = (message) => print(`\n=== ${message} ===`);

/**
 * Normalise un champ chaîne dans une agrégation, sans confondre "absent" et
 * chaîne vide : une empreinte Genesis absente reste `null`.
 */
const normalizedField = (field) => ({
  $cond: [
    { $eq: [{ $type: `$${field}` }, "string"] },
    { $toLower: `$${field}` },
    null,
  ],
});

/** Doublons exacts sur le hash brut (ce que l'ancien index unique protège). */
const rawHashDuplicates = () =>
  payments
    .aggregate([
      { $match: { blockchainTxHash: { $type: "string" } } },
      {
        $group: {
          _id: "$blockchainTxHash",
          count: { $sum: 1 },
          payments: { $push: { id: "$_id", reference: "$reference" } },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

/**
 * Doublons sur l'identité normalisée (Genesis, hash). C'est le contrôle
 * bloquant : l'index composite unique refusera ces documents.
 * Un document dont le Genesis est absent est indexé avec la valeur null : deux
 * paiements historiques portant le même hash sont donc bien détectés ici.
 */
const normalizedIdentityDuplicates = () =>
  payments
    .aggregate([
      { $match: { blockchainTxHash: { $type: "string" } } },
      {
        $project: {
          reference: 1,
          genesis: normalizedField("blockchainGenesisHash"),
          hash: normalizedField("blockchainTxHash"),
        },
      },
      {
        $group: {
          _id: { genesis: "$genesis", hash: "$hash" },
          count: { $sum: 1 },
          payments: { $push: { id: "$_id", reference: "$reference" } },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

/** Même hash sur plusieurs instances : autorisé, mais doit être audité. */
const crossGenesisShares = () =>
  payments
    .aggregate([
      { $match: { blockchainTxHash: { $type: "string" } } },
      {
        $project: {
          genesis: normalizedField("blockchainGenesisHash"),
          hash: normalizedField("blockchainTxHash"),
        },
      },
      {
        $group: {
          _id: "$hash",
          instances: { $addToSet: "$genesis" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 }, "instances.1": { $exists: true } } },
    ])
    .toArray();

/** Paiements historiques : hash présent, Genesis inconnu (jamais créditables). */
const legacyWithoutGenesis = () =>
  payments.countDocuments({
    blockchainTxHash: { $type: "string" },
    $or: [
      { blockchainGenesisHash: { $exists: false } },
      { blockchainGenesisHash: null },
      { blockchainGenesisHash: "" },
    ],
  });

/** Doublons de clé d'audit (bloqueraient l'index unique du journal). */
const auditDedupeDuplicates = () =>
  audits
    .aggregate([
      { $match: { dedupeKey: { $type: "string" } } },
      { $group: { _id: "$dedupeKey", count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

const printGroups = (groups, label) => {
  if (groups.length === 0) {
    log(`  ${label} : aucun`);
    return;
  }
  log(`  ${label} : ${groups.length} groupe(s)`);
  groups.slice(0, 20).forEach((group) => {
    log(`    - ${EJSON.stringify(group._id)} x${group.count}`);
    (group.payments || []).slice(0, 5).forEach((payment) => {
      log(`        ${payment.reference} (${payment.id})`);
    });
  });
  if (groups.length > 20) log(`    … ${groups.length - 20} groupe(s) supplémentaire(s)`);
};

const report = (title) => {
  heading(title);
  const raw = rawHashDuplicates();
  const identity = normalizedIdentityDuplicates();
  const cross = crossGenesisShares();
  const legacy = legacyWithoutGenesis();
  const dedupe = auditDedupeDuplicates();

  printGroups(raw, "Doublons de hash brut");
  printGroups(identity, "Doublons d'identité (Genesis, hash) normalisée");
  printGroups(cross, "Hash partagés entre plusieurs instances Genesis (autorisé)");
  printGroups(dedupe, "Doublons de clé d'audit");

  log(`  Paiements avec hash mais sans Genesis (non créditables) : ${legacy}`);
  log(`  Total de paiements : ${payments.countDocuments({})}`);

  return { raw, identity, cross, legacy, dedupe };
};

const indexNames = () => payments.getIndexes().map((index) => index.name);

// ---------------------------------------------------------------------------
// 1. Audit initial (toujours exécuté, lecture seule)
// ---------------------------------------------------------------------------
const initial = report("AUDIT INITIAL — avant toute écriture");

heading("Index actuellement présents sur " + COLL);
indexNames().forEach((name) => log(`  - ${name}`));

if (initial.identity.length > 0) {
  log(
    "\nATTENTION : des doublons d'identité (Genesis, hash) existent déjà. " +
      "L'index composite unique ne pourra pas être créé et le mode apply sera refusé."
  );
}
if (initial.dedupe.length > 0) {
  log(
    "\nATTENTION : le journal d'audit contient des clés dupliquées. " +
      "L'index unique du journal sera créé seulement après nettoyage manuel."
  );
}

if (!APPLY) {
  heading("MODE AUDIT — aucune écriture effectuée");
  log("Relancez avec MIGRATION_MODE=apply après validation de ce rapport.");
  quit(initial.identity.length > 0 ? 1 : 0);
}

if (initial.identity.length > 0) {
  heading("MIGRATION REFUSÉE");
  log(
    "Des collisions d'identité subsistent : résolvez-les manuellement " +
      "(aucune suppression automatique de paiement n'est autorisée)."
  );
  quit(1);
}

// ---------------------------------------------------------------------------
// 2. Sauvegarde
// ---------------------------------------------------------------------------
heading("SAUVEGARDE");
const backupFilter = {
  $or: [
    { blockchainTxHash: { $exists: true } },
    { blockchainGenesisHash: { $exists: true } },
  ],
};
const backupCount = payments.countDocuments(backupFilter);
payments.aggregate([{ $match: backupFilter }, { $out: BACKUP }]).toArray();
log(`  ${backupCount} document(s) copiés dans ${BACKUP}`);
log(`  Index sauvegardés (journal) :`);
payments.getIndexes().forEach((index) => log(`    ${EJSON.stringify(index)}`));

// ---------------------------------------------------------------------------
// 3. Normalisation (minuscules)
// ---------------------------------------------------------------------------
heading("NORMALISATION DES HASHES");
const normalizeField = (field) => {
  const result = payments.updateMany(
    { [field]: { $type: "string" } },
    [{ $set: { [field]: { $toLower: `$${field}` } } }]
  );
  log(`  ${field} : ${result.modifiedCount} document(s) normalisé(s)`);
};
normalizeField("blockchainTxHash");
normalizeField("blockchainGenesisHash");

// ---------------------------------------------------------------------------
// 4. Ré-audit après normalisation
// ---------------------------------------------------------------------------
const after = report("RÉ-AUDIT — après normalisation");
if (after.identity.length > 0) {
  heading("MIGRATION INTERROMPUE");
  log("Des collisions sont apparues après normalisation. L'ancien index est conservé.");
  quit(1);
}

// ---------------------------------------------------------------------------
// 5. Remplacement de l'ancien index unique
// ---------------------------------------------------------------------------
heading("INDEX");
if (indexNames().includes(LEGACY_HASH_INDEX)) {
  payments.dropIndex(LEGACY_HASH_INDEX);
  log(`  Ancien index supprimé : ${LEGACY_HASH_INDEX}`);
} else {
  log(`  Ancien index absent : ${LEGACY_HASH_INDEX}`);
}

payments.createIndex(
  { blockchainGenesisHash: 1, blockchainTxHash: 1 },
  {
    name: COMPOSITE_INDEX,
    unique: true,
    partialFilterExpression: { blockchainTxHash: { $type: "string" } },
  }
);
log(`  Index créé : ${COMPOSITE_INDEX} (unique partiel sur blockchainTxHash)`);

payments.createIndex({ blockchainTxHash: 1 }, { name: HASH_LOOKUP_INDEX });
log(`  Index créé : ${HASH_LOOKUP_INDEX} (recherche non unique)`);

// ---------------------------------------------------------------------------
// 6. Index du journal d'audit
// ---------------------------------------------------------------------------
const remainingDedupe = auditDedupeDuplicates();
if (remainingDedupe.length === 0) {
  audits.createIndex({ dedupeKey: 1 }, { name: "ux_paymentAudits_dedupeKey", unique: true });
  audits.createIndex(
    { paymentId: 1, createdAt: -1 },
    { name: "ix_paymentAudits_paymentId_createdAt" }
  );
  log("  Index du journal d'audit créés.");
} else {
  log(
    `  Index du journal d'audit NON créés : ${remainingDedupe.length} clé(s) dupliquée(s). ` +
      "Nettoyage manuel requis (le journal est append-only)."
  );
}

// ---------------------------------------------------------------------------
// 7. Vérification finale
// ---------------------------------------------------------------------------
heading("ÉTAT FINAL");
payments.getIndexes().forEach((index) => log(`  - ${index.name}`));
log(`  Doublons d'identité restants : ${normalizedIdentityDuplicates().length}`);
log(`  Sauvegarde disponible : ${BACKUP}`);
log("\nMigration terminée. Vérifiez l'application (démarrage + audit) avant reprise.");
quit(0);
