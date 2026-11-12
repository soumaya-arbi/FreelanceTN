# Contrat d'implémentation — Server Actions FreelanceTN

Ce document est la référence commune pour les modules migrés du backend .NET
vers des Server Actions Next.js avec accès MongoDB direct. Il ne doit pas être
importé par du code applicatif.

## Infrastructure existante (ne pas modifier sans raison)

- `src/lib/server/db.ts` : `collections.<nom>()` renvoie la collection Mongo
  (noms identiques à `MongoSettings.cs`), `getDb()`, `COLLECTIONS`.
- `src/lib/server/session.ts` : `getSessionUser()`, `requireUser()`,
  `requireRole("client" | "freelancer")`, `displayName(user)`, `userIdOf(value)`.
  Le rôle et l'identifiant viennent TOUJOURS de la session, jamais du client.
- `src/lib/server/errors.ts` : `ActionError`, `validationError`, `unauthorized`,
  `forbidden`, `notFound`, `conflict`, `runAction(fn)`.
- `src/lib/server/serialize.ts` : `serialize(value)` (ObjectId -> string,
  Decimal128 -> number, Date -> ISO string), `toObjectId`, `toDecimal`,
  `round3`, `text`, `number`.
- `src/lib/server/notifications.ts` : `createNotification(input)`,
  `getNotificationPreferences(userId)`, `filterNotifications(items, prefs)`.
- `src/lib/server/accountChanges.ts` : `recordAccountChange(userId, area, summary)`.
- `src/lib/server/revalidate.ts` : `revalidateApp()`.
- `src/lib/actions/types.ts` : `ActionResult<T>`.

## Structure attendue par module

1. `src/lib/server/repositories/<module>.ts`
   - Types des documents Mongo réellement stockés (casse exacte des champs !).
   - Accès collection + helpers de lecture/écriture.
   - Aucune règle métier, aucune vérification de session.
