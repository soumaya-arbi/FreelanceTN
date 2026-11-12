# PHASE 0 — Rapport de récupération et stabilisation

Date : 06/11/2026
Périmètre : récupération uniquement. Aucun problème 5 à 9 démarré. Aucune nouvelle fonctionnalité ajoutée.
Aucune donnée MongoDB modifiée, aucun compte/projet/proposition/invitation supprimé.

---

## 1. État initial des fichiers inspectés

| Fichier | Taille initiale | État constaté |
|---|---|---|
| `src/components/layout/AppShell.tsx` | 2 557 octets | Ne compile pas : expression JSX non fermée (TS2657 + TS1005). Le bouton `role-switch` avait aussi disparu lors d'une réécriture précédente. |
| `src/components/views/client/ClientPostPage.tsx` | 22 695 octets | Compile une fois AppShell réparé, mais contient une variante de bouton inexistante et une mise en page cassée par les règles CSS existantes. Le bloc global « Retry failed uploads » avait été supprimé. |
| `src/components/views/freelancer/FreelancerModule.tsx` | 11 160 octets | Ne compile pas : hooks utilisés avant déclaration, variable `info` supprimée, états de refus inexistants, balises JSX mal fermées (TS17002/TS1005). |

Aucune déclaration en double de `showSidebarLogo` n'a été trouvée dans le fichier réellement présent sur disque. L'erreur venait d'un `}` manquant, pas d'un doublon.

---

## 2. Erreurs réellement identifiées

### AppShell.tsx
1. `{mobileOpen&&<button className="sidebar-scrim" ... />` n'était jamais fermée par `}` avant `<aside>`. C'est la cause exacte de :
   - `TS2657: JSX expressions must have one parent element` (colonne 87)
   - `TS1005: '}' expected` (fin de ligne)
2. Le bloc `<button className="role-switch" ...>` (bascule Client/Freelancer) avait été supprimé. Preuve objective : `isClient` devenait inutilisé et le lint remontait un avertissement.

### ClientPostPage.tsx
1. `<Button variant="outline">` : `Button` n'accepte que `primary | secondary | ghost | dark`.
2. Phrase de confirmation mal concaténée : `${durationUnit}available` (mot collé) et risque de doublon « TND ».
3. `.editor-success>div{display:flex;justify-content:center}` s'applique à **tous** les `div` directs : le bloc titre et le bloc pièces jointes étaient écrasés en ligne.
4. Le bloc de retry global (`retryUpload`, `uploadError`, `publishing`) avait été supprimé.
5. Le bouton « Retry » s'affichait aussi pour les fichiers déjà réussis.

### FreelancerModule.tsx
1. `useEffect` utilisait `setInvitations` / `setInvitationsLoading` **avant** leurs déclarations.
2. `const info = moduleInfo[page] || [...]` avait été supprimé alors que `action` utilise `info[2]`.
3. `setDeclineTarget`, `setDeclineReason`, `setDeclineMessage` étaient appelés sans être déclarés.
4. `<div className="table-row proposal-row">` était fermé par `</span>` puis suivi d'un `</div>` en trop.
5. `invitationsError` était déclaré mais jamais affiché.
6. `invitationsApi.mine()` était appelé sur toutes les pages du module, pas seulement sur `invitations`.
7. Le lien de consultation ouvrait `/freelancers/{clientId}` (route freelancer avec un id de client).

---

## 3. Modifications réalisées

### `src/components/layout/AppShell.tsx`
- Ajout du `}` manquant : `... aria-label="Close navigation"/>}`.
- Restauration du bouton `role-switch` (`Client mode` / `Freelancer mode`).
- Aucune refonte visuelle, aucun changement de comportement.

### `src/components/views/client/ClientPostPage.tsx`
- `variant="outline"` → variante `primary` par défaut.
- Phrase de confirmation réécrite, sans concaténation cassée ni doublon de devise.
- Bloc titre : `display:block`, largeur max 520 px, alignement à gauche, `h2` + description libres.
- Bloc pièces jointes : `display:block` explicite, lignes en colonne, nom tronqué proprement (`ellipsis`), taille en KB, statut lisible, `Retry` uniquement en cas d'erreur.
- Bloc global « Retry failed uploads » restauré.
- Boutons d'action recentrés.

