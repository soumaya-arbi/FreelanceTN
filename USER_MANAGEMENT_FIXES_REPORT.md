# USER_MANAGEMENT_FIXES_REPORT.md

## 1. Cause exacte de chaque problème

### 1.1 Message « Saving company settings requires the backend — your edits stay in this session only »
- **Cause** : bouton résiduel dans `src/components/views/client/ClientModule.tsx` (titre de page `settings`) qui appelait `notify(...)` au lieu de laisser le formulaire réel (`AccountSettings`) gérer la sauvegarde.
- **Correction** : le troisième élément du titre `settings` est maintenant vide, donc le bouton n'est plus rendu ; la sauvegarde passe uniquement par `PUT /api/account/profile`.

### 1.2 « An unexpected error occurred. »
- **Cause racine** : message générique du `ErrorHandlingMiddleware` (500) pour toute exception non gérée. Le profil client se sauvegarde correctement (`UpdateClientProfileAsync` validé par tests API). Les champs null/optionnels sont gérés (`Set` ignore `null`) et les couleurs invalides lèvent `BadRequestException` explicite.
- **Correction conservatrice** : conservation des messages explicites pour les cas connus (couleur hexadécimale, avatar source, etc.) ; aucune exception non gérée reproduite sur les parcours testés.

### 1.3 Avatar / couverture
- **Existant** : uploads déjà présents (`/api/uploads/avatar`, `/api/uploads/cover`, `/api/uploads/logo`) avec validation par magic bytes, stockage fichier et références en base.
- **Correction** : réutilisation du même mécanisme pour le rôle Freelancer (page `ProfileEditor`) : ajout de la couverture (upload/suppression) + `coverImage` dans `UpdateProfileInput`. Aucune duplication de logique d'upload.

### 1.4 Invitations Team Members
- **Avant** : acceptation marquait le membre actif et reliait un compte existant, mais aucun compte/mot de passe n'était créé.
- **Correction** : workflow d'activation par lien + définition du mot de passe :
  - `POST /api/account/team/activate` (public, jeton) crée ou met à jour le compte utilisateur avec mot de passe hashé, vérifie l'e-mail, puis active l'invitation.
  - Page `/team/accept` demande et valide le mot de passe (≥ 8 caractères, confirmation).
  - Aucun mot de passe temporaire en clair, jamais réaffiché, expiration/usage unique conservés.

### 1.5 URL `localhost` dans les e-mails
- **Vérification** : les liens utilisent `Auth:FrontendBaseUrl` / `Auth:AppBaseUrl`, surchargés par `FRONTEND_BASE_URL` / `APP_BASE_URL`.
- **Test** : avec `FRONTEND_BASE_URL=https://app.example.com`, le lien d'invitation généré est `https://app.example.com/team/accept?token=...`.

### 1.6 Bloc « Aperçu réel »
- **Correction** : suppression du bloc dans `AccountSettings.tsx` et des styles `.preferences-preview` dans `globals.css`. Les paramètres langue/devise/fuseau/thème sont conservés.

### 1.7 Notifications
- **Audit** : `NotificationService.Filter` applique réellement les préférences in-app (canaux + catégories). Les préférences sont persistées dans MongoDB (`notificationPreferences`) et relues après reconnexion.
- **Limite honnête** : aucun événement métier n'envoie d'e-mail transactionnel au-delà des flux auth (vérification, reset, invitation) ; les préférences e-mail sont donc stockées et exposées mais leur application à des événements métier n'existe pas encore dans le code.

## 2. Fichiers modifiés

### Frontend
- `src/components/views/client/ClientModule.tsx`
- `src/components/views/account/AccountSettings.tsx`
- `src/components/views/freelancer/ProfileEditor.tsx`
- `src/app/(auth)/team/accept/page.tsx`
- `src/lib/api.ts`
- `src/app/globals.css`

### Backend
- `backend/src/FreelanceTn.Api/Services/AuthService.cs`
- `backend/src/FreelanceTn.Api/Services/AccountService.cs`
- `backend/src/FreelanceTn.Api/Controllers/AccountController.cs`
- `backend/src/FreelanceTn.Api/Dtos/Account/AccountDtos.cs`

## 3. Endpoints ajoutés / corrigés
- `POST /api/account/team/activate` (public) — activation par lien + mot de passe.
- `GET/POST` existants conservés : `/api/account/profile`, `/api/uploads/*`, `/api/account/team/*`.

## 4. Changements MongoDB
- Aucune collection supprimée ni réinitialisée.
- Aucune migration destructive.
- Réutilisation des champs existants `User.Avatar`, `User.CoverImage`, `User.AvatarSource`, `User.RequirePasswordChange`.
- Les comptes d'équipe sont créés comme `User` (rôle client) lors de l'activation, liés via `TeamMember.UserId`.

