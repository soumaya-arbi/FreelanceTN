# Quotes & Invoices Workflow Audit (FreelanceTN)

**Audit type:** code-level workflow audit only.  
**Scope:** Client, Freelancer, Frontend (Next.js), Backend (ASP.NET Core).  
**Date:** 2026-06-15 (workspace date context).  
**Status:** **No fixes or behavior changes were made to Quotes or Invoices as part of this mission.** This document is based on source inspection and existing automated test results where available; it does not claim manual browser/E2E verification.

## 1. Evidence sources (concrete)

### Frontend
- Routes/pages: `src/app/freelancer/quotes/page.tsx`, `src/app/freelancer/quotes/new/page.tsx`, `src/app/freelancer/quotes/[id]/page.tsx`, `src/app/freelancer/quotes/[id]/edit/page.tsx`, `src/app/client/quotes/page.tsx`, `src/app/client/quotes/[id]/page.tsx`, `src/app/freelancer/invoices/page.tsx`, `src/app/freelancer/invoices/new/page.tsx`, `src/app/freelancer/invoices/[id]/page.tsx`, `src/app/freelancer/invoices/[id]/edit/page.tsx`, `src/app/client/invoices/page.tsx`, `src/app/client/invoices/[id]/page.tsx`.
- Main UI/components: `src/components/modules/DocumentsView.tsx` (`QuotesView`, `InvoicesView`), `src/components/modules/DocumentDetail.tsx`, `src/components/modules/DocumentEditor.tsx`, `src/components/modules/ModuleShell.tsx` (layout shell used by document views).
- Possibly orphan/legacy component found (no imports found by grep): `src/components/views/freelancer/Quotes/QuoteList.tsx` (uses `quotesApi` directly and has "Mes devis"/French action labels; not used by the current quote routes).
- Domain/types/calculations: `src/lib/documents.ts`, `src/lib/types.ts` (`DocumentLine`, `QuoteStatus`, `InvoiceStatus`, `InvoicePayment`, `Quote`, `Invoice`).
- API client: `src/lib/api.ts` (`QuoteApi`, `InvoiceApi`, `quotesApi`, `invoicesApi`, including `quotesApi.listForClient()` and `invoicesApi.recordPayment()`).
- State/context: `src/context/MarketplaceContext.tsx` (`DocumentState`, `mapQuoteApi`, `mapInvoiceApi`, document loading, `addQuote`, `updateQuote`, `deleteQuote`, `setQuoteStatus`, `convertQuoteToInvoice`, `addInvoice`, `updateInvoice`, `deleteInvoice`, `setInvoiceStatus`, `recordPayment`).

### Backend
- Controllers/endpoints: `backend/src/FreelanceTn.Api/Controllers/QuotesController.cs`, `backend/src/FreelanceTn.Api/Controllers/InvoicesController.cs`.
- Services/business logic: `backend/src/FreelanceTn.Api/Services/QuoteService.cs`, `backend/src/FreelanceTn.Api/Services/InvoiceService.cs`.
- DTOs: `backend/src/FreelanceTn.Api/Dtos/Quotes/QuoteDtos.cs`, `backend/src/FreelanceTn.Api/Dtos/Invoices/InvoiceDtos.cs`.
- Models: `backend/src/FreelanceTn.Api/Models/Quote.cs`, `backend/src/FreelanceTn.Api/Models/Invoice.cs`, `backend/src/FreelanceTn.Api/Models/DocumentLine.cs`.
- Validators: `backend/src/FreelanceTn.Api/Validators/Quotes/QuoteValidators.cs`, `backend/src/FreelanceTn.Api/Validators/Invoices/InvoiceValidators.cs`.
- Persistence/config: `backend/src/FreelanceTn.Api/Data/MongoContext.cs`, `backend/src/FreelanceTn.Api/Configuration/MongoSettings.cs` (collections: `quotes` = `"quotes"`, `invoices` = `"invoices"`; counter collection used for numbering).

### Tests
- **Backend quote/invoice-specific test files:** none found by filename search under `backend` (`*Quote*Test*`, `*Invoice*Test*` excluding `bin/obj`). **Non couvert / absent (par recherche de fichiers).**
- Existing automated suites were run earlier in this session context for unrelated changes (mission 1): frontend `pnpm test` **41/41 passed**; backend `dotnet test backend\FreelanceTn.Api.sln -c Debug` **52/52 passed**. These numbers do **not** prove quote/invoice workflow coverage; they only indicate no detected regressions in covered areas at that time.

