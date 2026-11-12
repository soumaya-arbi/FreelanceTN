# User Management / Account Settings — rapport d'implémentation

**Projet :** FreelanceTN (Next.js 16 / React 19 côté front, .NET 9 / MongoDB côté API)  
**Date :** 8 novembre 2026  
**Périmètre :** espace client `Company profile`, `Team members`, `Billing details`, `Security`, `Notifications`, `Preferences`, ainsi que Remember Me, mot de passe oublié et vérification e-mail.

---

## 1. Diagnostic initial

L'écran `settings` était majoritairement statique :

- formulaires sans `onSubmit`, sans lecture API et sans écriture en base ;
- boutons logo / couverture / avatar répondant « requires the backend » ;
- « Remember me » présent dans l'interface mais jamais transmis à l'API ;
- aucune session serveur révocable : le JWT restait valide jusqu'à son expiration ;
- aucune gestion des membres d'équipe, de la facturation ou des préférences ;
- notifications in-app non filtrées par préférence ;
- uploads limités à l'avatar, sans couverture ni logo, sans validation serveur du contenu réel ;
- e-mails transactionnels au format texte uniquement, sans date d'expiration affichée.

Le backend disposait déjà de `User`, de l'authentification JWT en cookie HttpOnly et de la vérification e-mail. L'extension s'est donc appuyée sur ces briques plutôt que de créer un profil parallèle.

---

## 2. Architecture retenue

### Modèle de données

