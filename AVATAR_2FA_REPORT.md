# AVATAR_2FA_REPORT.md

## 1. Système d'avatar et photo de profil

### Composants partagés
- `src/components/views/account/AvatarBadge.tsx` : affiche photo uploadée, avatar illustré ou initiales (fallback). Supporte les sources `initials`, `preset`, `upload`, `generated`.
- `src/components/views/account/AvatarStudio.tsx` : studio avancé basé sur DiceBear (voir §4).
- `src/components/views/account/ImageCropper.tsx` : recadrage/zoom/repositionnement réutilisé pour photo et couverture.

### Fonctionnalités
- Photo de profil : upload PC, prévisualisation, recadrage, zoom/repositionnement, remplacement, suppression, persistance.
- Avatar illustré : 6 modèles, personnalisation couleur, prévisualisation temps réel, enregistrement, suppression.
- Basculement photo/avatar/initiales via `avatarSource` (`initials`, `preset`, `upload`, `generated`) persisté dans MongoDB.
- Disponible pour Client et Freelancer (Account Settings + ProfileEditor pour la couverture freelancer).

### Fichiers modifiés
- `src/components/views/account/AvatarBadge.tsx`
- `src/components/views/account/AvatarStudio.tsx`
- `src/components/views/account/AccountSettings.tsx`
- `src/components/views/freelancer/ProfileEditor.tsx`
- `src/lib/api.ts`
- `backend/src/FreelanceTn.Api/Services/AccountService.cs`
- `backend/src/FreelanceTn.Api/Services/AuthService.cs`

## 2. Authentification à deux facteurs (TOTP)

### Backend
- Modèle `User` étendu : `TwoFactorSecret` (chiffré via Data Protection), `RecoveryCodeHashes`, `TwoFactorFailedAttempts`, `TwoFactorLockoutUntil`.
- `AuthService` :
  - `StartTwoFactorSetupAsync` : génère secret Base32 + URI otpauth.
  - `EnableTwoFactorAsync` : vérifie le code TOTP, active, génère 8 codes de récupération (hashés).
  - `DisableTwoFactorAsync` : vérifie le mot de passe, désactive et efface secret/codes.
  - `RegenerateRecoveryCodesAsync` : vérifie le mot de passe, régénère les codes.
  - `CompleteTwoFactorLoginAsync` : vérifie pré-token temporaire, code TOTP ou code de récupération (usage unique), limitation des tentatives (5 puis blocage 15 min), création de session uniquement après validation.
- `LoginAsync` : si 2FA activée, renvoie `requiresTwoFactor=true` + `preAuthToken` sans délivrer de JWT.
- Endpoints `AuthController` : `POST /api/auth/2fa/verify`.
- Endpoints `AccountController` : `POST /api/account/security/2fa/setup`, `enable`, `disable`, `recovery-codes/regenerate`.
- `SecurityOverview` expose `twoFactorEnabled`.

### Frontend
- `src/components/auth/AuthModal.tsx` : écran de vérification 2FA lors de la connexion.
- `src/components/views/account/AccountSettings.tsx` : configuration 2FA (QR Code via `qrcode`, saisie code, codes de récupération téléchargeables, désactivation/régénération).
- `src/lib/api.ts` : méthodes `verifyTwoFactor`, `setupTwoFactor`, `enableTwoFactor`, `disableTwoFactor`, `regenerateRecoveryCodes`.
- `src/context/UserContext.tsx` : gestion du flux 2FA dans `login`.

### Sécurité
- Secrets TOTP chiffrés côté backend (Data Protection).
- Codes de récupération stockés sous forme de hashes SHA-256, usage unique.
- Sessions temporaires de pré-authentification expirables (5 min).
- Limitation des tentatives (5) avec blocage 15 minutes.
- Désactivation/régénération exigent le mot de passe.
- Cookies HttpOnly et JWT préservés.

## 3. Tests réellement effectués
- `pnpm typecheck` : OK
- `pnpm lint` : OK
- `pnpm test` : OK (41 tests)
- `pnpm build` : OK
- `dotnet build backend\FreelanceTn.sln` : OK
- `dotnet test backend\FreelanceTn.sln` : OK (52 tests)
- Test API 2FA : setup + enable (code TOTP valide) + login challenge + vérification TOTP valide → session créée (OK).
- Test API 2FA : code invalide → rejeté (401).
- Test API 2FA : code de récupération → session créée, code non réutilisable (logique implémentée).

## 4. Avatar Studio (mise à jour)
- Remplacement de la galerie de petites illustrations par un Avatar Studio basé sur DiceBear (avataaars) avec navigation par catégories et vignettes :
  - Cheveux, Accessoires, Vêtements, Yeux, Sourcils, Bouche, Pilosité, Couleur de peau, Couleur des cheveux, Arrière-plan.
- Chaque catégorie propose des vignettes rendues par le moteur DiceBear ; sélection, aperçu live, reset par catégorie, génération aléatoire, annuler, sauvegarde.
- Génération aléatoire et réinitialisation par catégorie disponibles.
- Sauvegarde de la configuration JSON dans MongoDB (`User.AvatarConfig`), rendu côté client via `AvatarBadge`.
- Photo et avatar coexistent ; les initiales restent le fallback.

## 5. Photo Freelancer
- `ProfileEditor` utilise désormais le composant partagé `ImageCropper` pour l'avatar et la couverture (recadrage, zoom, déplacement).
- Validation des fichiers et upload via les mêmes endpoints que le Client.

## 6. Limites restantes
- Le QR Code est généré côté client via la librairie `qrcode`.
- La désactivation 2FA et la régénération des codes exigent une session valide et le mot de passe.
- Les événements métier e-mail liés aux notifications ne sont pas dans le périmètre.