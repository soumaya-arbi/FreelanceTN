# FreelanceTN — Rapport final des 9 corrections

Date : 7 novembre 2026
Périmètre : corrections UI/UX et fonctionnelles demandées, sans réinitialisation ni création de données MongoDB.

## Tableau de suivi

| # | Problème | Correctif appliqué | Statut |
|---|----------|--------------------|--------|
| 1 | Sidebar sans bouton d'ouverture/fermeture | Bouton `.sidebar-toggle` ajouté dans le header de `AppShell` et `ClientShell`, état `collapsed` persisté pendant la session, styles desktop + media query mobile. Le bouton interne de la sidebar a été retiré. | CORRIGÉ – TEST MANUEL NÉCESSAIRE |
| 2 | Logo affiché en double sur les pages projet | Prop `hideSidebarLogo` ajoutée aux deux shells et passée depuis `ProjectDetailRoute` (branches client et freelance). Seul le logo de la sidebar est masqué, celui du header public reste. | CORRIGÉ – TEST MANUEL NÉCESSAIRE |
| 3 | Écran « Your project is live » mal structuré | `ClientPostPage` refondu : carte de confirmation, récapitulatif du projet publié, section pièces jointes, gestion d'erreur avec retry, boutons responsives, CSS `.post-success`. | CORRIGÉ – TEST MANUEL NÉCESSAIRE |
| 4 | Invitations inutilisables (mauvais identifiant, pas de projet) | `InvitePage` réécrit : chargement du profil via `freelancersApi.get`, liste des projets invitables, envoi via `invitationsApi.create`, présélection du projet par `?project=`, propagation depuis `ProfileRoute`, `ClientDashboard`, `ClientProcess` et `ClientDiscovery`. | CORRIGÉ – TEST MANUEL NÉCESSAIRE (envoi réel non testé sans identifiants client/freelancer) |
| 5 | Annuaire et profils alimentés par des données statiques | `Directory` et `ClientDashboard` chargent désormais `freelancersApi.list()` (GET `/api/freelancers`) ; profil et portfolio publics via les routes existantes `/freelancers/{id}` et `/api/portfolio/freelancer/{id}`. États loading/error/empty et fallback avatar ajoutés. | CORRIGÉ – TEST MANUEL NÉCESSAIRE (API publique vérifiée avec de vrais comptes, rendu non testé visuellement) |
| 6 | Pièces jointes illisibles ou absentes | Composant partagé `AttachmentList` (icône par type, taille lisible, téléchargement, troncature) utilisé dans `ProjectDetail`, `ClientProcess` (lecture + uploads en édition) et `ClientPostPage` (création + confirmation). | CORRIGÉ – TEST MANUEL NÉCESSAIRE (upload/download non testés de bout en bout) |
| 7 | Section « Proposals by project » mal conçue et doublon d'invitations | `ClientModule` : regroupement réel par projet, compteurs, statuts colorés, actions accepter/refuser, états vides ; ancienne double section « Invited freelancers » supprimée et remplacée par une section unique alimentée par `invitationsApi.sent()`. | CORRIGÉ – TEST MANUEL NÉCESSAIRE |
| 8 | Filtrage des propositions par projet non fonctionnel | `GET /api/proposals/received?projectId=` ajouté côté backend (contrôleur + service, borné au propriétaire) ; `proposalsApi.received(projectId?)` ; `ClientModule` affiche un bandeau « filtré par projet » et un retour à la vue générale. | CORRIGÉ – TEST MANUEL NÉCESSAIRE (endpoint protégé vérifié : 401 sans session ; filtrage authentifié non testable sans identifiants) |
| 9 | Panneau « Project Activity » à supprimer | Panneau `<h3>Project activity</h3>` retiré de `ClientProcess`, résidu de debug `DISCUSSION ICI` supprimé, aside réorganisé. Aucune référence restante dans le code. | RÉSOLU ET TESTÉ (absence vérifiée dans le code, routes projet compilées et servies en 200) |

## Fichiers principaux modifiés