Le document `User` existant a été étendu (prénom/nom, téléphone, entreprise, logo, couverture, secteur, poste, site, taille, description, localisation, présentation, coordonnées professionnelles, style d'avatar, dates de mot de passe, indicateur 2FA). Aucun doublon de profil.

Collections ajoutées :

| Collection | Rôle |
|---|---|
| `teamMembers` | invitations et accès des collaborateurs (rôle, statut, hash du jeton, expiration) |
| `billingProfiles` | coordonnées légales + historique des modifications |
| `userPreferences` | langue, devise, thème, fuseau, format de date, séparateur |
| `notificationPreferences` | canaux et catégories de notifications |
| `authSessions` | sessions révocables (hash du jeton, appareil, expiration) |
| `accountChanges` | historique des changements importants du compte |

Index créés au démarrage : unicité `billingProfiles.userId`, `userPreferences.userId`, `notificationPreferences.userId`, `authSessions.tokenHash` ; index de liste sur les sessions, l'équipe et l'historique.

### Sessions et « Remember me »

- Le JWT contient un claim opaque `sid`. La base ne stocke que le **hash SHA-256** de la clé de session.
- `OnTokenValidated` vérifie à chaque requête que la session n'est ni révoquée ni expirée. Les anciens jetons sans `sid` restent acceptés pour ne pas déconnecter les utilisateurs existants.
- **Remember me coché** : JWT et cookie prolongés à `Auth:RememberMeDays` (30 jours par défaut), avec la même date d'expiration.
- **Remember me décoché** : cookie de session (aucun `Expires`) et JWT limité à `Jwt:ExpiryMinutes`.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` automatiquement en HTTPS, `Path=/`. Aucun JWT n'est stocké dans `localStorage`.
- Déconnexion : la session courante est révoquée côté serveur puis le cookie est supprimé.

### Réinitialisation du mot de passe

- Jeton cryptographique aléatoire (32 octets), stocké **hashé** uniquement.
- Expiration configurable (`ResetTokenMinutes`), usage unique (hash effacé après succès), réponse API générique pour ne pas révéler l'existence d'un compte.
- Anti-abus : délai minimal entre deux demandes (`ForgotPasswordCooldownSeconds`).
- Après réinitialisation : toutes les sessions sont révoquées et l'adresse e-mail est marquée vérifiée.
- Depuis le compte connecté : vérification de l'ancien mot de passe, révocation des **autres** sessions.

### E-mails

`AuthEmailService` produit des e-mails HTML professionnels (titre, bouton d'action, date d'expiration, lien de secours, version texte). Les liens utilisent exclusivement l'URL publique configurée :

- `Auth:FrontendBaseUrl`, ou la variable d'environnement `FRONTEND_BASE_URL` ;
- `Auth:AppBaseUrl`, ou la variable d'environnement `APP_BASE_URL`.

Aucune URL `localhost` n'est codée en dur dans les liens de production : `localhost` n'est qu'une valeur de développement.

Templates : vérification, réinitialisation, invitation d'équipe. L'exception du transport est propagée : l'interface n'annonce jamais un envoi qui n'a pas eu lieu.

### Uploads

- Couverture, logo et avatar stockés dans `App_Data/uploads/{covers,logos,avatars}` (hors `wwwroot`), servis par des routes API.
- Validation front (type, taille, recadrage canvas) **et** back (magic bytes JPG/PNG/WebP, taille `Auth:MaxImageUploadMb`).
- Nom de fichier GUID, protection contre la traversée de chemin, suppression de l'ancien fichier au remplacement.
- Aucune image en base64 ni dans MongoDB.

### Contrôles d'autorisation

Les contrôles sont refaits côté backend, jamais uniquement dans l'interface :

- profil, équipe et facturation : rôle **Client** exigé ;
- sécurité, notifications et préférences : accessibles aux deux rôles ;
- toutes les requêtes sont filtrées par l'identifiant issu de la session (`sub`), jamais par un identifiant envoyé par le client.

---

## 3. Fonctionnalités livrées

### Onglet Company profile

- Prénom, nom, téléphone éditables ; e-mail en lecture seule.
- Entreprise : nom, logo (upload/recadrage/suppression), couverture (upload/recadrage/remplacement/suppression), secteur, poste, site, taille, description.
- Localisation : pays, gouvernorat (liste des 24 gouvernorats), ville, adresse professionnelle.
- Présentation personnelle, e-mail professionnel, téléphone professionnel, site personnel.
- Barre de complétion calculée côté serveur + liste des champs manquants.
- Badge d'initiales automatique, galerie locale de 6 styles, couleur personnalisée, upload photo avec recadrage.
- La génération d'avatar par IA est explicitement annoncée comme non connectée : aucun service factice n'est simulé.

### Onglet Team members

- Invitation par e-mail avec rôle (Admin, Manager, Member, Viewer) et nom facultatif.
- E-mail HTML d'invitation contenant un jeton hashé, expirable et à usage unique.
- Page `/team/accept` : accepter ou refuser l'invitation depuis le lien reçu.
- Filtres All / Pending / Active / Revoked, changement de rôle, révocation.
- Doublons et auto-invitation refusés ; propriétaire affiché à part.
- En développement, le lien d'invitation est exposé uniquement si `ExposeDevEmailLinks` et le transport `dev-outbox` sont actifs.

### Onglet Billing details

- Nom légal, adresse, pays, gouvernorat, ville, identifiant fiscal, contact (nom, e-mail, téléphone).
- Historique des modifications (date + champs touchés).
- Aucun paiement, aucune carte, aucune transaction simulée.

### Onglet Security

- Changement de mot de passe avec vérification de l'ancien.
- État de vérification e-mail + renvoi du lien.
- Liste des sessions actives (appareil, dernière activité, expiration, session persistante ou non).
- Déconnexion d'une session distante et bouton « déconnecter les autres sessions ».
- Architecture 2FA préparée (`TwoFactorEnabled`, endpoint d'état) mais annoncée **non disponible** tant qu'aucun fournisseur TOTP n'est configuré.
- Export JSON des données du compte.
- Historique des changements du compte.
- La suppression de compte est volontairement **reportée** : elle impacte l'intégrité des projets, devis, factures et évaluations. Décision documentée en section 8.

### Onglet Notifications

- Canaux in-app / e-mail et catégories (invitations, projets, messages, facturation).
- Les préférences in-app sont réellement appliquées par `NotificationService` : les catégories désactivées ne sont ni listées ni comptées comme non lues.
- Le transport e-mail réel est affiché honnêtement (`smtp`, `dev-outbox` ou `none`) via `/api/auth/providers`.

### Onglet Preferences

- Langue (fr/en), devise TND (non modifiable, devise de référence), thème clair/sombre, fuseau, format de date, séparateur de milliers.
- Le thème s'applique immédiatement à l'application et est rechargé à la connexion.
- La langue pilote réellement les formats de date/heure/nombre et l'aperçu affiché. La traduction complète de l'interface n'est pas encore activée et l'écran le précise.
- Aperçu réel date + montant avant enregistrement.

### Profil public et export

- `GET /api/account/public/{id}` expose un profil client public limité aux informations professionnelles, sans e-mail ni téléphone.
- Aucune page publique dédiée n'a été ajoutée : l'API est prête pour une future route publique.

---

## 4. Routes API ajoutées

| Méthode | Route | Accès |
|---|---|---|
| GET/PUT | `/api/account/profile` | Client |
| PUT | `/api/account/avatar` | authentifié |
| GET | `/api/account/team` | Client |
| POST | `/api/account/team/invite` | Client |
| PUT | `/api/account/team/{id}/role` | Client |
| POST | `/api/account/team/{id}/revoke` | Client |
| POST | `/api/account/team/accept` | public (jeton) |
| POST | `/api/account/team/decline` | public (jeton) |
| GET/PUT | `/api/account/billing` | Client |
| GET | `/api/account/security` | authentifié |
| POST | `/api/account/security/change-password` | authentifié |
| POST | `/api/account/security/sessions/{id}/revoke` | authentifié |
| POST | `/api/account/security/sessions/revoke-others` | authentifié |
| GET/PUT | `/api/account/notifications` | authentifié |
| GET/PUT | `/api/account/preferences` | authentifié |
| GET | `/api/account/history` | authentifié |
| GET | `/api/account/export` | authentifié |
| GET | `/api/account/public/{id}` | public |
| POST | `/api/uploads/cover` | Client |
| POST | `/api/uploads/logo` | Client |
| DELETE | `/api/uploads/cover` | Client |
| DELETE | `/api/uploads/logo` | Client |
| DELETE | `/api/uploads/avatar` | authentifié |
| GET | `/api/uploads/{cover,logo,avatar}/{file}` | public |

La connexion renvoie désormais `persistent` et `expiresAt` en plus de l'utilisateur. La déconnexion révoque la session serveur.

---

## 5. Fichiers créés / modifiés

### Backend — nouveaux

- `Models/Account.cs`
- `Dtos/Account/AccountDtos.cs`
- `Services/SessionService.cs`
- `Services/AccountService.cs`
- `Controllers/AccountController.cs`
- `Validators/AccountValidators.cs`
- `backend/src/FreelanceTn.Api.Tests/AccountValidatorsTests.cs`

### Backend — modifiés

- `Models/User.cs`
- `Dtos/Auth/AuthDtos.cs`
- `Configuration/MongoSettings.cs`
- `Configuration/AuthSettings.cs`
- `Services/AuthService.cs`
- `Services/AuthEmailService.cs`
- `Services/IEmailSender.cs`
- `Services/SmtpEmailSender.cs`
- `Services/NotificationService.cs`
- `Controllers/AuthController.cs`
- `Controllers/UploadsController.cs`
- `Controllers/NotificationsController.cs`
- `Data/MongoContext.cs`
- `Program.cs`
- `appsettings.json`, `appsettings.Development.json`, `appsettings.example.json`
- `backend/src/FreelanceTn.Api.Tests/ProjectAttachmentsTests.cs`

### Frontend — nouveaux

- `src/components/views/account/AccountSettings.tsx`
- `src/components/views/account/AvatarBadge.tsx`
- `src/components/views/account/ImageCropper.tsx`
- `src/app/(auth)/team/accept/page.tsx`
- `src/lib/account.test.ts`

### Frontend — modifiés

- `src/lib/api.ts` (`accountApi`, types, mappages, `rememberMe`)
- `src/context/UserContext.tsx` (session, thème, `refreshUser`, entreprise réelle)
- `src/components/auth/AuthModal.tsx` (Remember Me transmis)
- `src/components/views/client/ClientModule.tsx` (intégration de `AccountSettings`)
- `src/components/views/freelancer/WorkspacePage.tsx` (onglets sécurité/notifications/préférences)
- `src/app/globals.css` (styles des nouveaux composants, mode sombre, responsive)

`MarketplaceContext.tsx.tmp` n'a pas été modifié. Aucun commit Git n'a été effectué.

---

## 6. Tests et validations

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | ✅ aucune erreur |
| `pnpm lint` | ✅ 0 erreur, 3 avertissements préexistants (`PortfolioCvEditor.tsx`, `TasksView.tsx`) |
| `pnpm test` | ✅ 6 fichiers, **41 tests** réussis |
| `pnpm build` | ✅ build Next.js réussi, route `/team/accept` générée |
| `dotnet build backend\FreelanceTn.sln` | ✅ 0 erreur |
| `dotnet test backend\FreelanceTn.sln` | ✅ **52 tests** réussis |

Tests ajoutés :

- **Frontend** (`src/lib/account.test.ts`) : mapping profil (complétion, champs manquants, source d'avatar inconnue), équipe (rôles/statuts, repli sûr), préférences (devise TND forcée, format de date), sécurité (2FA jamais annoncée disponible, sessions).
- **Backend** (`AccountValidatorsTests.cs`) : URLs http/https, couleurs hexadécimales, e-mail professionnel, devise TND, longueur et unicité du nouveau mot de passe, e-mail de facturation.

Vérifications manuelles de l'API en fonctionnement :

- `GET /api/account/profile` sans session → **401** ;
- `GET /api/account/public/nonexistent` → **404** (et non 500 après validation des ObjectId) ;
- `POST /api/account/team/accept` avec jeton invalide → **400** ;
- `GET /api/auth/providers` → transport e-mail réel exposé ;
- `POST /api/auth/forgot-password` → réponse générique **200**.

### Parcours de bout en bout exécuté sur l'API réelle

Un compte client de test (`e2e.check.*@example.tn`, base de développement) a été créé, vérifié puis supprimé des fichiers d'e-mails de développement après les contrôles. Résultats observés :

| Parcours | Vérification |
|---|---|
| Inscription + vérification e-mail | inscription **201**, jeton de vérification consommé → **200**, connexion ensuite autorisée |
| Connexion sans « Remember me » | `Set-Cookie` **sans `expires`** (cookie de session), `HttpOnly`, `SameSite=Lax`, `Path=/` |
| Connexion avec « Remember me » | `Set-Cookie` avec `expires` à **+30 jours**, identique à `expiresAt` renvoyé par l'API (`persistent: true`) |
| Profil | `PUT /api/account/profile` → **200**, relecture identique ; complétion passée de 14 % à 79 %, champs manquants recalculés |
| Équipe | invitation **200** avec lien de développement, acceptation → statut **Active**, changement de rôle → **Admin**, révocation → **Revoked** |
| Facturation | `PUT` → **200**, relecture persistée + entrée d'historique avec la liste des champs modifiés |
| Préférences | thème, langue et format enregistrés puis relus ; devise forcée à **TND** |
| Notifications | catégories désactivées persistées puis relues |
| Sessions | deux sessions listées avec `rememberMe` correct ; révocation d'une session distante → **204**, disparition de la liste |
| Uploads | couverture et avatar acceptés (**200**), fichier servi en `image/png` (**200**), contenu texte déguisé refusé (**409**), suppression → fichier **404** et retour aux initiales |
| Mot de passe oublié | e-mail HTML contenant bouton + date d'expiration, réinitialisation **200**, ancien mot de passe **401**, nouveau **200**, ancienne session **401**, réutilisation du jeton **400** |
| Changement de mot de passe | ancien mot de passe vérifié, nouveau actif, autres sessions révoquées |
| Déconnexion | **200**, puis `GET /api/account/profile` avec l'ancien cookie → **401** |

Les deux instances utilisées pour ce test (SMTP réel sur `5080`, outbox de développement sur `5081`) partageaient la même base : les jetons et sessions ont donc bien été validés par le même stockage.

---

## 7. Configuration de production

Variables d'environnement recommandées (les clés `Auth:*` peuvent aussi être fournies avec le séparateur `__`) :

```text
ASPNETCORE_ENVIRONMENT=Production
Mongo__ConnectionString=mongodb+srv://...
Mongo__DatabaseName=freelancetn

Jwt__Key=<secret aléatoire de 32 caractères minimum>
Jwt__Issuer=FreelanceTn
Jwt__Audience=FreelanceTnFrontend
Jwt__ExpiryMinutes=60
Jwt__CookieName=freelancetn_auth

FRONTEND_BASE_URL=https://app.votre-domaine.tn
APP_BASE_URL=https://api.votre-domaine.tn
# ou Auth__FrontendBaseUrl / Auth__AppBaseUrl

Auth__RememberMeDays=30
Auth__VerificationTokenHours=24
Auth__ResetTokenMinutes=60
Auth__ForgotPasswordCooldownSeconds=60
Auth__ResendCooldownSeconds=60
Auth__TeamInviteTokenHours=168
Auth__MaxImageUploadMb=5
Auth__ExposeDevEmailLinks=false

Cors__AllowedOrigins__0=https://app.votre-domaine.tn

Auth__Email__Host=smtp.votre-fournisseur.tn
Auth__Email__Port=587
Auth__Email__UseStartTls=true
Auth__Email__Username=<compte SMTP>
Auth__Email__Password=<mot de passe SMTP>
Auth__Email__FromAddress=no-reply@votre-domaine.tn
Auth__Email__FromName=FreelanceTN

Auth__Google__ClientId=<client id>
Auth__Google__ClientSecret=<client secret>
Auth__Google__RedirectUri=https://api.votre-domaine.tn/api/auth/google/callback
```

Points d'attention :

- Le secret JWT, les identifiants SMTP et Google doivent être fournis par le coffre de secrets du déploiement, jamais commités.
- `Secure` sur les cookies est automatique lorsque la requête arrive en HTTPS ; le reverse proxy doit transmettre `X-Forwarded-Proto`.
- Les URLs `FRONTEND_BASE_URL` / `APP_BASE_URL` sont prioritaires sur `appsettings` et servent à construire les liens e-mails.

### Configuration e-mail restante

Aucun fournisseur transactionnel n'est configuré par cette implémentation. Trois transports existent :

1. `smtp` : envoi réel via `Auth:Email` ;
2. `dev-outbox` : fichiers HTML dans `App_Data/dev-emails` en développement, **aucun envoi réel** ;
3. `none` : aucun envoi, l'API le signale explicitement.

Pour la production, il reste à fournir un compte SMTP (ou brancher un fournisseur type SendGrid/Postmark) et à vérifier la délivrabilité (SPF, DKIM, DMARC). Le code n'annonce jamais un envoi réussi si le transport a échoué.

### Services externes

- **MongoDB** : requis.
- **SMTP** : requis pour les e-mails réels.
- **Google OAuth** : optionnel, déjà existant.
- **2FA / IA** : non branchés. Aucun faux service n'est exposé.

---

## 8. Décisions et éléments reportés

| Élément | Décision |
|---|---|
| Suppression de compte | **Reportée.** Nécessite une stratégie d'intégrité (projets, devis, factures, feedbacks, portfolio) et une période de rétention. L'export JSON est disponible en attendant. |
| 2FA | Architecture prête (`TwoFactorEnabled`, messages d'état) mais aucun fournisseur TOTP configuré : l'interface affiche « non disponible ». |
| Avatar par IA | Non implémenté ; l'interface l'indique clairement. La galerie locale, les couleurs et l'upload réel sont fonctionnels. |
| Traduction complète de l'interface | Non activée. La langue pilote les formats de date/heure/nombre et est persistée ; l'écran le précise. |
| Notifications e-mail | Préférence enregistrée, mais aucun e-mail de notification n'est envoyé tant qu'aucun fournisseur n'est branché. |
| Page publique de profil client | API prête, page publique non ajoutée. |
| Modification de l'adresse e-mail | Non exposée (lecture seule) : un changement d'e-mail exige un nouveau parcours de vérification et reste hors périmètre. |

---

## 9. Conclusion

Le module Account Settings n'est plus une maquette : chaque onglet lit et écrit des données réelles, les sessions sont révocables, « Remember me » pilote réellement la durée du cookie et du jeton, le mot de passe oublié est complet et sûr, les préférences ont des effets vérifiables, et les uploads sont validés des deux côtés. Les limites restantes (SMTP réel, 2FA, IA, suppression de compte, traduction) sont explicites dans l'interface et dans ce rapport.