## 2. Workflow réel — Quotes (Devis), étape par étape

| Étape | Implémentation observée | État |
|---|---|---|
| Accès liste devis (freelancer) | Route `/freelancer/quotes` renders `QuotesView role="freelancer"`. Data from `useMarketplace().quotes`. | **Implémentée** |
| Accès liste devis (client) | Route `/client/quotes` renders `QuotesView role="client"`. `MarketplaceContext` loads client quotes via `quotesApi.listForClient()` (`GET /api/quotes/client`) when `role === "client"`. | **Implémentée (partiellement cohérente côté visibilité — voir limites)** |
| Création devis | Freelancer only in UI: `QuotesView` shows "New quote" button only when `role === "freelancer"` → `/freelancer/quotes/new` → `DocumentEditor role="freelancer" kind="quote"`. Submit calls `addQuote` → `quotesApi.create` (`POST /api/quotes`). Backend `QuoteService.CreateAsync` sets `OwnerId = current user`, validates session/user exists (`EnsureFreelancerOrOwnerAsync`), requires valid `ProjectId`, checks project access (`AssignedTo == ownerId || OwnerId == ownerId`), normalizes lines/calculates totals server-side, generates number `DEV-{year}-{seq}` via `Counters` upsert/inc, sets status default `draft` (or requested status after normalization), inserts into `quotes` collection. | **Implémentée** (création initiée côté freelancer dans l’UI; backend n’impose pas explicitement le rôle "freelancer" par nom dans le code lu, mais contrôle l’accès projet et le propriétaire = utilisateur courant) |
| Qui peut créer | UI: freelancer workspace only (no client "New quote" action). Backend: authenticated user; must have access to the referenced project (`AssignedTo` or project `OwnerId`) and becomes quote `OwnerId`. | **Implémentée / partiellement contrainte par rôle UI** |
| Champs obligatoires (frontend éditeur) | `DocumentEditor.validate`: client name, project, issue date, end/validity date, at least one line with description; quantity > 0, unitPrice >= 0, taxRate >= 0, discount 0–100. Notes optional. Attachments are local/session-only references, not uploaded (`notify` states "files are not uploaded"). | **Implémentée (frontend)** |
| Champs obligatoires (backend) | FluentValidation `CreateQuoteRequestValidator`: `Client`, `ProjectId`, `IssueDate`, `ValidUntil`, `Lines` non-empty; each line validated (`Description`, `Quantity > 0`, `UnitPrice >= 0`, `TaxRate >= 0`, `Discount 0–100`). Service also normalizes/validates lines and throws on invalid project/id/empty lines. `QuoteLineRequest.Description`/dates/project/client are strings; date format/chronology not deeply validated in code read. | **Implémentée (validation structurelle)** |
| Calcul montants/taxes/totaux/devise | Frontend preview: `src/lib/documents.ts` computes `subtotal` (sum qty*unit), `discount` (sum line discount), `tax` (sum taxable*taxRate), `total` (sum line totals). Backend authoritative: `QuoteService.Calculate` computes same formula with `decimal`, rounds money fields to **3 decimals** (`Math.Round(..., 3)`), clamps negative total to 0; stores `Subtotal/DiscountTotal/TaxTotal/Total` and returns per-line computed fields. **Currency:** UI labels TND (`formatTND`); **no explicit currency field/constraint observed in Quote model/DTO/service** beyond frontend formatting and prior system context. | **Implémentée (calcul)** / **Devise non formalisée côté devis — non fonctionnel/absent comme champ métier vérifié** |
| Envoi à l’autre partie | No dedicated "send email/message" action found. Freelancer can set status to `sent` from detail (`Mark as sent`, draft → sent via `setQuoteStatus`) or save/edit; backend `UpdateStatusAsync` allows owner (and restricts client actions). No quote notification/send workflow found in `QuoteService`/controller code read. | **Partiellement implémentée** (changement de statut "sent"; transmission/notification réelle non vérifiée / absente dans code lu) |
| Consultation destinataire | Client list/detail routes exist (`/client/quotes`, `/client/quotes/[id]`). Client data loaded via `GET /api/quotes/client` (`ListForClientAsync` filters `ClientId == clientUserId`). Detail fetch/display depends on loaded `quotes` in context (`DocumentDetail` finds document in context arrays; if absent shows unavailable/loading/error state). Direct deep-link availability depends on whether client-scoped documents are present in context — **partiellement dépendant du chargement contexte**. | **Partiellement implémentée** |
| Actions disponibles | **Freelancer (UI):** create, edit (if not converted), delete (if not converted), mark draft→sent, mark sent→accepted (owner can set statuses; see backend rule), convert accepted non-converted quote to invoice, view invoice after conversion, print/PDF (browser print). **Client (UI):** when `role=client`, quote `sent`, not converted: Decline / Accept quote (`setQuoteStatus` to `refused`/`accepted`). | **Implémentée (actions UI principales)** |
| Acceptation / refus / modification / annulation | Accept/refuse: client can accept/refuse `sent` quotes in UI; backend allows client only `accepted`/`refused`. Owner can also change status through `UpdateStatusAsync` if owner (no explicit owner-only status whitelist seen except "clients can accept/refuse; owners can send etc." comment and only client restriction enforced). Modification: owner only, blocked if `ConvertedTo` set. Annulation/suppression: owner delete, blocked if converted. No explicit "cancel" status; refusal is `refused`. | **Implémentée avec écarts de règles** (voir tableau transitions) |
| Statuts & transitions | Model statuses: `draft`, `sent`, `accepted`, `refused`. Backend `UpdateStatusAsync`: rejects if converted; rejects if invalid; if client, only `accepted`/`refused`; no explicit state machine for owner (owner can request any valid status) — **transition graph not strictly enforced server-side beyond converted/role/validity**. Frontend exposes limited transitions. | **Partiellement implémentée** (états présents; transitions strictes incomplètes côté backend) |
| Persistance MongoDB | Collection `quotes` (`MongoSettings.QuotesCollection = "quotes"`). `InsertOneAsync` on create; `ReplaceOneAsync` on update/status; `DeleteOneAsync` on delete. Number generated via `Counters` collection (`quote-{year}`, `seq`). `UpdatedAt` set on modifications. | **Implémentée** |
| Information des deux utilisateurs | No explicit notification/email/push trigger found in `QuotesController`/`QuoteService` code read. Client must consult client quote list/detail; freelancer uses own list/detail. | **Absente / non vérifiable dans le code lu** (pas de notification métier explicite observée) |
| Relation Project / User / Invoice | `Quote` stores `OwnerId`, `ClientId?`, `ProjectId`, `Project` (label), `ConvertedTo?`. Create validates project exists and requester access to project; may infer `ClientId` from `project.OwnerId` when requester is assigned freelancer (`project.OwnerId != ownerId`). Conversion endpoint creates invoice with `QuoteId` and marks quote converted (service/controller flow). Invoice model stores `QuoteId?`. | **Implémentée** |
| Validations backend / frontend | Frontend: structural/date presence, numeric ranges, at least one described line, attachments not uploaded. Backend: FluentValidation + service normalization/calculation/ownership/project checks/ObjectId checks/status normalization. | **Implémentée** |
| Conversion devis → facture | UI: freelancer can convert accepted, non-converted quote (`DocumentDetail.convert`) → `convertQuoteToInvoice` API. API client: `POST /api/quotes/{id}/convert-to-invoice`. `QuotesController.ConvertToInvoice`: loads quote via `QuoteService.GetAsync` (allows owner or client to read), then enforces `quote.OwnerId == CurrentUserId` (owner only), rejects if already converted or not `Accepted`, builds `CreateInvoiceRequest` (copies client/project/quote id, dates now/+30 days, status `unpaid`, lines/notes, `ClientId`), calls `_invoiceService.CreateAsync(CurrentUserId, ...)`. `InvoiceService.CreateAsync` revalidates quote ownership/accepted/not-converted when `QuoteId` provided, inserts invoice, atomically claims quote with `UpdateOneAsync` filter `ConvertedTo null/empty` and sets `ConvertedTo = invoice.Id`; on race/failure deletes invoice and throws conflict. Frontend then navigates to created invoice. | **Implémentée** (logique robuste contre double conversion observée côté service) |

