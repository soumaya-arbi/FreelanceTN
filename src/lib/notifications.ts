/**
 * Texte de notification destiné à l'interface.
 *
 * Les notifications de paiement sont enregistrées avec des repères techniques
 * (nom du réseau de test, hash de transaction). Ces informations restent en
 * base pour la traçabilité, mais elles ne doivent pas apparaître dans le
 * centre de notifications : on les retire uniquement à l'affichage, sans
 * modifier la notification elle-même.
 */
export function publicNotificationText(value?: string | null): string {
  if (!value) return "";
  return value
    .replace(/,?\s*\btx\s+0x[a-f0-9]{64}\b/gi, "")
    .replace(/\s*\(\s*(?:Hardhat Local|Sepolia|localhost[^)]*)\s*\)/gi, "")
    .replace(/\b(?:Hardhat Local|Sepolia)\b/gi, "")
    .replace(/\(\s*MetaMask[^)]*\)/gi, " via MetaMask")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}
