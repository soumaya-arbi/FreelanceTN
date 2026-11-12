using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Feedbacks;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using MongoDB.Bson;
using MongoDB.Driver;

// Le modèle « Task » du module Tasks entre en conflit avec l'asynchrone :
// l'alias garde « Task » pour System.Threading.Tasks.
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Tests;

/// <summary>
/// Tests du module Feedback bidirectionnel : demandes idempotentes, soumission
/// sécurisée par rôle, publication différée (mutuelle ou après 14 jours),
/// réputation calculée sur les seuls avis publiés, notifications dédupliquées
/// et migration non destructive des avis historiques.
///
/// Toutes les données sont écrites dans la base éphémère du <see cref="MongoFixture"/>.
/// </summary>
public class FeedbackWorkflowTests : IClassFixture<MongoFixture>
{
    private const int CriteriaCount = 5;

    private readonly MongoFixture _fixture;

    public FeedbackWorkflowTests(MongoFixture fixture)
    {
        _fixture = fixture;
    }

    private MongoContext Mongo => _fixture.Context;

    private FeedbackService NewService() => new(Mongo, new NotificationService(Mongo));

    private IMongoCollection<Feedback> Feedbacks =>
        Mongo.GetCollection<Feedback>(Mongo.Settings.FeedbackCollection);

    private static SubmitFeedbackRequest Review(string direction, int value = 4, bool? recommend = null)
    {
        var keys = FeedbackCriteria.ForDirection(direction);
        return new SubmitFeedbackRequest
        {
            Criteria = keys.ToDictionary(key => key, _ => value),
            Comment = "Une collaboration claire, un livrable conforme et des échanges réguliers.",
            Strengths = "Communication et respect des délais.",
            Improvements = "Documentation technique à enrichir.",
            Recommend = recommend,
        };
    }

    private static SubmitFeedbackRequest ClientReview(int value = 4) =>
        Review(FeedbackDirection.ClientToFreelancer, value, recommend: true);

    private static SubmitFeedbackRequest FreelancerReview(int value = 5) =>
        Review(FeedbackDirection.FreelancerToClient, value);

    // -----------------------------------------------------------------
    // 1 & 2. Le client et le freelance peuvent évaluer un projet terminé.
    // -----------------------------------------------------------------