## 3. Workflow réel — Invoices (Factures), étape par étape

| Étape | Implémentation observée | État |
|---|---|---|
| Accès liste factures | Freelancer: `/freelancer/invoices` → `InvoicesView role="freelancer"`. Client: `/client/invoices` → `InvoicesView role="client"`. Data from `useMarketplace().invoices`. `MarketplaceContext` loads invoices via `invoicesApi.list()` for both roles. Backend `InvoiceService.ListAsync` returns invoices where `OwnerId == userId || ClientId == userId` and applies overdue side effects when needed. | **Implémentée** |
| Qui peut créer | UI: "New invoice" button only for freelancer. API `POST /api/invoices` requires `[Authorize]`; service creates invoice with `OwnerId = current user` and validates project/quote ownership when provided. | **Implémentée** (création initiée côté freelancer dans l’UI) |
| Création manuelle ou depuis devis accepté/projet | **Manuelle:** `/freelancer/invoices/new` + `DocumentEditor kind="invoice"`. **Depuis devis:** quote conversion flow creates invoice (`CreateInvoiceRequest` includes `QuoteId`, status `unpaid`, copied lines/notes). **Projet:** invoice can be linked to `ProjectId`; project access validated (`AssignedTo` or `OwnerId`). | **Implémentée** |
| Champs obligatoires (frontend) | Same structural editor validation as quote for client/project/dates/lines; due date label used instead of validity. | **Implémentée** |
| Champs obligatoires (backend) | `CreateInvoiceRequestValidator`: `Client`, `ProjectId`, `IssueDate`, `DueDate`, `Lines` + line validation. Service validates quote/project/ObjectIds and line normalization. | **Implémentée** |
| Calcul montants/taxes/totaux/devise | Same formula as quotes; backend calculates and stores totals, `AmountPaid`, `BalanceDue`. Frontend displays TND; invoice model has no explicit currency field observed. | **Implémentée (calcul)** / **Devise non formalisée — non vérifié/absent comme champ métier** |
| Transmission au destinataire | Status can be moved from `draft` to sent via UI action `Mark as sent` → `setInvoiceStatus(..., "emise")` (freelancer). `InvoiceService.UpdateStatusAsync` maps `issued/sent` to `Emise`; allows client only `paid` through status endpoint. No email/notification sending found in service/controller. | **Partiellement implémentée** (statut "émise/sent"; transmission réelle non vérifiée) |
| Actions client/freelancer | **Freelancer:** create/edit (blocked if paid), delete (blocked if paid or any amount paid), mark draft→sent, record payments (form), print/PDF, view linked quote in timeline not directly as action except context; conversion creates invoice from quote side. **Client:** view list/detail (via dual-owner/client listing), mark as paid in full (UI calls `recordPayment` for remaining balance when not paid and balance > 0) — note `DocumentDetail` client action is "Mark as paid" → `payInFull()`/`recordPayment`; backend `RecordPaymentAsync` allows owner or client. Status endpoint allows client only `paid`, but client UI path observed uses `recordPayment`, not `setInvoiceStatus`. | **Implémentée (actions principales)** |
| Statuts & transitions | Model statuses: `draft`, `emise`, `unpaid`, `partially_paid`, `paid`, `overdue` (`All`). `ResolveStatus` maps `issued/sent` → `emise`. `UpdateStatusAsync`: owner or client can access; client may only set `paid`; paid invoice cannot be reopened to non-paid; setting `paid` adjusts amounts/payment record if needed. `RecalculatePayments` derives `paid`/`partially_paid` (and adjusts `AmountPaid/BalanceDue`) based on payments/totals; can override/normalize status in some paths. `ApplyOverdueIfNeeded`: only affects non-draft, non-paid invoices with parseable `DueDate` past UTC date and balance > 0 → sets `overdue` (applied on get/list/update/payment/status calculation paths). **Strict transition graph not fully explicit; some status changes are inferred by payment recalculation.** | **Partiellement implémentée** |
| Paiement: représentation et suivi | `InvoicePayment` model/list persisted (`amount`, `date`, `note`, `reference`). `POST /api/invoices/{id}/payments` records payment; validates amount > 0, not exceeding balance, parseable date (service). `RecalculatePayments` sums payments, updates `AmountPaid`/`BalanceDue`, sets `paid`/`partially_paid`. UI shows payment history and form (owner or client path not restricted in UI beyond `canRecordPayment`; client also has "Mark as paid"). | **Implémentée** (suivi interne/paiement manuel; pas d’intégration de paiement réelle) |
| Échéances / retard / impayés | `DueDate` stored/required. Overdue applied dynamically by `ApplyOverdueIfNeeded` on reads/list/updates/payment/status operations (and bulk-replaced during `ListAsync` when changed). Draft not auto-overdue. No scheduler/cron/background job found in code read; overdue depends on access paths. | **Partiellement implémentée** |
| Enregistrement MongoDB | Collection `invoices`. Insert/replace/delete/bulk updates for overdue in list. Number `FAC-{year}-{seq}` via counters. Quote claim on conversion uses atomic `UpdateOneAsync`. | **Implémentée** |
| Relations Quote / Invoice / Project / Users | Invoice stores `OwnerId`, `ClientId?`, `ProjectId`, `Project`, `QuoteId?`. Created from quote copies `QuoteId` and `ClientId`; conversion marks quote `ConvertedTo`. Project access checked; may infer `ClientId` from project owner for freelancer-created invoices. | **Implémentée** |
| Validations frontend / backend | Frontend editor/detail forms validate/guard (amounts, date, balance). Backend validators + service checks (ownership, project/quote validity, paid/partially paid deletion/edit constraints, payment bounds). | **Implémentée** |

