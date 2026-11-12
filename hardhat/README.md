# FreelanceTN — réseau Hardhat local

Ce dossier contient uniquement l'environnement de test **local** (chainId
`31337`). Il ne remplace pas Sepolia : les deux réseaux cohabitent, et le
réseau actif est choisi explicitement dans la configuration du backend.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `hardhat.config.js` | Réseau `hardhat` (chainId 31337, 10 000 ETH/compte) + réseau `localhost`. |
| `network-accounts.js` | Mnémonique de développement et paramètres de dérivation (aucune clé privée). |
| `scripts/accounts.js` | Affiche adresses, clés privées **de test** et soldes. |
| `scripts/smoke-transfer.js` | Transfert réel Client → Receiver avec reçu et contrôles on-chain. |
| `.env.example` | Modèle de `hardhat/.env` (ignoré par Git) pour un mnémonique dédié. |

## Démarrage

```powershell
cd hardhat
npm install          # une seule fois
npm run node         # nœud JSON-RPC sur http://127.0.0.1:8545
```

`Ctrl+C` dans ce terminal arrête le nœud (les données locales sont perdues :
le réseau repart de zéro au prochain démarrage).

## Comptes

```powershell
cd hardhat
npm run accounts
```

Deux comptes sont utilisés par FreelanceTN :

| # | Rôle | Adresse |
| --- | --- | --- |
| 0 | `FreelanceTN Client` (payeur) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| 1 | `FreelanceTN Receiver` (destinataire) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |

Solde initial : **10 000 ETH locaux** par compte. Les clés privées sont
affichées par `npm run accounts` et ne sont **jamais** versionnées : ne les
importez que dans un MetaMask de test, sur Hardhat Local.

## Transfert de contrôle

```powershell
cd hardhat
npm run smoke                     # 0,01 ETH Client -> Receiver
$env:AMOUNT_ETH="0.05"; npm run smoke
```

Le script affiche le hash, le bloc, le reçu, les confirmations et recontrôle
expéditeur / destinataire / montant exact lus sur le nœud.

## MetaMask

Ajoutez le réseau (ou laissez FreelanceTN l'ajouter automatiquement) :

| Champ | Valeur |
| --- | --- |
| Nom | `Hardhat Local` |
| RPC | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Symbole | `ETH` |
| Explorateur | *(aucun)* |

Importez ensuite les clés privées de `npm run accounts` (#0 pour payer,
#1 pour observer la réception).

## Sécurité

- Aucune clé privée dans le dépôt, le frontend, les logs backend ou les
  fichiers de configuration versionnés.
- Le backend ne signe jamais : il lit le nœud en JSON-RPC (lecture seule).
- Le réseau Hardhat n'accepte qu'une URL RPC en boucle locale ; un arrêt du
  nœud rend simplement la vérification indisponible (aucun crédit fictif).
- Ces comptes n'ont aucune valeur et ne doivent jamais être utilisés sur
  Mainnet, Sepolia ou un autre réseau public.

Guide complet : [`../HARDHAT_LOCAL.md`](../HARDHAT_LOCAL.md).