    [Fact]
    public async Task Client_EvalueLeFreelancer_SurProjetTermine()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Alice", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Bob", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);

        var feedback = await NewService().SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);

        Assert.Equal(FeedbackStatus.SubmittedHidden, feedback.Status);
        Assert.Equal(FeedbackDirection.ClientToFreelancer, feedback.Direction);
        Assert.Equal(client.Id, feedback.AuthorId);
        Assert.Equal(freelancer.Id, feedback.RecipientId);
        Assert.Equal(4, feedback.Rating);
        Assert.Equal(4, feedback.AverageRating);
        Assert.Equal(CriteriaCount, feedback.Criteria.Count);
        Assert.True(feedback.Recommend);
        Assert.NotNull(feedback.SubmittedAt);

        var stored = await Feedbacks.Find(f => f.ProjectId == project.Id && f.AuthorId == client.Id).SingleAsync();
        Assert.Equal(FeedbackStatus.SubmittedHidden, stored.Status);
    }

    [Fact]
    public async Task Freelancer_EvalueLeClient_SurProjetTermine()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Carla", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "David", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);

        var feedback = await NewService().SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None);

        Assert.Equal(FeedbackStatus.SubmittedHidden, feedback.Status);
        Assert.Equal(FeedbackDirection.FreelancerToClient, feedback.Direction);
        Assert.Equal(freelancer.Id, feedback.AuthorId);
        Assert.Equal(client.Id, feedback.RecipientId);
        Assert.Equal(UserRole.Freelancer, feedback.AuthorRole);
        Assert.Null(feedback.Recommend);
        Assert.Equal(5, feedback.Rating);
    }

    // -----------------------------------------------------------------
    // 3. Un utilisateur extérieur ne peut pas évaluer le projet.
    // -----------------------------------------------------------------

    [Fact]
    public async Task UtilisateurExterieur_NePeutPasEvaluer()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Emma", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Farid", "Freelance");
        var outsider = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Gina", "Externe");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            NewService().SubmitAsync(outsider.Id, project.Id, ClientReview(), CancellationToken.None));

        // Aucun document n'est créé pour l'utilisateur extérieur.
        Assert.Equal(0, await Feedbacks.CountDocumentsAsync(f => f.AuthorId == outsider.Id));
    }

    // -----------------------------------------------------------------
    // 4. Un projet non terminé ne peut pas générer de demande.
    // -----------------------------------------------------------------

    [Fact]
    public async Task ProjetNonTermine_RefuseLaDemande()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Hana", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Ilyes", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.InProgress, freelancer);

        await Assert.ThrowsAsync<ConflictException>(() =>
            NewService().EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None));

        Assert.Equal(0, await Feedbacks.CountDocumentsAsync(f => f.ProjectId == project.Id));
    }

    // -----------------------------------------------------------------
    // 5. Un second avis est refusé et un avis ne peut plus être modifié.
    // -----------------------------------------------------------------

    [Fact]
    public async Task DoubleAvis_Refuse()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Jade", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Karim", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        var service = NewService();

        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);

        await Assert.ThrowsAsync<ConflictException>(() =>
            service.SubmitAsync(client.Id, project.Id, ClientReview(5), CancellationToken.None));

        // L'avis initial est inchangé.
        var stored = await Feedbacks.Find(f => f.ProjectId == project.Id && f.AuthorId == client.Id).SingleAsync();
        Assert.Equal(4, stored.Rating);
        Assert.Equal(1, await Feedbacks.CountDocumentsAsync(f => f.ProjectId == project.Id && f.AuthorId == client.Id));

        // Les endpoints de modification et de suppression renvoient un conflit.
        await Assert.ThrowsAsync<ConflictException>(() =>
            service.UpdateAsync(client.Id, stored.Id, CancellationToken.None));
        await Assert.ThrowsAsync<ConflictException>(() =>
            service.DeleteAsync(client.Id, stored.Id, CancellationToken.None));
    }

    // -----------------------------------------------------------------
    // 6 & 7. L'avis soumis reste masqué pour l'autre participant et son
    // contenu n'est accessible par aucune API publique.
    // -----------------------------------------------------------------

    [Fact]
    public async Task AvisSoumis_MasquePourLAutreParticipant()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Lina", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Mehdi", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        var service = NewService();

        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);

        // Le client voit son propre contenu.
        var mine = await service.ListMineAsync(client.Id, CancellationToken.None);
        var own = Assert.Single(mine, item => item.ProjectId == project.Id);
        Assert.Equal(FeedbackStatus.SubmittedHidden, own.Status);
        Assert.NotEmpty(own.Comment);

        // Le freelance ne voit que sa propre demande, sans le contenu du client.
        var freelancerMine = await service.ListMineAsync(freelancer.Id, CancellationToken.None);
        var request = Assert.Single(freelancerMine, item => item.ProjectId == project.Id);
        Assert.Equal(FeedbackStatus.AwaitingReview, request.Status);
        Assert.Equal(string.Empty, request.Comment);
        Assert.Equal(0, request.Rating);
        Assert.Empty(request.Criteria);
        Assert.Null(request.SubmittedAt);

        // Aucun avis publié n'est exposé sur le profil du freelance.
        var published = await service.ListPublishedForRecipientAsync(freelancer.Id, CancellationToken.None);
        Assert.DoesNotContain(published, item => item.ProjectId == project.Id);

        var summary = await service.GetSummaryAsync(freelancer.Id, CancellationToken.None);
        Assert.Equal(0, summary.Count);
        Assert.Empty(summary.Reviews);
        Assert.Equal(0, summary.AverageRating);
    }

    // -----------------------------------------------------------------
    // 8. Les deux avis sont publiés simultanément.
    // -----------------------------------------------------------------

    [Fact]
    public async Task DeuxAvisSoumis_PublicationSimultanee()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Nadia", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Omar", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        var service = NewService();

        var clientFeedback = await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        Assert.Equal(FeedbackStatus.SubmittedHidden, clientFeedback.Status);

        var freelancerFeedback = await service.SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None);
        Assert.Equal(FeedbackStatus.Published, freelancerFeedback.Status);
        Assert.NotNull(freelancerFeedback.PublishedAt);

        var clientAfter = await Feedbacks.Find(f => f.Id == clientFeedback.Id).SingleAsync();
        Assert.Equal(FeedbackStatus.Published, clientAfter.Status);
        Assert.NotNull(clientAfter.PublishedAt);

        // Les deux avis sont visibles sur les profils respectifs.
        var forFreelancer = await service.ListPublishedForRecipientAsync(freelancer.Id, CancellationToken.None);
        Assert.Contains(forFreelancer, item => item.ProjectId == project.Id && item.AuthorId == client.Id);
        var forClient = await service.ListPublishedForRecipientAsync(client.Id, CancellationToken.None);
        Assert.Contains(forClient, item => item.ProjectId == project.Id && item.AuthorId == freelancer.Id);
    }

    // -----------------------------------------------------------------
    // 9. Un avis soumis est publié après 14 jours même sans réponse.
    // -----------------------------------------------------------------

    [Fact]
    public async Task AvisSoumis_PublieApresQuatorzeJours()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Pia", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Qasim", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        var service = NewService();

        var submitted = await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        Assert.Equal(FeedbackStatus.SubmittedHidden, submitted.Status);

        // Simule l'écoulement des 14 jours : l'échéance est désormais passée.
        var past = DateTime.UtcNow.AddMinutes(-5);
        await Feedbacks.UpdateManyAsync(
            f => f.ProjectId == project.Id,
            Builders<Feedback>.Update.Set(f => f.DueAt, past));

        await service.ProcessPendingAsync(CancellationToken.None);

        var clientAfter = await Feedbacks.Find(f => f.Id == submitted.Id).SingleAsync();
        Assert.Equal(FeedbackStatus.Published, clientAfter.Status);
        Assert.NotNull(clientAfter.PublishedAt);

        // L'autre demande, non soumise, expire sans créer d'avis fictif.
        var freelancerDoc = await Feedbacks.Find(f => f.ProjectId == project.Id && f.AuthorId == freelancer.Id).SingleAsync();
        Assert.Equal(FeedbackStatus.Expired, freelancerDoc.Status);
        Assert.Equal(0, freelancerDoc.Rating);
        Assert.Equal(string.Empty, freelancerDoc.Comment);

        var published = await service.ListPublishedForRecipientAsync(freelancer.Id, CancellationToken.None);
        Assert.Single(published, item => item.ProjectId == project.Id);
    }

    // -----------------------------------------------------------------
    // 10. Aucun avis fictif n'est créé pour un participant absent.
    // -----------------------------------------------------------------

    [Fact]
    public async Task AucunAvisFictif_PourParticipantAbsent()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Rania", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Sami", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        var service = NewService();

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);

        var docs = await Feedbacks.Find(f => f.ProjectId == project.Id).ToListAsync();
        Assert.Equal(2, docs.Count);
        Assert.All(docs, doc =>
        {
            Assert.Equal(FeedbackStatus.AwaitingReview, doc.Status);
            Assert.Equal(0, doc.Rating);
            Assert.Equal(string.Empty, doc.Comment);
            Assert.Null(doc.SubmittedAt);
            Assert.Null(doc.PublishedAt);
        });

        // Après expiration, toujours aucun avis publié.
        await Feedbacks.UpdateManyAsync(
            f => f.ProjectId == project.Id,
            Builders<Feedback>.Update.Set(f => f.DueAt, DateTime.UtcNow.AddMinutes(-1)));
        await service.ProcessPendingAsync(CancellationToken.None);

        Assert.Equal(0, await Feedbacks.CountDocumentsAsync(f => f.ProjectId == project.Id && f.Status == FeedbackStatus.Published));
        var summary = await service.GetSummaryAsync(freelancer.Id, CancellationToken.None);
        Assert.Equal(0, summary.Count);
    }

    // -----------------------------------------------------------------
    // 11. Les moyennes excluent les avis masqués et les demandes non soumises.
    // -----------------------------------------------------------------

    [Fact]
    public async Task Moyennes_ExcluentLesAvisMasques()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Tina", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Ulysse", "Freelance");
        var service = NewService();

        // Projet A : avis publié (les deux participants ont répondu).
        var publishedProject = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        await service.SubmitAsync(client.Id, publishedProject.Id, ClientReview(2), CancellationToken.None);
        await service.SubmitAsync(freelancer.Id, publishedProject.Id, FreelancerReview(4), CancellationToken.None);

        // Projet B : avis du client masqué, le freelance n'a pas répondu.
        var hiddenProject = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        await service.SubmitAsync(client.Id, hiddenProject.Id, ClientReview(5), CancellationToken.None);

        var summary = await service.GetSummaryAsync(freelancer.Id, CancellationToken.None);

        // Seul l'avis publié du projet A compte : note 2, pas de moyenne à 3,5.
        Assert.Equal(1, summary.Count);
        Assert.Equal(2, summary.AverageRating);
        Assert.Equal(1, summary.Distribution.Single(item => item.Stars == 2).Count);
        Assert.Equal(0, summary.Distribution.Single(item => item.Stars == 5).Count);
        Assert.Equal(100, summary.RecommendationRate);
        Assert.Equal(CriteriaCount, summary.CriteriaAverages.Count);
        Assert.All(summary.CriteriaAverages.Values, value => Assert.Equal(2, value));
    }

    // -----------------------------------------------------------------
    // 12. Les notifications ne sont pas dupliquées.
    // -----------------------------------------------------------------

    [Fact]
    public async Task Notifications_NonDupliquees()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Vera", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Wael", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        var service = NewService();

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.EnsureRequestsAsync(project.Id, freelancer.Id, CancellationToken.None);

        var notifications = Mongo.GetCollection<Notification>(Mongo.Settings.NotificationsCollection);
        Assert.Equal(1, await notifications.CountDocumentsAsync(n => n.ProjectId == project.Id && n.RecipientId == client.Id && n.Type == "feedback-request"));
        Assert.Equal(1, await notifications.CountDocumentsAsync(n => n.ProjectId == project.Id && n.RecipientId == freelancer.Id && n.Type == "feedback-request"));

        // Publication : une seule notification par participant.
        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        await service.SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None);
        await service.ProcessPendingAsync(CancellationToken.None);
        await service.ProcessPendingAsync(CancellationToken.None);

        Assert.Equal(1, await notifications.CountDocumentsAsync(n => n.ProjectId == project.Id && n.RecipientId == client.Id && n.Type == "feedback-published"));
        Assert.Equal(1, await notifications.CountDocumentsAsync(n => n.ProjectId == project.Id && n.RecipientId == freelancer.Id && n.Type == "feedback-published"));
    }

    // -----------------------------------------------------------------
    // 13. Deux soumissions concurrentes ne produisent qu'une publication.
    // -----------------------------------------------------------------

    [Fact]
    public async Task SoumissionsConcurrentes_UneSeulePublication()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Xena", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Yanis", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        var service = NewService();

        var results = await Task.WhenAll(
            service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None),
            service.SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None));

        // Une réponse peut observer son propre avis encore masqué si l'autre
        // soumission n'était pas encore enregistrée à cet instant précis ;
        // l'état final, lui, doit être publié pour les deux.
        Assert.All(
            results,
            item => Assert.Contains(item.Status, new[] { FeedbackStatus.Published, FeedbackStatus.SubmittedHidden }));

        var docs = await Feedbacks.Find(f => f.ProjectId == project.Id).ToListAsync();
        Assert.Equal(2, docs.Count);
        Assert.All(docs, doc => Assert.Equal(FeedbackStatus.Published, doc.Status));

        var notifications = Mongo.GetCollection<Notification>(Mongo.Settings.NotificationsCollection);
        Assert.Equal(
            2,
            await notifications.CountDocumentsAsync(n => n.ProjectId == project.Id && n.Type == "feedback-published"));
    }

    // -----------------------------------------------------------------
    // 14. Un profil sans avis publié renvoie des statistiques vides.
    // -----------------------------------------------------------------

    [Fact]
    public async Task ProfilSansAvis_StatistiquesVides()
    {
        var user = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Zoe", "Nouvelle");

        var summary = await NewService().GetSummaryAsync(user.Id, CancellationToken.None);

        Assert.Equal(user.Id, summary.UserId);
        Assert.Equal(0, summary.Count);
        Assert.Equal(0, summary.AverageRating);
        Assert.Empty(summary.Reviews);
        Assert.Null(summary.RecommendationRate);
        Assert.Equal(0, summary.CriteriaReviewCount);
        Assert.Equal(5, summary.Distribution.Count);
        Assert.All(summary.Distribution, item => Assert.Equal(0, item.Count));
        Assert.Empty(summary.CriteriaAverages);
    }

    // -----------------------------------------------------------------
    // Migration : un avis historique est préservé et complété.
    // -----------------------------------------------------------------

    [Fact]
    public async Task Migration_PreserveLesAvisHistoriques()
    {
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Ancien", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Ancien", "Freelance");
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        var legacyId = ObjectId.GenerateNewId().ToString();
        var createdAt = DateTime.UtcNow.AddDays(-40);

        // Document au format de l'ancien module : aucun champ bidirectionnel.
        var legacy = new BsonDocument
        {
            { "_id", ObjectId.Parse(legacyId) },
            { "projectId", ObjectId.Parse(project.Id) },
            { "projectTitle", project.Title },
            { "clientId", ObjectId.Parse(client.Id) },
            { "clientName", "Ancien Client" },
            { "freelancerId", ObjectId.Parse(freelancer.Id) },
            { "freelancerName", "Ancien Freelance" },
            { "rating", 4 },
            { "comment", "Avis historique conservé." },
            { "createdAt", createdAt },
            { "updatedAt", createdAt },
        };
        await Mongo.GetCollection<BsonDocument>(Mongo.Settings.FeedbackCollection).InsertOneAsync(legacy);

        // L'ancien index unique existait en production.
        var raw = Mongo.GetCollection<BsonDocument>(Mongo.Settings.FeedbackCollection);
        await raw.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(
            Builders<BsonDocument>.IndexKeys.Ascending("clientId").Ascending("projectId"),
            new CreateIndexOptions { Unique = true, Name = "ux_feedbacks_clientId_projectId" }));

        await Mongo.EnsureIndexesAsync(CancellationToken.None);

        // Le document est conservé, complété, et reste publié.
        var migrated = await raw.Find(new BsonDocument("_id", ObjectId.Parse(legacyId))).SingleAsync();
        Assert.Equal("Avis historique conservé.", migrated["comment"].AsString);
        Assert.Equal(4, migrated["rating"].AsInt32);
        Assert.Equal(client.Id, migrated["authorId"].AsObjectId.ToString());
        Assert.Equal("client", migrated["authorRole"].AsString);
        Assert.Equal(freelancer.Id, migrated["recipientId"].AsObjectId.ToString());
        Assert.Equal("client_to_freelancer", migrated["direction"].AsString);
        Assert.Equal(FeedbackStatus.Published, migrated["status"].AsString);
        Assert.Equal(4d, migrated["averageRating"].AsDouble);

        // L'index d'unicité est désormais (projectId, authorId).
        var indexes = await (await raw.Indexes.ListAsync()).ToListAsync();
        Assert.DoesNotContain(indexes, index => index["name"] == "ux_feedbacks_clientId_projectId");
        Assert.Contains(indexes, index => index["name"] == "ux_feedbacks_projectId_authorId");

        // L'avis migré alimente la réputation du freelance.
        var summary = await NewService().GetSummaryAsync(freelancer.Id, CancellationToken.None);
        Assert.Equal(1, summary.Count);
        Assert.Equal(4, summary.AverageRating);

        // Une seconde exécution de la migration est sans effet (idempotente).
        await Mongo.EnsureIndexesAsync(CancellationToken.None);
        Assert.Equal(1, await raw.CountDocumentsAsync(new BsonDocument("_id", ObjectId.Parse(legacyId))));
    }
}
