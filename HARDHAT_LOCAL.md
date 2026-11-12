# Environnement blockchain local Hardhat — FreelanceTN

Guide d'exploitation du réseau de test **Hardhat Local** (chainId `31337`)
utilisé pour valider les paiements MetaMask sans dépendre de Sepolia.

L'intégration Sepolia reste intacte : le backend supporte deux réseaux de test
et le réseau actif est choisi explicitement. Aucun basculement silencieux,
aucun accès Mainnet.

---

## 1. Principe

| Élément | Sepolia (existant) | Hardhat Local (ajouté) |
| --- | --- | --- |
| chainId | `11155111` (`0xaa36a7`) | `31337` (`0x7a69`) |
| RPC | HTTPS public | `http://127.0.0.1:8545` (boucle locale obligatoire) |
| Explorateur | `sepolia.etherscan.io` | aucun |
| Confirmations par défaut | 2 | 2 (surchargeable, 1 en local) |
| Clés privées | aucune côté backend | aucune côté backend |

Le backend ne signe pas et ne stocke aucune clé. Il lit le nœud en JSON-RPC
(`eth_chainId`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`,
`eth_blockNumber`) et n'applique un crédit qu'après contrôle de :

1. **réseau** — le `chainId` du nœud doit égaler celui figé dans l'intention ;
2. **destinataire** — adresse de réception du réseau actif ;
3. **montant exact** — valeur en wei calculée à la création ;
4. **reçu** — transaction minée avec statut `0x1` ;
5. **confirmations** — seuil du réseau actif ;
6. **anti-rejeu** — un hash ne crédite qu'une seule transaction ;
7. **idempotence** — un paiement déjà réussi n'est jamais recrédité.

Chaque intention mémorise `BlockchainChainId`, `BlockchainReceiver` et
`BlockchainAmountWei` : changer la configuration après coup ne peut pas
détourner une vérification en cours.

---

## 2. Démarrage et arrêt

### Nœud Hardhat

```powershell
cd "C:\Users\Soumaya Arbi\Downloads\Freelancer Marketplace Platform\hardhat"
npm install            # une seule fois
npm run node           # http://127.0.0.1:8545, chainId 31337
```

Arrêt : `Ctrl+C` dans ce terminal (ou fermer la fenêtre). Le réseau est
éphémère : chaque redémarrage repart d'un état vierge, avec les mêmes comptes
et les mêmes soldes.

### API backend en mode Hardhat

Les secrets sont stockés dans les User Secrets .NET (hors dépôt) :

```powershell
$api = "C:\Users\Soumaya Arbi\Downloads\Freelancer Marketplace Platform\backend\src\FreelanceTn.Api\FreelanceTn.Api.csproj"

dotnet user-secrets set "Blockchain:Network" "Hardhat" --project $api
dotnet user-secrets set "Blockchain:Hardhat:RpcUrl" "http://127.0.0.1:8545" --project $api
dotnet user-secrets set "Blockchain:Hardhat:ReceiverAddress" "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" --project $api
dotnet user-secrets set "Blockchain:Hardhat:MinConfirmations" "1" --project $api

dotnet run --project $api --launch-profile http
```

Arrêt : `Ctrl+C` dans le terminal de l'API.

### Retour à Sepolia (sans rien supprimer)

```powershell
dotnet user-secrets set "Blockchain:Network" "Sepolia" --project $api
```

`Blockchain:Sepolia:ReceiverAddress` et `Blockchain:ReceiverAddress` restent
inchangés : la configuration Sepolia n'est jamais écrasée par le mode Hardhat.

---

## 3. Comptes de développement

```powershell
cd hardhat
npm run accounts
```

| # | Rôle | Adresse publique | Solde initial |
| --- | --- | --- | --- |
| 0 | `FreelanceTN Client` (payeur) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | 10 000 ETH locaux |
| 1 | `FreelanceTN Receiver` (destinataire) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | 10 000 ETH locaux |

Les clés privées complètes sont affichées par `npm run accounts` ; elles ne
figurent volontairement dans aucun fichier du dépôt. Elles n'existent que sur
la chaîne locale, n'ont aucun fonds réel et ne doivent jamais être utilisées
sur Mainnet ou Sepolia.

Pour un mnémonique dédié, copier `hardhat/.env.example` en `hardhat/.env`
(ignoré par Git) et y renseigner `HARDHAT_MNEMONIC`, puis relancer le nœud.

---

## 4. MetaMask

Paramètres à ajouter dans MetaMask (la bascule est aussi proposée
automatiquement par l'interface FreelanceTN via `wallet_addEthereumChain`) :

| Champ | Valeur |
| --- | --- |
| Nom du réseau | `Hardhat Local` |
| Nouvelle URL RPC | `http://127.0.0.1:8545` |
| ID de chaîne | `31337` |
| Symbole de la devise | `ETH` |
| URL de l'explorateur | *(laisser vide)* |

Importer les comptes : **Comptes → Importer un compte → clé privée** (#0 pour
payer, #1 pour constater la réception). Le premier paiement réussi lie le
portefeuille payeur au compte FreelanceTN ; les suivants doivent partir de la
même adresse.

Le frontend lit `GET /api/payments/blockchain/config` et impose le réseau du
backend : il ne peut pas proposer un autre chainId que celui configuré.

---

## 5. Vérification de bout en bout

```powershell
# 1. Nœud et API démarrés (sections 2)
# 2. Transfert de contrôle, hors application
cd hardhat
npm run smoke

# 3. Dans l'application : Facturation → Payer → MetaMask (ETH de test)
#    → confirmer dans MetaMask sur Hardhat Local.
```

L'API répond alors avec le libellé `MetaMask (Hardhat Local)`, le hash, les
confirmations et le crédit de facture correspondant. Un second appel
`POST /api/payments/{id}/verify-blockchain` avec le même hash ne recrédite pas
la facture.

Contrôle direct du nœud :

```powershell
$body = @{ jsonrpc="2.0"; id=1; method="eth_chainId"; params=@() } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method Post -ContentType "application/json" -Body $body
# -> 0x7a69
```

---

## 6. Dépannage

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| `Le nœud Hardhat Local est injoignable` | nœud arrêté | `npm run node` |
| `Le nœud RPC ne sert pas Hardhat Local` | RPC Sepolia en mode Hardhat | corriger `Blockchain:Hardhat:RpcUrl` |
| Paiement en attente de confirmations | seuil > 1 en local | `Blockchain:Hardhat:MinConfirmations=1` |
| MetaMask reste sur Sepolia | changement refusé | accepter la bascule ou ajouter le réseau manuellement |
| `already associated to another payment` | hash réutilisé | créer une nouvelle intention |

---

## 7. Sécurité

- Le mode Hardhat refuse toute URL RPC qui n'est pas en boucle locale
  (`127.0.0.1`, `localhost`, `::1`).
- Le mode Sepolia refuse HTTP et tout hôte contenant `mainnet`.
- Aucune clé privée n'est transmise au frontend, au backend ou aux logs :
  seules les adresses publiques circulent.
- `hardhat/.env` et `hardhat/node_modules` sont ignorés par Git.