## 4. Différences de droits Client / Freelancer

| Fonction | Freelancer (propriétaire) | Client (destinataire) | Preuve / observation |
|---|---|---|---|
| Créer devis | Oui via UI `/freelancer/quotes/new`; backend owner = current user | Pas d’action UI observée | `QuotesView` new button only freelancer; `QuoteService.CreateAsync` sets `OwnerId` |
| Voir liste devis | `GET /api/quotes` (owner-scoped `OwnerId`) | `GET /api/quotes/client` (filtered by `ClientId`) via context when role client | `QuotesController.GetAll`/`GetForClient`; `MarketplaceContext` uses `listForClient()` for clients |
| Voir détail devis | Autorisé si owner ou client (`QuoteService.GetAsync`) | Autorisé si owner ou client | `GetAsync` checks `OwnerId != userId && ClientId != userId` → forbidden |
| Modifier/supprimer devis | Owner only; bloqué si converti | Non (backend interdit) | `UpdateAsync`/`DeleteAsync` owner checks |
| Changer statut devis | Owner peut modifier statut (validé); client limité à `accepted`/`refused` | Peut accepter/refuser (backend/UI) | `UpdateStatusAsync` role logic |
| Convertir devis en facture | Owner only (controller checks `quote.OwnerId == CurrentUserId`) | Non | `QuotesController.ConvertToInvoice` |
| Créer facture | UI freelancer; backend owner = current user | Pas d’action UI observée | `InvoicesView` new button; `InvoiceService.CreateAsync` |
| Voir liste factures | `GET /api/invoices` returns owner or client invoices | Même endpoint, résultats filtrés owner OR client | `InvoiceService.ListAsync` |
| Voir détail facture | Owner ou client | Owner ou client | `InvoiceService.GetAsync` |
| Modifier facture | Owner only; bloqué si `Paid` | Non | `UpdateAsync` |
| Supprimer facture | Owner only; bloqué si `Paid` ou `AmountPaid > 0` | Non | `DeleteAsync` |
| Marquer facture envoyée (`emise`) | UI action; backend status change allowed as valid status (owner path) | Client ne peut mettre que `paid` via endpoint statut | `DocumentDetail` + `UpdateStatusAsync` |
| Enregistrer paiement | Backend permet owner ou client | Backend permet owner ou client; UI client a "Mark as paid" (paie solde complet) | `RecordPaymentAsync`, `DocumentDetail.payInFull`/`submitPayment` visibility `canRecordPayment` |
| Statut facture via endpoint statut | Owner peut demander statuts valides (avec règles paid) | Client limité à `paid` | `UpdateStatusAsync` |

