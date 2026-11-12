using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Feedbacks;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;

// Le modèle « Task » du module Tasks entre en conflit avec l'asynchrone.
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Tests;

/// <summary>
/// Tests du traitement planifié du module Feedback : publication automatique à
/// J+14 sans lecture utilisateur, expiration, absence de publication
/// prématurée, notifications individuelles idempotentes, reprise après échec
/// d'envoi, exécutions répétées, concurrence et reprise après redémarrage.
///
/// L'horloge est contrôlée : aucun test n'attend réellement 14 jours. Toutes les
/// données vivent dans la base éphémère du <see cref="MongoFixture"/>.
/// </summary>
public class FeedbackSchedulerTests : IClassFixture<MongoFixture>
{
    private static readonly DateTimeOffset Start = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private readonly MongoFixture _fixture;

    public FeedbackSchedulerTests(MongoFixture fixture)
    {
        _fixture = fixture;
    }

    private MongoContext Mongo => _fixture.Context;

    private IMongoCollection<Feedback> Feedbacks =>
        Mongo.GetCollection<Feedback>(Mongo.Settings.FeedbackCollection);

    private IMongoCollection<Notification> Notifications =>
        Mongo.GetCollection<Notification>(Mongo.Settings.NotificationsCollection);

    private FeedbackService NewService(TimeProvider clock, NotificationService? notifications = null) =>
        new(Mongo, notifications ?? new NotificationService(Mongo), clock);

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

    private async Task<Project> InsertCompletedProjectAsync(
        User client,
        User freelancer,
        DateTimeOffset completedAt)
    {
        var project = await TestData.InsertProjectAsync(Mongo, client, ProjectStatus.Completed, freelancer);
        await Mongo.GetCollection<Project>(Mongo.Settings.ProjectsCollection).UpdateOneAsync(
            p => p.Id == project.Id,
            Builders<Project>.Update.Set(p => p.UpdatedAt, completedAt.UtcDateTime));
        return project;
    }

    private async Task<Feedback> GetFeedbackAsync(string projectId, string authorId) =>
        await Feedbacks.Find(f => f.ProjectId == projectId && f.AuthorId == authorId).SingleAsync();

    private async Task<long> CountNotificationsAsync(string projectId, string recipientId, string type) =>
        await Notifications.CountDocumentsAsync(
            n => n.ProjectId == projectId && n.RecipientId == recipientId && n.Type == type);

    private async Task<BsonDocument> GetProjectDocumentAsync(string projectId) =>
        await Mongo.GetCollection<BsonDocument>(Mongo.Settings.ProjectsCollection)
            .Find(new BsonDocument("_id", ObjectId.Parse(projectId)))
            .SingleAsync();

    // -----------------------------------------------------------------
    // 1. Publication automatique à J+14 sans aucune lecture utilisateur.
    // -----------------------------------------------------------------

    [Fact]
    public async Task PublicationAutomatique_ApresQuatorzeJours_SansLectureUtilisateur()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Auto", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Auto", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var service = NewService(clock);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        var submitted = await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        Assert.Equal(FeedbackStatus.SubmittedHidden, submitted.Status);

        // Le worker avance l'horloge et exécute un cycle, sans que personne ne
        // consulte /mine ni un profil.
        clock.Advance(TimeSpan.FromDays(14).Add(TimeSpan.FromMinutes(1)));
        var result = await service.ProcessPendingAsync(CancellationToken.None);

        Assert.Equal(1, result.Published);
        Assert.Equal(1, result.Expired);

        var clientDoc = await GetFeedbackAsync(project.Id, client.Id);
        Assert.Equal(FeedbackStatus.Published, clientDoc.Status);
        Assert.NotNull(clientDoc.PublishedAt);