2. `src/lib/server/services/<module>.ts`
   - Règles métier portées fidèlement depuis le service C# correspondant.
   - Reçoit un `SessionUser` (ou l'identifiant) en paramètre : ne lit jamais le
     cookie lui-même.
   - Lève `ActionError` avec les messages français du backend.
3. `src/lib/actions/<module>.ts`
   - `"use server";` en première ligne.
   - Exporte UNIQUEMENT des fonctions `async`.
   - Chaque fonction : `return runAction(async () => { ... });`
   - Vérifie la session via `requireUser()` / `requireRole(...)`.
   - Appelle le service puis `revalidateApp()` pour les mutations.
   - Renvoie des données déjà sérialisées (`serialize(...)`).

## Règles générales

- Casse MongoDB vérifiée en base :
  - camelCase : `projects`, `quotes`, `invoices`, `proposals`, `portfolio`,
    `feedback`, `comments`, `invitations`, `users`, `services`, `counters`.
  - PascalCase : `tasks`, `task_comments`, `notifications`.
  - Mixte : `authSessions` (`UserId`, `tokenHash`, ...), `userPreferences`,
    `billingProfiles`, `notificationPreferences`, `accountChanges` (`UserId`),
    `teamMembers` (`OwnerId`).
- Types BSON : `tasks.ProjectId`, `task_comments.TaskId/ProjectId`,
  `notifications.RecipientId`, `comments.projectId/authorId`,
  `feedback.projectId/clientId/freelancerId` sont des ObjectId.
  `projects.ownerId`, `quotes.ownerId/clientId`, `invoices.ownerId/clientId`,
  `proposals.*Id`, `portfolio.ownerId`, `invitations.*Id` sont des strings.
- Montants : `Decimal128` (`toDecimal`), arrondi `round3` à 3 décimales.
- Les réponses doivent conserver la forme JSON du backend .NET (noms de champs
  camelCase des DTO, dates ISO, nombres). `serialize` s'en charge pour les
  documents bruts ; pour les DTO reconstruits, renvoyer un objet simple.
- Ne jamais exposer : `passwordHash`, tokens, secrets 2FA, `walletAddress`,
  adresses e-mail privées dans les endpoints publics.
- Ne jamais accepter un `userId`, `ownerId`, `role`, `clientId`, `freelancerId`
  fourni par le client pour décider des droits : le déduire de la session.
- Après mutation : `revalidateApp()`.
- Aucune nouvelle dépendance npm. Aucun appel HTTP interne vers .NET.
- Messages d'erreur en français, UTF-8 correct (ne pas recopier les octets
  mojibake de certains fichiers C#).
- TypeScript strict : pas de `any` non justifié, pas de `@ts-ignore`.
- Double quotes, indentation 2 espaces, exports nommés.

## Correspondance avec `src/lib/api.ts`

Les wrappers de `api.ts` appellent les actions puis convertissent un échec en
`ApiError(status, message, errors)`. Les actions doivent donc renvoyer
exactement les mêmes formes que les DTO du backend.

### projects
Actions (`src/lib/actions/projects.ts`) :
`listProjects`, `listProjectCatalog(params)`, `listAssignedProjects`,
`listProjectAssignees`, `getProject(id)`, `createProject(input)`,
`updateProject(id, input)`, `submitProjectForReview(id, message?)`,
`deleteProject(id)`, `reopenProject(id, message?)`,
`projectMilestoneAction(projectId, milestoneId, input)`,
`addProjectMilestone(projectId, input)`, `listProjectCatalogCategories`.

### proposals
`createProposal(input)`, `listMyProposals()`, `listReceivedProposals(projectId?)`,
`getProposal(id)`, `setProposalStatus(id, status)`, `deleteProposal(id)`.

### quotes
`listQuotes()`, `listClientQuotes()`, `getQuote(id)`, `createQuote(input)`,
`updateQuote(id, input)`, `deleteQuote(id)`,
`updateQuoteStatus(id, status, note?, abandon?)`, `convertQuoteToInvoice(id)`.

### invoices
`listInvoices()`, `getInvoice(id)`, `createInvoice(input)`,
`createInvoiceFromQuote(quoteId, input?)`, `updateInvoice(id, input)`,
`deleteInvoice(id)`, `updateInvoiceStatus(id, status)`.
`recordPayment` reste sur .NET.

### tasks
`listTasks()`, `getTask(id)`, `createTask(input)`, `updateTask(id, input)`,
`deleteTask(id)`, `listTaskComments(id)`, `addTaskComment(id, content)`.

### notifications
`listNotifications()`, `unreadNotificationCount()`,
`markNotificationRead(id)`, `markAllNotificationsRead()`.

### feedback
Module resté sur .NET (`FeedbacksController`), seule source de vérité pour
l'évaluation bidirectionnelle : `GET /api/feedbacks/mine`,
`GET /api/feedbacks/freelancer/{id}`, `GET /api/feedbacks/user/{id}`,
`GET /api/feedbacks/summary/{id}`, `POST /api/feedbacks/requests/{projectId}`,
`POST /api/feedbacks/{projectId}/submit`. Le frontend passe par `feedbacksApi`
(`src/lib/api.ts`). Les anciennes server actions `createFeedback`,
`updateFeedback` et `deleteFeedback` ont été retirées : un avis ne peut plus
être modifié ni supprimé après soumission.

La publication différée ne dépend d'aucune consultation : un
`BackgroundService` du backend (`FeedbackPublicationWorker`) exécute
`ProcessPendingAsync` à intervalle régulier (section `Feedback` des appsettings,
`Feedback__IntervalSeconds` surchargeable). Les lectures et soumissions
continuent d'appeler le même traitement comme filet de sécurité.

### comments
`listProjectComments(projectId)`, `createComment(projectId, content)`,
`updateComment(id, content)`, `deleteComment(id)`.

### portfolio
`listMyPortfolio()`, `listFreelancerPortfolio(freelancerId)`,
`getPortfolioItem(id)`, `createPortfolioItem(input)`,
`updatePortfolioItem(id, input)`, `deletePortfolioItem(id)`.

### freelancers
`listFreelancers()`, `getFreelancer(id)`.

### invitations
`createInvitation(input)`, `listMyInvitations()`, `listSentInvitations()`,
`acceptInvitation(id)`, `declineInvitation(id, reason?)`.

### account
`getClientProfile()`, `updateClientProfile(input)`, `setAvatarStyle(input)`,
`getBillingProfile()`, `updateBillingProfile(input)`,
`getNotificationPreferencesAction()`, `updateNotificationPreferences(input)`,
`getUserPreferences()`, `updateUserPreferences(input)`, `getAccountHistory()`,
`exportAccount()`, `getPublicClientProfile(id)`.
`getSecurity`, changement de mot de passe, 2FA, révocation de sessions et
équipe restent sur .NET.

### profil (auth.updateMe)
`updateMyProfile(input)` dans `src/lib/actions/profile.ts`.