## 5. Tableau des statuts et transitions

### Quotes

| Statut actuel | Transition observée (UI principale) | Autorisé backend (observé) | Effet / garde | Implémentation |
|---|---|---|---|---|
| `draft` | Freelancer: Mark as sent | Owner: statut valide accepté (pas de machine d’états stricte explicite). Client: seulement accept/refuse (donc refusé pour draft). | Converti bloqué pour modification/suppression/statut. | **Partielle** |
| `sent` | Freelancer: Mark as accepted (UI). Client: Accept / Decline. | Owner: statuts valides. Client: `accepted`/`refused` seulement. | — | **Implémentée** |
| `accepted` | Freelancer: Convert to invoice (si non converti). | Statut modifiable par owner si non converti (pas strictement interdit par code lu); conversion réservée owner et requiert accepted + non converti. | Conversion crée facture, marque `ConvertedTo`. | **Implémentée (conversion)** / **statut post-acceptation peu contraint** |
| `refused` | Aucune transition UI principale observée | Owner peut potentiellement repositionner (code n’impose pas interdiction explicite hors converted); client limité. | — | **Partielle / non clarifiée** |
| any + `ConvertedTo` set | UI bloque edit/delete/most status actions; propose "View invoice" | Update/Delete/UpdateStatus refusent si converti. Conversion refuse si déjà converti. | Intégrité conversion. | **Implémentée** |