        // Le participant qui n'a pas répondu expire : aucun avis fictif.
        var freelancerDoc = await GetFeedbackAsync(project.Id, freelancer.Id);
        Assert.Equal(FeedbackStatus.Expired, freelancerDoc.Status);
        Assert.Equal(0, freelancerDoc.Rating);
        Assert.Equal(string.Empty, freelancerDoc.Comment);
        Assert.Null(freelancerDoc.SubmittedAt);

        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-published"));
    }

    // -----------------------------------------------------------------
    // 2. Expiration automatique des demandes non soumises.
    // -----------------------------------------------------------------

    [Fact]
    public async Task DemandesNonSoumises_ExpirentAutomatiquement()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Expire", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Expire", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var service = NewService(clock);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        clock.Advance(TimeSpan.FromDays(15));
        var result = await service.ProcessPendingAsync(CancellationToken.None);

        Assert.Equal(0, result.Published);
        Assert.Equal(2, result.Expired);

        var docs = await Feedbacks.Find(f => f.ProjectId == project.Id).ToListAsync();
        Assert.Equal(2, docs.Count);
        Assert.All(docs, doc =>
        {
            Assert.Equal(FeedbackStatus.Expired, doc.Status);
            Assert.Equal(0, doc.Rating);
            Assert.Equal(string.Empty, doc.Comment);
            Assert.Null(doc.SubmittedAt);
        });

        Assert.Equal(0, await Feedbacks.CountDocumentsAsync(f => f.ProjectId == project.Id && f.Status == FeedbackStatus.Published));
        Assert.Equal(0, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
    }

    // -----------------------------------------------------------------
    // 3. Publication mutuelle immédiate avant J+14.
    // -----------------------------------------------------------------

    [Fact]
    public async Task DeuxAvisSoumis_PublicationMutuelleImmediate()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Mutuel", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Mutuel", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var service = NewService(clock);

        clock.Advance(TimeSpan.FromHours(2));
        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        var second = await service.SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None);

        Assert.Equal(FeedbackStatus.Published, second.Status);
        var docs = await Feedbacks.Find(f => f.ProjectId == project.Id).ToListAsync();
        Assert.All(docs, doc =>
        {
            Assert.Equal(FeedbackStatus.Published, doc.Status);
            Assert.NotNull(doc.PublishedAt);
        });

        // Aucun avis ne reste masqué : le cycle suivant ne publie rien de plus.
        var result = await service.ProcessPendingAsync(CancellationToken.None);
        Assert.Equal(0, result.Published);
        Assert.Equal(0, result.Expired);
    }

    // -----------------------------------------------------------------
    // 4. Aucune publication prématurée avant J+14.
    // -----------------------------------------------------------------

    [Fact]
    public async Task AvisUnique_ResteMasqueJusquALEcheance()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Patient", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Patient", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var service = NewService(clock);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);

        clock.Advance(TimeSpan.FromDays(13));
        await service.ProcessPendingAsync(CancellationToken.None);
        Assert.Equal(FeedbackStatus.SubmittedHidden, (await GetFeedbackAsync(project.Id, client.Id)).Status);

        clock.Advance(TimeSpan.FromHours(23));
        await service.ProcessPendingAsync(CancellationToken.None);
        Assert.Equal(FeedbackStatus.SubmittedHidden, (await GetFeedbackAsync(project.Id, client.Id)).Status);

        clock.Advance(TimeSpan.FromHours(2));
        await service.ProcessPendingAsync(CancellationToken.None);
        Assert.Equal(FeedbackStatus.Published, (await GetFeedbackAsync(project.Id, client.Id)).Status);
    }

    // -----------------------------------------------------------------
    // 5. Aucun avis fictif pour le participant absent.
    // -----------------------------------------------------------------

    [Fact]
    public async Task AucunAvisFictif_PourParticipantAbsent()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Absent", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Absent", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var service = NewService(clock);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        clock.Advance(TimeSpan.FromDays(30));
        await service.ProcessPendingAsync(CancellationToken.None);

        Assert.Equal(0, await Feedbacks.CountDocumentsAsync(f => f.ProjectId == project.Id && f.Status == FeedbackStatus.Published));
        var summary = await service.GetSummaryAsync(freelancer.Id, CancellationToken.None);
        Assert.Equal(0, summary.Count);
        Assert.Empty(summary.Reviews);
    }

    // -----------------------------------------------------------------
    // 6. Notifications individuelles, sans doublon, même après répétitions.
    // -----------------------------------------------------------------

    [Fact]
    public async Task Notifications_IndividuellesEtSansDoublon()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Notif", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Notif", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var service = NewService(clock);

        // Demandes : une par participant, même après deux créations.
        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-request"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-request"));

        // Rappels : un par participant n'ayant pas répondu, jamais dupliqué.
        clock.Advance(TimeSpan.FromDays(8));
        await service.ProcessPendingAsync(CancellationToken.None);
        await service.ProcessPendingAsync(CancellationToken.None);
        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-reminder"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-reminder"));

        // Publication : une par participant, même après plusieurs cycles.
        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        await service.SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None);
        await service.ProcessPendingAsync(CancellationToken.None);
        await service.ProcessPendingAsync(CancellationToken.None);

        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-published"));
    }

    // -----------------------------------------------------------------
    // 7. Reprise après échec d'envoi d'une notification.
    // -----------------------------------------------------------------

    [Fact]
    public async Task EchecNotificationPublication_RepriseAuCycleSuivantSansBloquerLAutre()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Retry", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Retry", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        // Deux échecs : le premier envoi, puis la reprise immédiate effectuée par
        // le filet de sécurité de la soumission. Le cycle suivant doit réussir.
        var notifications = new FlakyNotificationService(Mongo, freelancer.Id, "feedback-published", failures: 2);
        var service = NewService(clock, notifications);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        await service.SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None);

        // L'échec pour le freelancer ne bloque pas le client.
        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
        Assert.Equal(0, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-published"));

        var projectDoc = await GetProjectDocumentAsync(project.Id);
        Assert.False(projectDoc["feedbackPublicationNotifiedClientAt"].IsBsonNull);
        Assert.True(projectDoc.GetValue("feedbackPublicationNotifiedFreelancerAt", BsonNull.Value).IsBsonNull);

        // Le cycle suivant reprend uniquement l'envoi manquant.
        await service.ProcessPendingAsync(CancellationToken.None);
        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-published"));

        projectDoc = await GetProjectDocumentAsync(project.Id);
        Assert.False(projectDoc["feedbackPublicationNotifiedFreelancerAt"].IsBsonNull);
    }

    [Fact]
    public async Task EchecNotificationDemande_RepriseAuCycleSuivant()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "RetryRequest", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "RetryRequest", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var notifications = new FlakyNotificationService(Mongo, client.Id, "feedback-request", failures: 1);
        var service = NewService(clock, notifications);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);

        Assert.Equal(0, await CountNotificationsAsync(project.Id, client.Id, "feedback-request"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-request"));
        Assert.Null((await GetFeedbackAsync(project.Id, client.Id)).RequestNotifiedAt);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);

        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-request"));
        Assert.NotNull((await GetFeedbackAsync(project.Id, client.Id)).RequestNotifiedAt);
    }

    // -----------------------------------------------------------------
    // 8. Exécutions répétées sans effet secondaire.
    // -----------------------------------------------------------------

    [Fact]
    public async Task ExecutionsRepetees_SansEffetSecondaire()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Repeat", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Repeat", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var service = NewService(clock);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        await service.SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None);

        var before = await Feedbacks.Find(f => f.ProjectId == project.Id).ToListAsync();
        var publishedAt = before.ToDictionary(doc => doc.Id, doc => doc.PublishedAt);

        for (var index = 0; index < 3; index++)
        {
            var result = await service.ProcessPendingAsync(CancellationToken.None);
            Assert.Equal(0, result.Published);
            Assert.Equal(0, result.Expired);
        }

        var after = await Feedbacks.Find(f => f.ProjectId == project.Id).ToListAsync();
        Assert.All(after, doc =>
        {
            Assert.Equal(FeedbackStatus.Published, doc.Status);
            Assert.Equal(publishedAt[doc.Id], doc.PublishedAt);
        });

        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-published"));
    }

    // -----------------------------------------------------------------
    // 9. Exécutions concurrentes sans double publication ni doublon.
    // -----------------------------------------------------------------

    [Fact]
    public async Task ExecutionsConcurrentes_UneSeulePublication()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Concurrent", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Concurrent", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var first = NewService(clock);
        var second = NewService(clock);

        await first.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await first.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);

        clock.Advance(TimeSpan.FromDays(15));
        await Task.WhenAll(
            first.ProcessPendingAsync(CancellationToken.None),
            second.ProcessPendingAsync(CancellationToken.None));

        var clientDoc = await GetFeedbackAsync(project.Id, client.Id);
        Assert.Equal(FeedbackStatus.Published, clientDoc.Status);
        Assert.NotNull(clientDoc.PublishedAt);
        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-published"));
    }

    [Fact]
    public async Task ExecutionsConcurrentes_PublicationMutuelleSansDoublon()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "ConcurrentMutual", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "ConcurrentMutual", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);
        var service = NewService(clock);

        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        await service.SubmitAsync(freelancer.Id, project.Id, FreelancerReview(), CancellationToken.None);

        await Task.WhenAll(
            NewService(clock).ProcessPendingAsync(CancellationToken.None),
            NewService(clock).ProcessPendingAsync(CancellationToken.None),
            NewService(clock).ProcessPendingAsync(CancellationToken.None));

        var docs = await Feedbacks.Find(f => f.ProjectId == project.Id).ToListAsync();
        Assert.All(docs, doc => Assert.Equal(FeedbackStatus.Published, doc.Status));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
        Assert.Equal(1, await CountNotificationsAsync(project.Id, freelancer.Id, "feedback-published"));
    }

    // -----------------------------------------------------------------
    // 10. Reprise après redémarrage de l'API (nouvelle instance de service).
    // -----------------------------------------------------------------

    [Fact]
    public async Task RepriseApresRedemarrage_PublieLesEcheancesDepassees()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Restart", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Restart", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);

        var beforeRestart = NewService(clock);
        await beforeRestart.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await beforeRestart.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);

        // L'API « redémarre » : nouvelle instance, mêmes données persistées.
        clock.Advance(TimeSpan.FromDays(14).Add(TimeSpan.FromMinutes(5)));
        var afterRestart = NewService(clock);
        var result = await afterRestart.ProcessPendingAsync(CancellationToken.None);

        Assert.Equal(1, result.Published);
        Assert.Equal(FeedbackStatus.Published, (await GetFeedbackAsync(project.Id, client.Id)).Status);
    }

    // -----------------------------------------------------------------
    // Worker : un cycle publie, et une erreur de cycle ne tue pas le service.
    // -----------------------------------------------------------------

    [Fact]
    public async Task Worker_ExecuteUnCycleEtPublieLesEcheances()
    {
        var clock = new MutableTimeProvider(Start);
        var client = await TestData.InsertUserAsync(Mongo, UserRole.Client, "Worker", "Client");
        var freelancer = await TestData.InsertUserAsync(Mongo, UserRole.Freelancer, "Worker", "Freelance");
        var project = await InsertCompletedProjectAsync(client, freelancer, Start);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(Mongo);
        services.AddSingleton<NotificationService>();
        services.AddSingleton<TimeProvider>(clock);
        services.AddScoped<FeedbackService>();
        using var provider = services.BuildServiceProvider();

        var service = NewService(clock);
        await service.EnsureRequestsAsync(project.Id, client.Id, CancellationToken.None);
        await service.SubmitAsync(client.Id, project.Id, ClientReview(), CancellationToken.None);
        clock.Advance(TimeSpan.FromDays(15));

        var worker = new FeedbackPublicationWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(new FeedbackWorkerSettings { IntervalSeconds = 60, StartupDelaySeconds = 0 }),
            NullLogger<FeedbackPublicationWorker>.Instance);

        await worker.RunCycleAsync(CancellationToken.None);

        Assert.Equal(FeedbackStatus.Published, (await GetFeedbackAsync(project.Id, client.Id)).Status);
        Assert.Equal(1, await CountNotificationsAsync(project.Id, client.Id, "feedback-published"));
    }

    [Fact]
    public async Task Worker_UneErreurDeCycleNInterromptPasLeService()
    {
        var worker = new FeedbackPublicationWorker(
            new ThrowingScopeFactory(),
            Options.Create(new FeedbackWorkerSettings { IntervalSeconds = 60, StartupDelaySeconds = 0 }),
            NullLogger<FeedbackPublicationWorker>.Instance);

        // Ne doit pas lever : l'erreur est journalisée et le cycle suivant réessaiera.
        await worker.RunCycleAsync(CancellationToken.None);
    }

    // -----------------------------------------------------------------
    // Doubles de test
    // -----------------------------------------------------------------

    /// <summary>Horloge avanceable manuellement, sans attente réelle.</summary>
    private sealed class MutableTimeProvider : TimeProvider
    {
        private DateTimeOffset _now;

        public MutableTimeProvider(DateTimeOffset start) => _now = start;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan delta) => _now = _now.Add(delta);
    }

    /// <summary>
    /// NotificationService dont l'envoi échoue un nombre contrôlé de fois pour un
    /// destinataire et un type donnés, afin de vérifier la reprise.
    /// </summary>
    private sealed class FlakyNotificationService : NotificationService
    {
        private readonly string _recipientId;
        private readonly string _type;
        private int _failuresRemaining;

        public FlakyNotificationService(MongoContext mongo, string recipientId, string type, int failures)
            : base(mongo)
        {
            _recipientId = recipientId;
            _type = type;
            _failuresRemaining = failures;
        }

        public override async Task<bool> CreateOnceAsync(
            string id,
            string recipientId,
            string type,
            string title,
            string message,
            string projectId,
            string projectTitle,
            string actorName,
            CancellationToken ct)
        {
            if (recipientId == _recipientId && type == _type && _failuresRemaining > 0)
            {
                _failuresRemaining--;
                return false;
            }

            return await base.CreateOnceAsync(
                id, recipientId, type, title, message, projectId, projectTitle, actorName, ct);
        }
    }

    /// <summary>Fabrique de portée dont la résolution échoue, pour tester le worker.</summary>
    private sealed class ThrowingScopeFactory : IServiceScopeFactory
    {
        public IServiceScope CreateScope() => new ThrowingScope();

        private sealed class ThrowingScope : IServiceScope
        {
            public IServiceProvider ServiceProvider { get; } = new ThrowingProvider();

            public void Dispose()
            {
            }
        }

        private sealed class ThrowingProvider : IServiceProvider
        {
            public object? GetService(Type serviceType) =>
                throw new InvalidOperationException("Simulated failure while resolving the feedback service.");
        }
    }
}
