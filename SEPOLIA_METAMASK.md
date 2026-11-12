# MetaMask — paiement Sepolia vérifié on-chain

Ce document décrit l'intégration MetaMask de FreelanceTN. Elle est **limitée à
Ethereum Sepolia** (`chainId 11155111`) et s'inscrit dans un projet académique :
les ETH utilisés sont des jetons de test sans valeur réelle. Aucun parcours
Mainnet et aucun paiement réel n'existent dans le code.

## Principe

1. Le client choisit **MetaMask (Sepolia)** et un montant en TND.
2. Le backend crée une intention `pending` : montant TND, équivalent en **wei**
   (taux fixe configurable), adresse de réception et `chainId = 11155111`.
   **Aucun crédit n'est appliqué à cette étape.**
3. Le navigateur demande à MetaMask d'envoyer **exactement** ce montant en wei
   vers l'adresse figée par le serveur, puis transmet uniquement le **hash**.
4. Le backend relit la blockchain en JSON-RPC (`eth_chainId`,
   `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_blockNumber`)
   et ne valide que si toutes les conditions sont réunies :
   - réseau Sepolia ;
   - destinataire = adresse de réception configurée ;
   - montant en wei **strictement égal** à l'intention ;
   - transaction exécutée (`status = 0x1`) ;
   - confirmations ≥ `Blockchain:MinConfirmations` (2 par défaut) ;
   - hash jamais utilisé par un autre paiement ;
   - portefeuille identique à celui lié au compte après le premier succès.
5. Alors seulement : crédit atomique de la facture, reçu PDF et notifications
   existants.

Le backend **ne détient aucune clé privée ni seed**. Il ne fait que lire la
blockchain publique.

## Configuration (hors dépôt)

Les valeurs sensibles passent par les User Secrets :

```powershell
cd backend/src/FreelanceTn.Api

dotnet user-secrets set "Blockchain:ReceiverAddress" "0xVOTRE_ADRESSE_SEPOLIA"
dotnet user-secrets set "Blockchain:TndPerEth" "3500"
dotnet user-secrets set "Blockchain:MinConfirmations" "2"
# Facultatif : autre nœud RPC Sepolia (HTTPS uniquement)
dotnet user-secrets set "Blockchain:RpcUrl" "https://ethereum-sepolia-rpc.publicnode.com"
```

Équivalents par variables d'environnement :
`Blockchain__ReceiverAddress`, `Blockchain__TndPerEth`, etc.

Garde-fous :

- `Blockchain:RpcUrl` doit être en **HTTPS** et ne peut pas contenir `mainnet` ;
  l'application refuse de démarrer sinon.
- Le `chainId` réel du nœud est contrôlé à chaque vérification : un RPC qui ne
  sert pas Sepolia fait échouer le paiement avec `blockchain_wrong_network`.
- Si `ReceiverAddress` est vide, le moyen MetaMask est marqué indisponible et
  toute création est refusée avec un message explicite (HTTP 502). Aucun crédit
  fictif de repli n'existe.

## Taux de conversion

Le taux est **fixe et déterministe** (`Blockchain:TndPerEth`, 3 500 TND/ETH par
défaut). Aucun oracle externe n'est appelé. La conversion en wei est arrondie au
wei **supérieur** pour ne jamais sous-facturer.

Exemple : 350 TND ÷ 3 500 = 0,1 ETH = `100000000000000000` wei.

## API

| Méthode | Route | Rôle |
| --- | --- | --- |
| `GET` | `/api/payments/blockchain/config` | Réseau, destinataire, taux, confirmations requises, Etherscan |
| `POST` | `/api/payments` | Crée l'intention MetaMask (`method: "metamask"`), provider imposé à `blockchain` |
| `POST` | `/api/payments/{id}/verify-blockchain` | Vérifie `{ "txHash": "0x…" }` et crédite si tout est conforme |
| `GET` | `/api/payments/{id}/receipt` | Reçu PDF (uniquement après succès vérifié) |

Réponse de transaction (extrait) : `blockchainTxHash`, `walletAddress`,
`blockchainChainId`, `blockchainReceiver`, `blockchainAmountWei`,
`blockchainAmountEth`, `blockchainTndPerEth`, `blockchainExplorerUrl`,
`blockchainConfirmations`.

Garanties complémentaires :

- une intention MetaMask **ne peut pas** être traitée, relancée ou annulée
  localement (`process`, `retry`, `cancel` renvoient 409) : un transfert a pu
  partir, seule la blockchain fait foi ;
- l'index MongoDB unique `ux_payments_blockchainTxHash` bloque le rejeu d'un
  même hash ;
- le premier paiement réussi lie l'adresse émettrice au compte ; un autre
  portefeuille est refusé (`blockchain_wallet_mismatch`).

## Démonstration

1. Installer l'extension **MetaMask** et créer/ouvrir un portefeuille de test.
2. Ajouter le réseau **Sepolia** (MetaMask le propose, ou
   `wallet_addEthereumChain` le fait automatiquement depuis l'application).
3. Obtenir des ETH de test via un faucet Sepolia officiel.
4. Configurer `Blockchain:ReceiverAddress` avec l'adresse du portefeuille qui
   doit recevoir les fonds (idéalement la même que celle utilisée pour payer,
   ou un second compte de démonstration).
5. Se connecter en client (`clientdev@test.com` / `Password123!`), ouvrir une
   facture impayée, choisir **MetaMask (Sepolia)**, saisir le montant, puis
   confirmer dans MetaMask.
6. Vérifier dans l'interface : hash, montant ETH, confirmations, lien
   `sepolia.etherscan.io`, reçu PDF. La facture n'est créditée qu'après le
   seuil de confirmations.

En cas de rejet dans MetaMask : aucun montant n'est envoyé, la facture reste
inchangée et l'intention peut être reprise (même destinataire, même montant).

## Tests

```powershell
# Backend : stub JSON-RPC en mémoire, aucun appel réseau
cd backend
dotnet test src/FreelanceTn.Api.Tests/FreelanceTn.Api.Tests.csproj --filter "FullyQualifiedName~SepoliaPaymentTests"

# Frontend
npm run typecheck
npm run test
```

Scénarios couverts : intention sans crédit, confirmations insuffisantes puis
succès, mauvais réseau, mauvais destinataire, montant erroné d'un wei,
transaction échouée, hash rejoué, portefeuille non lié, provider imposé,
conversion et arrondi, refus de `process`/`retry`/`cancel`.

## Hors périmètre

Mainnet, remboursements, KYC, oracle de prix, virement et « autre moyen »
restent hors de cette intégration. Le moyen historique
« Portefeuille FreelanceTN » reste lisible dans l'historique mais n'est plus
proposé pour un nouveau paiement.

## Environnement local Hardhat

Un second réseau de test est disponible pour les paiements MetaMask :
**Hardhat Local** (`chainId 31337`, RPC `http://127.0.0.1:8545`). Le réseau
actif est choisi par `Blockchain:Network` (`Sepolia` ou `Hardhat`) ; la
configuration Sepolia décrite ici n'est jamais écrasée. Chaque intention fige
son `chainId`, ce qui empêche toute vérification croisée entre les deux
réseaux. Procédure complète : [`HARDHAT_LOCAL.md`](HARDHAT_LOCAL.md).