### Invoices

| Statut actuel | Transition/action observée | Autorisé backend (observé) | Effet / garde | Implémentation |
|---|---|---|---|---|
| `draft` | Freelancer: Mark as sent (`emise`), edit, delete (si non payé/aucun paiement) | Statuts valides; owner/client rules; paid guard | `ApplyOverdueIfNeeded` ignore draft/paid. | **Implémentée** |
| `emise` / `unpaid` / `overdue` | Paiement partiel/complet (record payment), client "Mark as paid" (record full payment), owner peut enregistrer paiement | `RecordPaymentAsync` owner ou client; recalcul peut passer à `partially_paid`/`paid`; client status endpoint limité à `paid`. | Overdue recalculé selon due date/solde. | **Implémentée** |
| `partially_paid` | Paiements additionnels jusqu’au solde | Paiement <= solde; recalcul → `paid` quand soldé | Mise à jour `AmountPaid`/`BalanceDue`. | **Implémentée** |
| `paid` | UI masque record payment/edit; delete bloqué | `UpdateStatusAsync` refuse réouverture; `RecordPaymentAsync` refuse; `Update`/`Delete` refusent selon règles | Facture verrouillée fonctionnellement. | **Implémentée** |
| non-draft, non-paid, due date dépassée | Peut devenir `overdue` lors de get/list/update/payment/status | `ApplyOverdueIfNeeded` sur chemins d’accès | Pas de job planifié observé. | **Partielle** |

## 6. Relations entre entités

- **Quote → Project:** `ProjectId` requis/validé; accès projet vérifié; `Project` (libellé) stocké.
- **Quote → Users:** `OwnerId` (créateur/propriétaire), `ClientId?` (destinataire; peut être inféré depuis `project.OwnerId` quand le freelancer assigné crée le devis).
- **Quote → Invoice:** `ConvertedTo` sur le devis; `QuoteId` sur la facture; conversion atomique côté service.
- **Invoice → Project:** `ProjectId` stocké/validé si fourni.
- **Invoice → Users:** `OwnerId`, `ClientId?` (peut être inféré depuis projet).
- **Invoice → Payments:** `Payments[]` embarqués dans le document facture.
- **Collections MongoDB:** `quotes`, `invoices` (noms depuis `MongoSettings`), `counters` pour numérotation. **Aucun index quotes/invoices explicite observé dans `MongoContext.EnsureIndexesAsync`** (contrairement à projects/proposals/feedbacks/comments/portfolio etc.).

## 7. Endpoints et composants impliqués

### Frontend composants/pages
- Listes: `DocumentsView.tsx` (`QuotesView`, `InvoicesView`), routes `*/quotes/page.tsx`, `*/invoices/page.tsx`.
- Détail: `DocumentDetail.tsx`, routes `*/quotes/[id]/page.tsx`, `*/invoices/[id]/page.tsx`.
- Création/édition: `DocumentEditor.tsx`, routes `*/quotes/new`, `*/quotes/[id]/edit`, `*/invoices/new`, `*/invoices/[id]/edit`.
- État métier: `MarketplaceContext.tsx` (mappings, load, CRUD, status, conversion, payment).
- Calcul/format: `documents.ts`.

### API client (frontend)
- Quotes: `GET /api/quotes`, `GET /api/quotes/client`, `GET /api/quotes/:id`, `POST /api/quotes`, `PUT /api/quotes/:id`, `DELETE /api/quotes/:id`, `PATCH /api/quotes/:id/status`, `POST /api/quotes/:id/convert-to-invoice`.
- Invoices: `GET /api/invoices`, `GET /api/invoices/:id`, `POST /api/invoices`, `PUT /api/invoices/:id`, `DELETE /api/invoices/:id`, `PATCH /api/invoices/:id/status`, `POST /api/invoices/:id/payments`.