### `src/components/views/freelancer/FreelancerModule.tsx`
- Déclaration de `const info = moduleInfo[page] || [...]` restaurée.
- États d'invitation déclarés **avant** le `useEffect`.
- Type local `InvitationItem` aligné sur `InvitationResponse` du backend.
- Chargement limité à `page === "invitations"`, avec `[page]` en dépendance.
- `invitationsError` affiché, remis à zéro à chaque chargement.
- Accept/Decline réimplémentés avec les méthodes existantes `invitationsApi.accept` / `.decline` (aucun second système).
- Refus : saisie optionnelle d'un motif via `window.prompt`, annulation possible.
- JSX des invitations rééquilibré (`</div>` correct, plus de balise orpheline).
- Lien de consultation corrigé vers `/projects/{projectId}`.

---

## 4. Fichiers sauvegardés (hors sources)

Dossier : `_recovery_backup/`

| Sauvegarde | Taille |
|---|---|
| `AppShell.tsx.bak` | 2 557 octets |
| `ClientPostPage.tsx.bak` | 22 695 octets |
| `FreelancerModule.tsx.bak` | 11 160 octets |

Aucune commande destructive exécutée. Aucun `git reset`, `git checkout` ou `git clean`.
`src/context/MarketplaceContext.tsx.tmp` n'a pas été touché.

---

## 5. Commandes exécutées et résultats

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | ✅ 0 erreur |
| `pnpm lint` | ✅ 0 erreur, 3 avertissements préexistants (`PortfolioCvEditor.tsx` 144/157, `TasksView.tsx` 60) |
| `pnpm test` | ✅ 3 fichiers, 16 tests réussis |
| `dotnet build FreelanceTn.sln` | ✅ 0 avertissement, 0 erreur |
| `dotnet test` | ✅ 26 tests réussis, 0 échec |

### Vérifications HTTP du serveur de développement (`localhost:8443`)

| Route | Résultat |
|---|---|
| `/projects/6aedd6477a370be3ed256aa9` | 200 — 19 955 octets |
| `/client/post` | 200 |
| `/freelancer/invitations` | 200 |
| `/freelancers/6aedd6477a370be3ed256aa9` | 200 |

Ces 200 confirment que les pages se compilent et se rendent côté serveur. Ils ne remplacent pas un test d'interaction dans le navigateur.

---

## 6. Problèmes restants (non traités pendant cette phase)

1. **Problème 1 — Sidebar** : le bouton de réouverture reste masqué quand la sidebar est repliée, à cause de la règle CSS existante `.app-sidebar.collapsed .sidebar-logo>button{display:none}`. Non corrigé volontairement : la Phase 0 interdit la refonte de la sidebar.
2. **Problème 2 — Logo dupliqué** : non traité (Phase 0).
3. **Problème 4 — Notifications d'invitation** : la liste des invitations est maintenant réellement chargée et accept/refuse fonctionnent côté UI, mais la création de notification et la mise à jour d'affectation n'ont pas été vérifiées. Non traité (Phase 0).
4. **Problèmes 5 à 9** : non démarrés, conformément à la consigne.
5. `src/components/shared/ProjectDetail.tsx.bak` existe déjà dans les sources. Il n'a pas été créé ni supprimé dans cette phase.

---

## 7. Confirmation de préservation

- Navigation, header, identité utilisateur, `NotificationsBell`, logout, responsive et bascule Client/Freelancer sont conservés dans `AppShell`.
- Le système d'invitations existant est conservé et utilise les endpoints déjà en place (`GET /api/invitations/mine`, `POST /api/invitations/{id}/accept`, `POST /api/invitations/{id}/decline`).
- Les écrans de services, propositions, avis, analytics, disponibilité, vérification, notifications et support de `FreelancerModule` sont inchangés.
- L'écran « Your project is live » conserve toutes ses actions : voir le projet, publier un autre projet, retry par fichier, retry global.
- Aucun module Tasks, Services, Devis, Factures, Portfolio, Feedback n'a été modifié.
- Aucune donnée de production n'a été remplacée par des mocks.