- `src/components/layout/AppShell.tsx`, `src/components/layout/ClientShell.tsx`
- `src/components/views/ProjectDetailRoute.tsx`
- `src/components/views/client/ClientPostPage.tsx`
- `src/components/views/client/InvitePage.tsx`
- `src/components/views/client/ClientModule.tsx`
- `src/components/views/client/ClientProcess.tsx`
- `src/components/views/client/ClientDashboard.tsx`
- `src/components/views/ProfileRoute.tsx`, `src/components/views/client/ClientDiscovery.tsx`
- `src/components/shared/Directory.tsx`
- `src/components/shared/AttachmentList.tsx` (nouveau composant partagé)
- `src/components/shared/ProjectDetail.tsx`
- `src/app/globals.css`
- `src/lib/api.ts` (`freelancersApi.list`, `proposalsApi.received(projectId?)`)
- `backend/src/FreelanceTn.Api/Controllers/FreelancersController.cs` (`GET /api/freelancers`)
- `backend/src/FreelanceTn.Api/Services/AuthService.cs` (`ListFreelancersAsync`)
- `backend/src/FreelanceTn.Api/Controllers/ProposalsController.cs` (filtre `projectId`)
- `backend/src/FreelanceTn.Api/Services/ProposalService.cs` (`ListReceivedAsync(clientId, projectId?, ct)`)

## Vérifications réellement exécutées

| Vérification | Commande / action | Résultat |
|---|---|---|
| TypeScript | `pnpm typecheck` | OK, 0 erreur |
| Lint | `pnpm lint` | 0 erreur, 3 warnings préexistants (`PortfolioCvEditor`, `TasksView`) |
| Tests frontend | `pnpm test` | 3 fichiers, 16/16 tests réussis |
| Build backend | `dotnet build backend\FreelanceTn.sln` | OK (1 warning xUnit préexistant) |
| Tests backend | `dotnet test backend\FreelanceTn.sln --no-build` | 26/26 tests réussis |
| Annuaire réel | `GET /api/freelancers` | 200, comptes réels retournés |
| Profil réel | `GET /api/freelancers/6ae85e877244cfd83042101c` | 200, profil réel (Jean Dupont) |
| Portfolio réel | `GET /api/portfolio/freelancer/6ae85e877244cfd83042101c` | 200, `[]` (aucun élément publié) |
| Protection du filtre | `GET /api/proposals/received?projectId=…` sans session | 401, attendu |
| Route inconnue | `GET /api/freelancersXYZ` | 404 (pas de faux positif) |
| Routes frontend | `/freelancers`, `/client/talent`, `/client/proposals?project=…`, `/client/invite/{id}`, `/projects/{id}` | 200 |

## Points restant à valider manuellement

1. Ouverture/fermeture de la sidebar sur desktop et mobile (problème 1).
2. Absence du logo dans la sidebar des pages projet, côté client et freelance (problème 2).
3. Rendu de la confirmation après publication et téléchargement des pièces jointes (problèmes 3 et 6).
4. Envoi d'une invitation de bout en bout avec un compte client et un compte freelance réels, y compris la présélection du projet (problème 4).
5. Navigation annuaire → profil → portfolio avec les vraies données (problème 5).
6. Acceptation/refus d'une proposition et filtrage par projet depuis `ClientModule` (problèmes 7 et 8).

## Limites et blocages

- Aucun outil de pilotage navigateur n'est disponible dans cet environnement : les interactions visuelles ne peuvent pas être automatisées ici.
- Les tests API authentifiés (invitations, propositions reçues filtrées) exigent des identifiants client/freelancer réels. Aucun compte ni aucune donnée n'a été créé, modifié ou supprimé, conformément aux contraintes.
- Aucun dépôt Git : aucune opération `reset`, `checkout` ou `clean` n'a été effectuée.
- `MarketplaceContext.tsx.tmp` n'a pas été touché.
- Hors périmètre des 9 problèmes : la page « Saved Items » de `ClientModule` utilise encore les entrées de démonstration de `src/lib/data` (comportement préexistant, non modifié).