### Backend
- `QuotesController`: routes `api/quotes` (`GET`, `GET client`, `GET {id}`, `POST`, `PUT {id}`, `DELETE {id}`, `PATCH {id}/status`, `POST {id}/convert-to-invoice`).
- `InvoicesController`: routes `api/invoices` (`GET`, `GET {id}`, `POST`, `PUT {id}`, `DELETE {id}`, `PATCH {id}/status`, `POST {id}/payments`).
- Services: `QuoteService`, `InvoiceService`.

## 8. Problèmes identifiés, classés par gravité

| Gravité | Problème | Preuve | Impact potentiel |
|---|---|---|---|
| **Haute** | **Machine d’états quotes non strictement appliquée côté backend pour le propriétaire.** Un owner peut demander des statuts valides sans transitions explicites (hors converted/client restrictions). | `QuoteService.UpdateStatusAsync` valide/normalise et ne limite le client qu’à accept/refuse; pas de graphe d’états owner. | États incohérents possibles via API directe ou futures UI. |
| **Haute** | **ClientId peut rester absent/incohérent selon le flux.** `Client` (nom texte) est obligatoire; `ClientId` est optionnel et parfois inféré. L’accès client liste dépend de `ClientId == clientUserId`. | `CreateQuoteRequest.ClientId` optionnel; `ListForClientAsync` filtre sur `ClientId`; `MarketplaceContext` client utilise `listForClient()`. | Client destinataire peut ne pas voir un devis/facture censé lui être adressé si `ClientId` non lié correctement. |
| **Moyenne** | **Asymétrie de visibilité/listing quotes vs invoices.** Quotes owner list = owner only; client uses separate endpoint. Invoices list endpoint returns owner OR client. UI dépend du contexte chargé; `DocumentDetail` cherche dans le contexte. | `QuoteService.ListAsync` vs `ListForClientAsync`; `InvoiceService.ListAsync` owner||client; `DocumentDetail` uses in-memory `quotes`/`invoices`. | Comportements différents et risques de "document not available" sur deep-link selon état contexte/rôle/chargement. |
| **Moyenne** | **Aucune notification métier explicite observée pour envoi/acceptation/refus/paiement/conversion.** | Absence de déclencheurs notification dans `QuoteService`/`InvoiceService`/controllers lus. | Les parties peuvent ne pas être informées des changements sans consultation manuelle. |
| **Moyenne** | **Devise non modélisée explicitement dans les documents Quote/Invoice.** TND est affiché côté frontend; backend stocke décimaux sans currency field observé. | `documents.ts` `formatTND`; `Quote`/`Invoice`/DTOs sans `Currency`. | Risque si multi-devise ou intégrations futures; ambiguïté métier. |
| **Moyenne** | **Overdue dépend des accès (pas de tâche planifiée).** `ApplyOverdueIfNeeded` s’exécute lors de get/list/update/payment/status. | `InvoiceService` methods call `ApplyOverdueIfNeeded`; no scheduler found in code read. | Statut `overdue` peut ne pas se propager tant qu’aucun accès/flux ne touche la facture. |
| **Moyenne** | **Dates stockées comme chaînes; validation chronologique/format limitée.** | Models use `string` dates; validators check non-empty; service parses due date for overdue/payment date parse in some cases. `ValidUntil < IssueDate` non vérifié explicitement dans le code lu. | Données temporelles incohérentes possibles. |
| **Moyenne** | **Pièces jointes éditeur non persistées.** UI permet d’attacher des fichiers mais indique qu’ils sont référencés localement/session et non uploadés. | `DocumentEditor.onFiles` notify "files are not uploaded". | Attentes utilisateur non satisfaites. |
| **Basse** | **Composant `QuoteList.tsx` orphelin/non utilisé détecté.** | `src/components/views/freelancer/Quotes/QuoteList.tsx` exists; no imports found by grep; routes use `DocumentsView`. | Dette technique / confusion maintenance. |
| **Basse** | **Pas d’index MongoDB dédiés quotes/invoices observés.** | `MongoContext.EnsureIndexesAsync` ne contient pas d’index pour `QuotesCollection`/`InvoicesCollection`. | Performance/scalabilité sur listes par owner/client/projet/statut (non mesuré). |
| **Basse** | **Statut facture `issued/sent` mappé vers `emise` (terminologie mixte).** | `InvoiceService.ResolveStatus` / model normalize; frontend `invoiceStatusLabels` maps `emise` to "Sent". | Compréhension interne/interop API potentiellement confuse. |
| **Info / non vérifié** | **Aucune suite de tests backend spécifique Quotes/Invoices trouvée par nom de fichier.** | Recherche `*Quote*Test*`, `*Invoice*Test*` sous `backend` (hors bin/obj) sans résultat. | Couverture fonctionnelle du workflow devis/factures non démontrée par tests ciblés. |

