using FreelanceTn.Api.Configuration;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Data;

public class MongoContext
{
    private readonly IMongoDatabase _database;

    public MongoContext(IOptions<MongoSettings> options)
    {
        var settings = options.Value;
        var client = new MongoClient(settings.ConnectionString);
        _database = client.GetDatabase(settings.DatabaseName);
        Settings = settings;
    }

    public MongoSettings Settings { get; }

    public IMongoDatabase Database => _database;

    public IMongoCollection<T> GetCollection<T>(string name) => _database.GetCollection<T>(name);

    public IMongoCollection<BsonDocument> Counters => _database.GetCollection<BsonDocument>(Settings.CountersCollection);

    public async Task<bool> PingAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await _database.RunCommandAsync<BsonDocument>(
                new BsonDocument("ping", 1),
                cancellationToken: cancellationToken);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task EnsureIndexesAsync(CancellationToken cancellationToken = default)
    {
        var users = GetCollection<BsonDocument>(Settings.UsersCollection);

        // L'unicité doit porter sur l'email normalisé (minuscules) pour bloquer
        // les doublons même avec des casse différentes ou en cas de requêtes concurrentes.
        await users.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("emailNormalized"),
                new CreateIndexOptions { Unique = true, Name = "ux_users_email_normalized" }),
            cancellationToken: cancellationToken);

        // Nettoyage d'un éventuel index unique hérité sur "email" (casse exacte).
        var legacy = await users.Indexes.ListAsync(cancellationToken: cancellationToken);
        var legacyNames = await legacy.ToListAsync(cancellationToken);
        if (legacyNames.Any(index => index["name"] == "ux_users_email"))
        {
            await users.Indexes.DropOneAsync("ux_users_email", cancellationToken);
        }

        await users.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("googleId"),
                new CreateIndexOptions { Unique = true, Sparse = true, Name = "ux_users_googleId" }),
            cancellationToken: cancellationToken);

        // Index sur le propriétaire des projets : accélère la liste filtrée par ownerId.
        var projects = GetCollection<BsonDocument>(Settings.ProjectsCollection);
        await projects.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("ownerId"),
                new CreateIndexOptions { Name = "ix_projects_ownerId" }),
            cancellationToken: cancellationToken);

        // Index sur le freelance approuvé : accélère la liste des projets qui me sont confiés.
        await projects.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("assignedTo"),
                new CreateIndexOptions { Name = "ix_projects_assignedTo" }),
            cancellationToken: cancellationToken);

        // Index sur le statut + date de création : filtre et tri du catalogue public.
        await projects.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("status").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_projects_status_createdAt" }),
            cancellationToken: cancellationToken);

        // Index sur le propriétaire des services : accélère la liste "mes services".
        var services = GetCollection<BsonDocument>(Settings.ServicesCollection);
        await services.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("ownerId"),
                new CreateIndexOptions { Name = "ix_services_ownerId" }),
            cancellationToken: cancellationToken);

        // Index sur le statut + date de création : filtre et tri du catalogue public.
        await services.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("status").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_services_status_createdAt" }),
            cancellationToken: cancellationToken);

        // Candidatures : un couple (projet, freelance) ne peut être candidat
        // qu'une seule fois. L'index unique fait autorité en cas de requêtes
        // concurrentes, le contrôle applicatif renvoyant le même 409.
        var proposals = GetCollection<BsonDocument>(Settings.ProposalsCollection);
        await proposals.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("projectId").Ascending("freelancerId"),
                new CreateIndexOptions { Unique = true, Name = "ux_proposals_projectId_freelancerId" }),
            cancellationToken: cancellationToken);

        // Candidatures d'un projet donné : tri et comptage côté client.
        await proposals.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("projectId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_proposals_projectId_createdAt" }),
            cancellationToken: cancellationToken);

        // Candidatures reçues par un client : filtrées par le propriétaire du projet.
        await proposals.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("projectOwnerId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_proposals_projectOwnerId_createdAt" }),
            cancellationToken: cancellationToken);

        // Candidatures déposées par un freelance, avec leur statut.
        await proposals.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("freelancerId").Ascending("status"),
                new CreateIndexOptions { Name = "ix_proposals_freelancerId_status" }),
            cancellationToken: cancellationToken);

        // Feedbacks : évaluation bidirectionnelle. Une migration non destructive
        // renseigne les champs ajoutés sur les avis historiques (client ->
        // freelancer), puis l'ancien index unique (clientId, projectId) est
        // remplacé par (projectId, authorId) : un avis par participant et par
        // projet, sans supprimer aucun document.
        var feedbacks = GetCollection<BsonDocument>(Settings.FeedbackCollection);

        var legacyFeedbacks = await feedbacks
            .Find(new BsonDocument("authorId", new BsonDocument("$exists", false)))
            .ToListAsync(cancellationToken);

        foreach (var legacyFeedback in legacyFeedbacks)
        {
            var id = legacyFeedback.GetValue("_id", BsonNull.Value);
            if (id.IsBsonNull)
            {
                continue;
            }

            var clientId = legacyFeedback.GetValue("clientId", BsonNull.Value);
            var freelancerId = legacyFeedback.GetValue("freelancerId", BsonNull.Value);
            var clientName = legacyFeedback.GetValue("clientName", new BsonString(string.Empty));
            var freelancerName = legacyFeedback.GetValue("freelancerName", new BsonString(string.Empty));
            var rating = legacyFeedback.GetValue("rating", new BsonInt32(0));
            var createdAt = legacyFeedback.Contains("createdAt") && legacyFeedback["createdAt"].IsValidDateTime
                ? legacyFeedback["createdAt"].ToUniversalTime()
                : DateTime.UtcNow;

            // Un document historique sans clientId reste préservé : authorId
            // reçoit son propre _id pour ne pas violer l'index d'unicité.
            var authorId = clientId.IsBsonNull ? id : clientId;
            var recipientId = !freelancerId.IsBsonNull
                ? freelancerId
                : (!clientId.IsBsonNull ? clientId : id);
            var authorName = clientName.IsString ? clientName.AsString : string.Empty;
            var recipientName = freelancerName.IsString ? freelancerName.AsString : string.Empty;

            var set = new BsonDocument
            {
                { "authorId", authorId },
                { "authorName", authorName },
                { "authorRole", "client" },
                { "recipientId", recipientId },
                { "recipientName", recipientName },
                { "recipientRole", "freelancer" },
                { "direction", "client_to_freelancer" },
                { "status", "published" },
                { "averageRating", rating.IsNumeric ? rating.ToDouble() : 0d },
                { "criteria", new BsonDocument() },
                { "strengths", string.Empty },
                { "improvements", string.Empty },
                { "recommend", BsonNull.Value },
                { "submittedAt", createdAt },
                { "publishedAt", createdAt },
                { "completedAt", createdAt },
                { "dueAt", createdAt.AddDays(14) },
                { "requestNotifiedAt", createdAt },
                { "reminderNotifiedAt", createdAt },
                { "updatedAt", createdAt },
            };

            await feedbacks.UpdateOneAsync(
                new BsonDocument("_id", id),
                new BsonDocument("$set", set),
                cancellationToken: cancellationToken);
        }

        var feedbackIndexes = await feedbacks.Indexes.ListAsync(cancellationToken: cancellationToken);
        var feedbackIndexNames = await feedbackIndexes.ToListAsync(cancellationToken);
        if (feedbackIndexNames.Any(index => index["name"] == "ux_feedbacks_clientId_projectId"))
        {
            await feedbacks.Indexes.DropOneAsync("ux_feedbacks_clientId_projectId", cancellationToken);
        }

        await feedbacks.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("projectId").Ascending("authorId"),
                new CreateIndexOptions { Unique = true, Name = "ux_feedbacks_projectId_authorId" }),
            cancellationToken: cancellationToken);

        await feedbacks.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("recipientId").Ascending("status").Descending("publishedAt"),
                new CreateIndexOptions { Name = "ix_feedbacks_recipientId_status_publishedAt" }),
            cancellationToken: cancellationToken);

        await feedbacks.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("status").Ascending("dueAt"),
                new CreateIndexOptions { Name = "ix_feedbacks_status_dueAt" }),
            cancellationToken: cancellationToken);

        await feedbacks.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("freelancerId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_feedbacks_freelancerId_createdAt" }),
            cancellationToken: cancellationToken);

        await feedbacks.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("clientId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_feedbacks_clientId_createdAt" }),
            cancellationToken: cancellationToken);


        // Commentaires : discussion d'un projet, tri chronologique.
        var comments = GetCollection<BsonDocument>(Settings.CommentsCollection);
        await comments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("projectId").Ascending("createdAt"),
                new CreateIndexOptions { Name = "ix_comments_projectId_createdAt" }),
            cancellationToken: cancellationToken);

        // Portfolio : liste "mes réalisations" triée par dernière modification.
        var portfolio = GetCollection<BsonDocument>(Settings.PortfolioCollection);
        await portfolio.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("ownerId").Descending("updatedAt"),
                new CreateIndexOptions { Name = "ix_portfolio_ownerId_updatedAt" }),
            cancellationToken: cancellationToken);

        // Portfolio public : filtre propriétaire + publication + visibilité.
        await portfolio.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys
                    .Ascending("ownerId")
                    .Ascending("published")
                    .Ascending("visibility"),
                new CreateIndexOptions { Name = "ix_portfolio_ownerId_published_visibility" }),
            cancellationToken: cancellationToken);

        // --- Module Account Settings ---------------------------------------
        var team = GetCollection<BsonDocument>(Settings.TeamMembersCollection);
        await team.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("ownerId").Ascending("emailNormalized"),
                new CreateIndexOptions { Name = "ix_team_owner_email" }),
            cancellationToken: cancellationToken);
        await team.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("inviteTokenHash"),
                new CreateIndexOptions { Name = "ix_team_inviteTokenHash" }),
            cancellationToken: cancellationToken);

        // Un seul document de facturation / préférences par compte.
        await GetCollection<BsonDocument>(Settings.BillingProfilesCollection).Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("userId"),
                new CreateIndexOptions { Unique = true, Name = "ux_billing_userId" }),
            cancellationToken: cancellationToken);

        await GetCollection<BsonDocument>(Settings.UserPreferencesCollection).Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("userId"),
                new CreateIndexOptions { Unique = true, Name = "ux_preferences_userId" }),
            cancellationToken: cancellationToken);

        await GetCollection<BsonDocument>(Settings.NotificationPreferencesCollection).Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("userId"),
                new CreateIndexOptions { Unique = true, Name = "ux_notificationPreferences_userId" }),
            cancellationToken: cancellationToken);

        // Sessions : le hash du jeton est unique, et la liste par utilisateur est indexée.
        var authSessions = GetCollection<BsonDocument>(Settings.AuthSessionsCollection);
        await authSessions.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("tokenHash"),
                new CreateIndexOptions { Unique = true, Name = "ux_authSessions_tokenHash" }),
            cancellationToken: cancellationToken);
        await authSessions.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("userId").Descending("lastSeenAt"),
                new CreateIndexOptions { Name = "ix_authSessions_userId_lastSeenAt" }),
            cancellationToken: cancellationToken);

        await GetCollection<BsonDocument>(Settings.AccountChangesCollection).Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("userId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_accountChanges_userId_createdAt" }),
            cancellationToken: cancellationToken);

        // --- Devis, factures et moteur de paiement -------------------------
        var invoices = GetCollection<BsonDocument>(Settings.InvoicesCollection);
        await invoices.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("clientId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_invoices_clientId_createdAt" }),
            cancellationToken: cancellationToken);
        await invoices.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("ownerId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_invoices_ownerId_createdAt" }),
            cancellationToken: cancellationToken);

        var quotes = GetCollection<BsonDocument>(Settings.QuotesCollection);
        await quotes.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("clientId").Ascending("status"),
                new CreateIndexOptions { Name = "ix_quotes_clientId_status" }),
            cancellationToken: cancellationToken);
        await quotes.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("ownerId").Ascending("status"),
                new CreateIndexOptions { Name = "ix_quotes_ownerId_status" }),
            cancellationToken: cancellationToken);

        var payments = GetCollection<BsonDocument>(Settings.PaymentsCollection);
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("reference"),
                new CreateIndexOptions { Unique = true, Name = "ux_payments_reference" }),
            cancellationToken: cancellationToken);
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("idempotencyKey"),
                new CreateIndexOptions { Unique = true, Sparse = true, Name = "ux_payments_idempotencyKey" }),
            cancellationToken: cancellationToken);
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("providerPaymentRef"),
                new CreateIndexOptions { Unique = true, Sparse = true, Name = "ux_payments_providerPaymentRef" }),
            cancellationToken: cancellationToken);
        // Identité d'un transfert blockchain = (empreinte Genesis, hash
        // normalisé). Sur une même instance, un hash ne peut créditer qu'un
        // seul paiement ; sur deux instances Hardhat distinctes, le même hash
        // désigne deux transferts différents.
        //
        // L'ancien index unique « ux_payments_blockchainTxHash » n'est
        // volontairement ni créé ni supprimé ici : sa suppression est une
        // opération de migration contrôlée, exécutée seulement après l'audit
        // des collisions de casse. Tant qu'il existe, il bloque aussi les
        // crédits cross-genesis : la vérification échoue alors en mode fermé
        // (aucun double crédit), jamais en créditant à tort.
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys
                    .Ascending("blockchainGenesisHash")
                    .Ascending("blockchainTxHash"),
                new CreateIndexOptions<BsonDocument>
                {
                    Unique = true,
                    Name = "ux_payments_genesis_txHash",
                    // Les documents sans hash ne participent pas à l'unicité.
                    // Un document dont blockchainGenesisHash est absent est
                    // indexé avec la valeur null : deux paiements historiques
                    // (genesis inconnu) portant le même hash restent donc
                    // bloqués entre eux.
                    PartialFilterExpression = Builders<BsonDocument>.Filter
                        .Type("blockchainTxHash", BsonType.String),
                }),
            cancellationToken: cancellationToken);
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("blockchainTxHash"),
                new CreateIndexOptions { Name = "ix_payments_blockchainTxHash" }),
            cancellationToken: cancellationToken);
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("invoiceId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_payments_invoiceId_createdAt" }),
            cancellationToken: cancellationToken);
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("clientId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_payments_clientId_createdAt" }),
            cancellationToken: cancellationToken);
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("freelancerId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_payments_freelancerId_createdAt" }),
            cancellationToken: cancellationToken);
        await payments.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("status").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_payments_status_createdAt" }),
            cancellationToken: cancellationToken);

        // Journal d'audit blockchain : append-only, idempotent par clé.
        var audits = GetCollection<BsonDocument>(Settings.PaymentAuditsCollection);
        await audits.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("dedupeKey"),
                new CreateIndexOptions { Unique = true, Name = "ux_paymentAudits_dedupeKey" }),
            cancellationToken: cancellationToken);
        await audits.Indexes.CreateOneAsync(
            new CreateIndexModel<BsonDocument>(
                Builders<BsonDocument>.IndexKeys.Ascending("paymentId").Descending("createdAt"),
                new CreateIndexOptions { Name = "ix_paymentAudits_paymentId_createdAt" }),
            cancellationToken: cancellationToken);
    }
}