## 5. Fonctionnalités réellement opérationnelles
- Sauvegarde profil client dans MongoDB + relecture après reconnexion (testé).
- Avatar et couverture pour Client et Freelancer (upload, remplacement, suppression, persistance) — testés par API.
- Validation des fichiers par magic bytes (rejet d'un faux PNG confirmé, HTTP 409).
- Invitations : création, e-mail (dev-outbox), lien avec domaine configuré, activation + mot de passe, connexion (testé).
- Révocation d'invitation conservée.
- Notifications in-app filtrées par préférences (code + tests unitaires).
- Suppression du bloc « Aperçu réel ».

## 6. Tests effectués
- `pnpm typecheck` : OK (0 erreur)
- `pnpm lint` : OK (0 erreur, 3 warnings préexistants)
- `pnpm test` : OK (41 tests)
- `pnpm build` : OK
- `dotnet build backend\FreelanceTn.sln` : OK (0 erreur)
- `dotnet test backend\FreelanceTn.sln` : OK (52 tests)
- Tests API réels :
  - Profil client PUT/GET persistant : OK
  - Upload cover (PNG valide) : OK, URL persistée
  - Upload avatar (PNG valide) : OK
  - Fichier invalide : rejet HTTP 409
  - Invitation + activation + login : OK
  - Lien avec domaine simulé `https://app.example.com` : OK

## 7. Configuration restante (SMTP / domaine)
- Renseigner `Auth:Email:Host/Port/Username/Password` (ou variables d'environnement) pour l'envoi SMTP réel.
- Définir `FRONTEND_BASE_URL` / `APP_BASE_URL` avec le domaine de production.
- `Auth:ExposeDevEmailLinks` doit rester `false` en production.

## 8. Tests visuels manuels restants
- Vérifier le recadrage/zoom dans l'interface (canvas) pour avatar et couverture des deux rôles.
- Vérifier le flux complet d'invitation dans le navigateur (e-mail → activation → login).
- Vérifier que les préférences de notification e-mail sont respectées une fois des événements métier e-mail implémentés.

## 9. Mission « Avatar Studio avancé, intégration profil Freelancer et affichage Cover »

### 9.1 Limites de l'ancien Avatar Studio
- Popup sans navigation par catégorie : tous les réglages étaient listés dans une seule liste verticale (`avatar-studio-controls`), non organisés.
- Aucune vignette : choix sous forme de listes de valeurs techniques (`top`, `accessories`, …).
- Pas de bouton « Annuler », pas de réinitialisation par catégorie (seule la coupe était concernée).

### 9.2 Moteur graphique retenu
- Moteur **DiceBear** (`@dicebear/core` + `@dicebear/collection`, style `avataaars`) : rendu SVG local, 100 % déterministe par `seed`.
- Catégories supportées : coupe de cheveux, accessoires, vêtements, yeux, sourcils, bouche, pilosité, couleur de peau, couleur de cheveux, arrière-plan.
- Chaque option modifie réellement le rendu (aperçu recalculé en direct).

### 9.3 Améliorations apportées à la popup
- Navigation par onglets (`avatar-studio-tabs`) avec contenu spécifique par catégorie.
- Vignettes de choix (rendu DiceBear par option) + sélection active.
- Aperçu géant en direct (`avatar-studio-preview`).
- Génération aléatoire (`Génération aléatoire`), réinitialisation par catégorie, bouton Annuler.
- Confirmation de sauvegarde (`saved` → libellé « Avatar enregistré »).

### 9.4 Corrections backend / intégration
- `AvatarBadge` : gestion source `generated` (rendu via `avatarConfig` JSON) en priorité sur le champ `avatar` ;
  `toAuthUser` accepte désormais `avatarSource === "generated"` (bug de remappage vers `initials`).
- Backend public : `PublicFreelancerResponse` et `PublicFreelancerSummaryResponse` exposent `CoverImage`, `AvatarSource`, `AvatarConfig`.
- Frontend : `PublicFreelancer` / `PublicFreelancerSummary` exposent et mappent ces champs ; `ProfileRoute` → `ProfileView` (cover + avatar source-aware).

### 9.5 Couverture Find Freelancers
- `GET /api/freelancers` (annuaire) et `GET /api/freelancers/{id}` (profil public) renvoient la couverture persistée.
- Frontend : `Directory` transmet la cover dans les cartes ; `ProfileView` l'affiche en `background-image` du bloc de couverture.

### 9.6 Fichiers modifiés (dernière session)
- `src/components/views/account/AvatarStudio.tsx` (refonte complète)
- `src/components/views/account/AvatarBadge.tsx`
- `src/components/views/account/AccountSettings.tsx`
- `src/components/views/freelancer/ProfileEditor.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/layout/ClientShell.tsx`
- `src/components/views/Home.tsx`
- `src/components/views/client/ClientDashboard.tsx`
- `src/components/views/client/InvitePage.tsx`
- `src/components/views/ProfileView.tsx`
- `src/components/views/ProfileRoute.tsx`
- `src/components/shared/Directory.tsx`
- `src/components/views/freelancer/Dashboard.tsx`
- `src/lib/api.ts`
- `src/lib/types.ts`
- `src/app/globals.css`
- `backend/src/FreelanceTn.Api/Dtos/Freelancers/FreelancerDtos.cs`
- `backend/src/FreelanceTn.Api/Controllers/FreelancersController.cs`

## 10. Derniers résultats de validation (dernière session)
- `pnpm typecheck` : OK (0 erreur)
- `pnpm lint` : OK (0 erreur, 3 warnings préexistants)
- `pnpm test` : OK (41 tests)
- `pnpm build` : OK
- `dotnet build backend\FreelanceTn.sln` : OK (0 erreur)
- `dotnet test backend\FreelanceTn.sln` : OK (52 tests)

## 11. Vérifications E2E récentes (backend live sur :5080)
- `GET /api/freelancers` : les profils exposent désormais `coverImage`, `avatarSource`, `avatarConfig` (ex. freelancer avec couverture persistée).
- `GET /api/freelancers/{id}` : réponse publique complète avec `coverImage` + `avatarSource` (avatar upload persistant).