## 9. Recommandations de correction (NON appliquées)

1. Définir et appliquer une **machine d’états explicite** côté backend pour quotes et invoices (transitions autorisées par rôle), avec erreurs métier claires.
2. Rendre la liaison destinataire **fiable**: exiger/résoudre `ClientId` à partir du projet/client sélectionné quand possible; valider cohérence client/projet/utilisateur; exposer un identifiant client sélectionnable dans l’UI.
3. Unifier la **visibilité client** des devis/factures (comportement similaire, endpoints/document loading cohérents) et gérer les deep-links par fetch API ciblé plutôt que dépendance au cache contexte.
4. Ajouter des **notifications métier** (création/envoi devis, acceptation/refus, conversion, facture émise, paiement partiel/complet, retard) en réutilisant le mécanisme de notifications existant si approprié.
5. Ajouter un champ **`Currency`** (défaut TND) aux modèles/DTOs/API/UI si le produit doit rester explicite et évolutif.
6. Mettre en place une **détection d’overdue planifiée** (job/background service) ou un calcul d’affichage cohérent, selon besoin métier.
7. Valider les **dates** (format ISO attendu, `validUntil/dueDate >= issueDate` si règle métier).
8. Soit implémenter l’**upload persistant des pièces jointes** pour documents, soit retirer/clarifier l’UI pour éviter la fausse affordance.
9. Supprimer ou réintégrer consciemment `src/components/views/freelancer/Quotes/QuoteList.tsx` selon la stratégie UI.
10. Ajouter des **index MongoDB** adaptés (ownerId/clientId/projectId/status/createdAt/dueDate/quoteId/convertedTo selon requêtes réelles).
11. Ajouter des **tests backend ciblés** (création, droits owner/client, transitions, conversion atomique, paiements, overdue, suppression/verrouillage) et des tests frontend des flux critiques.

## 10. Questions métier nécessitant décision

1. **Qui peut créer un devis ?** Uniquement le freelancer assigné/propriétaire lié au projet, ou aussi le client ? Le backend actuel se base sur l’accès projet et fait du créateur l’`OwnerId`.
2. **Le client doit-il être un compte lié (`ClientId`) obligatoire ?** Ou le devis/facture peut-il cibler un nom libre sans compte destinataire ?
3. **Quelles transitions de statut sont autorisées exactement ?** (ex. `draft → sent → accepted/refused`, retours arrière autorisés ? qui peut changer quoi ?)
4. **Une facture peut-elle être marquée payée par le client via endpoint statut seul, ou doit-on toujours passer par un paiement/enregistrement ?** Les deux chemins existent techniquement.
5. **Comment gérer le retard (`overdue`) ?** Mise à jour automatique planifiée, calcul à la volée, notifications, pénalités ?
6. **Les pièces jointes de devis/factures doivent-elles être stockées** (et où) ou rester hors périmètre ?
7. **La devise est-elle toujours TND ?** Faut-il rendre la devise explicite dans les données et permettre autre chose à terme ?
8. **Un devis refusé peut-il être réédité/renvoyé ?** Quel flux attendu (nouveau devis, clone, changement de statut) ?
9. **Une facture issue d’un devis doit-elle hériter/modifier le `ClientId` et les conditions** (échéance, notes, statut initial) selon une règle métier fixe ?
10. **Faut-il conserver `QuoteList.tsx`** (composant orphelin) ou standardiser sur `DocumentsView/DocumentDetail/DocumentEditor` ?

## 11. Limites de vérification

- **Aucun test navigateur manuel/E2E** exécuté dans cette session d’audit. Les parcours utilisateur réels, rendus, permissions effectives en session, erreurs réseau/runtime et intégration visuelle ne sont pas prouvés ici.
- **Aucune modification MongoDB, aucune requête destructive, aucun Git commit** effectués.
- Le comportement exact peut dépendre de l’enregistrement des validators FluentValidation, middleware d’authentification, configuration MongoDB réelle, et données existantes — **non entièrement vérifiable par lecture statique seule**.
- Les notifications métier « internes » hors devis/factures n’ont pas été auditées en profondeur; l’absence de notification observée dans les services devis/factures ne prouve pas qu’aucun mécanisme externe n’existe ailleurs.
