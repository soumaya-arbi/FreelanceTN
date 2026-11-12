using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Feedbacks;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Module Feedback bidirectionnel.
///
/// Règles principales :
/// - une demande par participant et par projet terminé (index unique) ;
/// - le client évalue le freelancer, le freelancer évalue le client ;
/// - un avis soumis reste masqué jusqu'à ce que les deux aient répondu ou
///   jusqu'à l'expiration du délai de 14 jours suivant la clôture ;
/// - aucun avis fictif n'est créé pour un participant absent ;
/// - seules les évaluations publiées alimentent la réputation publique ;
/// - les notifications sont dédupliquées par des marqueurs atomiques.
/// </summary>
public class FeedbackService
{
    private static readonly TimeSpan PublicationDelay = TimeSpan.FromDays(14);
    private static readonly TimeSpan ReminderDelay = TimeSpan.FromDays(7);

    // Marqueurs posés sur le document projet, un par destinataire : un échec
    // d'envoi à l'un ne bloque jamais l'autre.
    private const string ClientPublicationMarker = "feedbackPublicationNotifiedClientAt";
    private const string FreelancerPublicationMarker = "feedbackPublicationNotifiedFreelancerAt";
    private const string PublicationPendingField = "feedbackPublicationPending";

    private readonly MongoContext _mongo;
    private readonly NotificationService _notifications;
    private readonly TimeProvider _clock;
    private readonly ILogger<FeedbackService> _logger;

    public FeedbackService(
        MongoContext mongo,
        NotificationService notifications,
        TimeProvider? clock = null,
        ILogger<FeedbackService>? logger = null)
    {
        _mongo = mongo;
        _notifications = notifications;
        _clock = clock ?? TimeProvider.System;
        _logger = logger ?? NullLogger<FeedbackService>.Instance;
    }

    /// <summary>
    /// Horloge injectable : les tests peuvent avancer de 14 jours sans attendre.
    /// En production, <see cref="TimeProvider.System"/> est utilisé.
    /// </summary>
    private DateTime Now => _clock.GetUtcNow().UtcDateTime;

    private IMongoCollection<Feedback> Feedbacks => _mongo.GetCollection<Feedback>(_mongo.Settings.FeedbackCollection);
    private IMongoCollection<Project> Projects => _mongo.GetCollection<Project>(_mongo.Settings.ProjectsCollection);
    private IMongoCollection<User> Users => _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);
    private IMongoCollection<BsonDocument> ProjectsRaw => _mongo.GetCollection<BsonDocument>(_mongo.Settings.ProjectsCollection);

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    /// <summary>
    /// Demandes et évaluations de l'utilisateur connecté. L'auteur voit le
    /// contenu de son propre avis, même masqué ; celui de l'autre participant
    /// n'est jamais renvoyé ici.
    /// </summary>
    public async Task<List<FeedbackResponse>> ListMineAsync(string userId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(userId, out _))
        {
            return [];
        }

        await EnsureRequestsForUserAsync(userId, cancellationToken);
        await ProcessPendingAsync(cancellationToken);

        var docs = await Feedbacks
            .Find(f => f.AuthorId == userId)
            .SortByDescending(f => f.UpdatedAt)
            .ToListAsync(cancellationToken);

        return docs
            .Select(d => ToResponse(d, includeContent: d.Status is FeedbackStatus.SubmittedHidden or FeedbackStatus.Published))
            .ToList();
    }

    /// <summary>
    /// Avis publiés reçus par un utilisateur. Seuls les avis publiés sont
    /// renvoyés : les avis masqués et les demandes non soumises sont exclus.
    /// </summary>
    public async Task<List<FeedbackResponse>> ListPublishedForRecipientAsync(string userId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(userId, out _))
        {
            return [];
        }

        await ProcessPendingAsync(cancellationToken);

        var docs = await Feedbacks
            .Find(PublishedForRecipientFilter(userId))
            .SortByDescending(f => f.PublishedAt)
            .ToListAsync(cancellationToken);

        return docs.Select(d => ToResponse(d, includeContent: true)).ToList();
    }

    /// <summary>
    /// Statistiques de réputation calculées exclusivement à partir des avis
    /// publiés reçus. Aucune note n'est inventée pour un profil sans avis.
    /// </summary>
    public async Task<FeedbackSummaryResponse> GetSummaryAsync(string userId, CancellationToken cancellationToken)
    {
        var reviews = await ListPublishedForRecipientAsync(userId, cancellationToken);

        var summary = new FeedbackSummaryResponse
        {
            UserId = userId,
            Count = reviews.Count,
            Reviews = reviews,
        };

        var distribution = new Dictionary<int, int> { [1] = 0, [2] = 0, [3] = 0, [4] = 0, [5] = 0 };
        var criteriaSums = new Dictionary<string, double>();
        var criteriaCounts = new Dictionary<string, int>();
        var recommendationTotal = 0;
        var recommendationPositive = 0;
        double ratingSum = 0;

        foreach (var review in reviews)
        {
            var value = review.AverageRating > 0 ? review.AverageRating : review.Rating;
            if (value > 0)
            {
                ratingSum += value;
                var stars = Math.Clamp((int)Math.Round(value, MidpointRounding.AwayFromZero), 1, 5);
                distribution[stars] = distribution.GetValueOrDefault(stars) + 1;
            }

            foreach (var criterion in review.Criteria)
            {
                criteriaSums[criterion.Key] = criteriaSums.GetValueOrDefault(criterion.Key) + criterion.Value;
                criteriaCounts[criterion.Key] = criteriaCounts.GetValueOrDefault(criterion.Key) + 1;
            }

            if (review.Recommend is not null)
            {
                recommendationTotal++;
                if (review.Recommend.Value)
                {
                    recommendationPositive++;
                }
            }
        }

        summary.AverageRating = reviews.Count == 0 ? 0 : Math.Round(ratingSum / reviews.Count, 2);
        summary.Distribution = new[] { 5, 4, 3, 2, 1 }
            .Select(stars => new FeedbackDistributionItem { Stars = stars, Count = distribution.GetValueOrDefault(stars) })
            .ToList();
        summary.CriteriaAverages = criteriaSums.ToDictionary(
            entry => entry.Key,
            entry => Math.Round(entry.Value / Math.Max(1, criteriaCounts.GetValueOrDefault(entry.Key)), 2));
        summary.CriteriaReviewCount = reviews.Count(review => review.Criteria.Count > 0);
        summary.RecommendationRate = recommendationTotal == 0
            ? null
            : Math.Round(recommendationPositive * 100.0 / recommendationTotal, 1);

        return summary;
    }

    // ---------------------------------------------------------------------
    // Demandes d'évaluation
    // ---------------------------------------------------------------------

    /// <summary>
    /// Crée de façon idempotente les deux demandes d'évaluation d'un projet
    /// réellement terminé. Aucun document n'est créé pour un projet non
    /// terminé ou sans freelance affecté. Un appel répété ne crée pas de
    /// doublon et ne renvoie pas deux fois la notification de demande.
    /// </summary>
    public async Task<List<FeedbackResponse>> EnsureRequestsAsync(
        string projectId,
        string? requesterId,
        CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(projectId, out _))
        {
            throw new NotFoundException("Projet introuvable.");
        }

        var project = await Projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Projet introuvable.");

        if (!string.IsNullOrWhiteSpace(requesterId)
            && requesterId != project.OwnerId
            && requesterId != project.AssignedTo)
        {
            throw new ForbiddenException("Vous ne participez pas à ce projet.");
        }

        if (!string.Equals(project.Status, ProjectStatus.Completed, StringComparison.OrdinalIgnoreCase))
        {
            throw new ConflictException("Une évaluation ne peut être demandée que pour un projet terminé.");
        }

        if (string.IsNullOrWhiteSpace(project.AssignedTo))
        {
            throw new ConflictException("Aucun freelance n'a été affecté à ce projet.");
        }

        var client = await Users.Find(u => u.Id == project.OwnerId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Client introuvable.");
        var freelancer = await Users.Find(u => u.Id == project.AssignedTo).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Freelance introuvable.");

        var completedAt = project.UpdatedAt == default
            ? Now
            : project.UpdatedAt.ToUniversalTime();
        var dueAt = completedAt.Add(PublicationDelay);
        var initialStatus = dueAt <= Now
            ? FeedbackStatus.Expired
            : FeedbackStatus.AwaitingReview;

        var clientRequest = await UpsertRequestAsync(
            project,
            client,
            freelancer,
            client,
            freelancer,
            FeedbackDirection.ClientToFreelancer,
            completedAt,
            dueAt,
            initialStatus,
            cancellationToken);

        var freelancerRequest = await UpsertRequestAsync(
            project,
            client,
            freelancer,
            freelancer,
            client,
            FeedbackDirection.FreelancerToClient,
            completedAt,
            dueAt,
            initialStatus,
            cancellationToken);

        foreach (var request in new[] { clientRequest, freelancerRequest })
        {
            await NotifyRequestOnceAsync(request, cancellationToken);
        }

        return new[] { clientRequest, freelancerRequest }
            .Select(d => ToResponse(d, includeContent: false))
            .ToList();
    }

    /// <summary>
    /// Filet de sécurité : garantit les demandes des projets terminés auxquels
    /// l'utilisateur participe. Utilisé à la lecture de son espace Feedback,
    /// même si le déclenchement à la clôture n'a pas pu être exécuté.
    /// </summary>
    public async System.Threading.Tasks.Task EnsureRequestsForUserAsync(string userId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(userId, out _))
        {
            return;
        }

        var filter = Builders<Project>.Filter.And(
            Builders<Project>.Filter.Eq(p => p.Status, ProjectStatus.Completed),
            Builders<Project>.Filter.Ne(p => p.AssignedTo, null),
            Builders<Project>.Filter.Ne(p => p.AssignedTo, string.Empty),
            Builders<Project>.Filter.Or(
                Builders<Project>.Filter.Eq(p => p.OwnerId, userId),
                Builders<Project>.Filter.Eq(p => p.AssignedTo, userId)));

        var projects = await Projects.Find(filter)
            .SortByDescending(p => p.UpdatedAt)
            .Limit(100)
            .ToListAsync(cancellationToken);

        foreach (var project in projects)
        {
            try
            {
                await EnsureRequestsAsync(project.Id, userId, cancellationToken);
            }
            catch (ConflictException)
            {
                // Projet sans freelance ou incohérent : aucune demande.
            }
            catch (NotFoundException)
            {
                // Compte participant supprimé : aucune demande.
            }
        }
    }

    private async Task<Feedback> UpsertRequestAsync(
        Project project,
        User client,
        User freelancer,
        User author,
        User recipient,
        string direction,
        DateTime completedAt,
        DateTime dueAt,
        string initialStatus,
        CancellationToken cancellationToken)
    {
        var now = Now;
        var authorRole = direction == FeedbackDirection.ClientToFreelancer ? UserRole.Client : UserRole.Freelancer;
        var recipientRole = direction == FeedbackDirection.ClientToFreelancer ? UserRole.Freelancer : UserRole.Client;

        var filter = Builders<Feedback>.Filter.And(
            Builders<Feedback>.Filter.Eq(f => f.ProjectId, project.Id),
            Builders<Feedback>.Filter.Eq(f => f.AuthorId, author.Id));

        var update = Builders<Feedback>.Update
            .SetOnInsert(f => f.Id, ObjectId.GenerateNewId().ToString())
            .SetOnInsert(f => f.ProjectId, project.Id)
            .SetOnInsert(f => f.ProjectTitle, project.Title)
            .SetOnInsert(f => f.ClientId, client.Id)
            .SetOnInsert(f => f.ClientName, DisplayName(client))
            .SetOnInsert(f => f.FreelancerId, freelancer.Id)
            .SetOnInsert(f => f.FreelancerName, DisplayName(freelancer))
            .SetOnInsert(f => f.AuthorId, author.Id)
            .SetOnInsert(f => f.AuthorName, DisplayName(author))
            .SetOnInsert(f => f.AuthorRole, authorRole)
            .SetOnInsert(f => f.RecipientId, recipient.Id)
            .SetOnInsert(f => f.RecipientName, DisplayName(recipient))
            .SetOnInsert(f => f.RecipientRole, recipientRole)
            .SetOnInsert(f => f.Direction, direction)
            .SetOnInsert(f => f.Status, initialStatus)
            .SetOnInsert(f => f.Rating, 0)
            .SetOnInsert(f => f.AverageRating, 0d)
            .SetOnInsert(f => f.Criteria, new Dictionary<string, int>())
            .SetOnInsert(f => f.Comment, string.Empty)
            .SetOnInsert(f => f.Strengths, string.Empty)
            .SetOnInsert(f => f.Improvements, string.Empty)
            .SetOnInsert(f => f.DueAt, dueAt)
            .SetOnInsert(f => f.CompletedAt, completedAt)
            .SetOnInsert(f => f.CreatedAt, now)
            .SetOnInsert(f => f.UpdatedAt, now);

        try
        {
            await Feedbacks.UpdateOneAsync(
                filter,
                update,
                new UpdateOptions { IsUpsert = true },
                cancellationToken);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Deux requêtes concurrentes ont tenté le même upsert : le document
            // existe déjà, la lecture ci-dessous le renvoie.
        }

        return await Feedbacks.Find(filter).FirstAsync(cancellationToken);
    }

    // ---------------------------------------------------------------------
    // Soumission
    // ---------------------------------------------------------------------

    /// <summary>
    /// Soumet l'évaluation de l'utilisateur pour un projet. Le rôle, la
    /// direction et le destinataire sont déduits du projet : aucun identifiant
    /// de droit n'est accepté depuis le client. Un avis ne peut être soumis
    /// qu'une fois et jamais après l'expiration du délai.
    /// </summary>
    public async Task<FeedbackResponse> SubmitAsync(
        string userId,
        string projectId,
        SubmitFeedbackRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureRequestsAsync(projectId, userId, cancellationToken);
        await ProcessPendingAsync(cancellationToken);

        var project = await Projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Projet introuvable.");

        var isClient = project.OwnerId == userId;
        var isFreelancer = project.AssignedTo == userId;
        if (!isClient && !isFreelancer)
        {
            throw new ForbiddenException("Vous ne participez pas à ce projet.");
        }

        var direction = isClient
            ? FeedbackDirection.ClientToFreelancer
            : FeedbackDirection.FreelancerToClient;
        var expectedCriteria = FeedbackCriteria.ForDirection(direction);

        if (request.Criteria is null
            || request.Criteria.Count != expectedCriteria.Length
            || expectedCriteria.Any(key => !request.Criteria.ContainsKey(key))
            || request.Criteria.Keys.Any(key => !expectedCriteria.Contains(key)))
        {
            throw new ConflictException("Les cinq critères obligatoires doivent être renseignés.");
        }

        if (request.Criteria.Values.Any(value => value is < 1 or > 5))
        {
            throw new ConflictException("Chaque critère doit être noté entre 1 et 5.");
        }

        var comment = (request.Comment ?? string.Empty).Trim();
        if (comment.Length == 0)
        {
            throw new ConflictException("Le commentaire général est obligatoire.");
        }

        if (comment.Length > 1000)
        {
            throw new ConflictException("Le commentaire ne peut pas dépasser 1000 caractères.");
        }

        var strengths = (request.Strengths ?? string.Empty).Trim();
        var improvements = (request.Improvements ?? string.Empty).Trim();
        if (strengths.Length > 1000 || improvements.Length > 1000)
        {
            throw new ConflictException("Les points forts et points à améliorer ne peuvent pas dépasser 1000 caractères.");
        }

        bool? recommend = null;
        if (isClient)
        {
            if (request.Recommend is null)
            {
                throw new ConflictException("Indiquez si vous recommandez ce freelancer.");
            }

            recommend = request.Recommend.Value;
        }

        var average = request.Criteria.Values.Average();
        var rating = Math.Clamp((int)Math.Round(average, MidpointRounding.AwayFromZero), 1, 5);
        var criteria = expectedCriteria.ToDictionary(key => key, key => request.Criteria[key]);
        var now = Now;

        var existing = await Feedbacks
            .Find(f => f.ProjectId == projectId && f.AuthorId == userId)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new ConflictException("Aucune demande d'évaluation n'existe pour ce projet.");

        switch (existing.Status)
        {
            case FeedbackStatus.Published:
                throw new ConflictException("Vous avez déjà publié une évaluation pour ce projet.");
            case FeedbackStatus.SubmittedHidden:
                throw new ConflictException("Vous avez déjà soumis une évaluation pour ce projet.");
            case FeedbackStatus.Expired:
                throw new ConflictException("Le délai de 14 jours est dépassé : cette évaluation ne peut plus être soumise.");
        }

        if (existing.DueAt is not null && existing.DueAt <= now)
        {
            await Feedbacks.UpdateOneAsync(
                Builders<Feedback>.Filter.And(
                    Builders<Feedback>.Filter.Eq(f => f.Id, existing.Id),
                    Builders<Feedback>.Filter.Eq(f => f.Status, FeedbackStatus.AwaitingReview)),
                Builders<Feedback>.Update
                    .Set(f => f.Status, FeedbackStatus.Expired)
                    .Set(f => f.UpdatedAt, now),
                cancellationToken: cancellationToken);
            throw new ConflictException("Le délai de 14 jours est dépassé : cette évaluation ne peut plus être soumise.");
        }

        var updated = await Feedbacks.FindOneAndUpdateAsync(
            Builders<Feedback>.Filter.And(
                Builders<Feedback>.Filter.Eq(f => f.Id, existing.Id),
                Builders<Feedback>.Filter.Eq(f => f.Status, FeedbackStatus.AwaitingReview)),
            Builders<Feedback>.Update
                .Set(f => f.AuthorRole, isClient ? UserRole.Client : UserRole.Freelancer)
                .Set(f => f.Direction, direction)
                .Set(f => f.Status, FeedbackStatus.SubmittedHidden)
                .Set(f => f.Rating, rating)
                .Set(f => f.AverageRating, average)
                .Set(f => f.Criteria, criteria)
                .Set(f => f.Comment, comment)
                .Set(f => f.Strengths, strengths)
                .Set(f => f.Improvements, improvements)
                .Set(f => f.Recommend, recommend)
                .Set(f => f.SubmittedAt, now)
                .Set(f => f.UpdatedAt, now),
            new FindOneAndUpdateOptions<Feedback> { ReturnDocument = ReturnDocument.After },
            cancellationToken);

        if (updated is null)
        {
            throw new ConflictException("Vous avez déjà soumis une évaluation pour ce projet.");
        }

        await PublishIfEligibleAsync(projectId, cancellationToken);
        await ProcessPendingAsync(cancellationToken);

        var final = await Feedbacks.Find(f => f.Id == updated.Id).FirstAsync(cancellationToken);
        return ToResponse(final, includeContent: true);
    }

    /// <summary>
    /// Un avis ne peut plus être modifié ni supprimé après soumission.
    /// </summary>
    public System.Threading.Tasks.Task UpdateAsync(string userId, string feedbackId, CancellationToken cancellationToken)
        => throw new ConflictException("Un avis soumis ne peut plus être modifié.");

    /// <summary>
    /// Un avis ne peut plus être supprimé après soumission.
    /// </summary>
    public System.Threading.Tasks.Task DeleteAsync(string userId, string feedbackId, CancellationToken cancellationToken)
        => throw new ConflictException("Un avis soumis ne peut plus être supprimé.");

    // ---------------------------------------------------------------------
    // Publication différée
    // ---------------------------------------------------------------------

    /// <summary>
    /// Traitement idempotent exécuté périodiquement par
    /// <see cref="FeedbackPublicationWorker"/> et conservé comme filet de sécurité
    /// à chaque lecture/soumission : publie les avis arrivés à échéance, publie
    /// les paires complètes, expire les demandes non soumises et envoie les
    /// rappels. Ne publie jamais un avis dont le délai n'est pas écoulé et dont
    /// l'autre participant n'a pas répondu.
    /// </summary>
    public async Task<FeedbackProcessingResult> ProcessPendingAsync(CancellationToken cancellationToken)
    {
        var now = Now;
        var published = 0;

        // 1. Avis soumis dont le délai de publication est écoulé.
        var dueHidden = await Feedbacks
            .Find(Builders<Feedback>.Filter.And(
                Builders<Feedback>.Filter.Eq(f => f.Status, FeedbackStatus.SubmittedHidden),
                Builders<Feedback>.Filter.Ne(f => f.DueAt, null),
                Builders<Feedback>.Filter.Lte(f => f.DueAt, now)))
            .ToListAsync(cancellationToken);

        foreach (var group in dueHidden.GroupBy(f => f.ProjectId))
        {
            published += await PublishIdsAsync(group.Key, group.Select(f => f.Id).ToList(), cancellationToken);
            await NotifyPublicationOnceAsync(group.Key, cancellationToken);
        }

        // 2. Les deux avis sont soumis : publication simultanée.
        var allHidden = await Feedbacks
            .Find(f => f.Status == FeedbackStatus.SubmittedHidden)
            .ToListAsync(cancellationToken);

        foreach (var group in allHidden.GroupBy(f => f.ProjectId).Where(group => group.Count() >= 2))
        {
            published += await PublishIdsAsync(group.Key, group.Select(f => f.Id).ToList(), cancellationToken);
            await NotifyPublicationOnceAsync(group.Key, cancellationToken);
        }

        // 3. Un avis masqué dont l'autre avis est déjà publié (ancien module ou
        //    publication précédente) devient visible immédiatement.
        foreach (var projectId in allHidden.Select(f => f.ProjectId).Distinct().ToList())
        {
            var docs = await Feedbacks
                .Find(f => f.ProjectId == projectId)
                .ToListAsync(cancellationToken);

            if (docs.Any(d => d.Status == FeedbackStatus.SubmittedHidden)
                && docs.Any(d => d.Status == FeedbackStatus.Published))
            {
                published += await PublishIdsAsync(
                    projectId,
                    docs.Where(d => d.Status == FeedbackStatus.SubmittedHidden).Select(d => d.Id).ToList(),
                    cancellationToken);
                await NotifyPublicationOnceAsync(projectId, cancellationToken);
            }
        }

        // 4. Demandes non soumises dont le délai est écoulé : expirées, sans avis fictif.
        var expiration = await Feedbacks.UpdateManyAsync(
            Builders<Feedback>.Filter.And(
                Builders<Feedback>.Filter.Eq(f => f.Status, FeedbackStatus.AwaitingReview),
                Builders<Feedback>.Filter.Ne(f => f.DueAt, null),
                Builders<Feedback>.Filter.Lte(f => f.DueAt, now)),
            Builders<Feedback>.Update
                .Set(f => f.Status, FeedbackStatus.Expired)
                .Set(f => f.UpdatedAt, now),
            cancellationToken: cancellationToken);

        // 5. Rappel unique pour les demandes toujours en attente.
        var reminderThreshold = now.Subtract(ReminderDelay);
        var reminders = await Feedbacks
            .Find(Builders<Feedback>.Filter.And(
                Builders<Feedback>.Filter.Eq(f => f.Status, FeedbackStatus.AwaitingReview),
                Builders<Feedback>.Filter.Lte(f => f.CreatedAt, reminderThreshold),
                Builders<Feedback>.Filter.Ne(f => f.DueAt, null),
                Builders<Feedback>.Filter.Gt(f => f.DueAt, now),
                Builders<Feedback>.Filter.Eq(f => f.ReminderNotifiedAt, null)))
            .ToListAsync(cancellationToken);

        var remindersSent = 0;
        foreach (var reminder in reminders)
        {
            if (await NotifyReminderOnceAsync(reminder, now, cancellationToken))
            {
                remindersSent++;
            }
        }

        // 6. Reprise des notifications de publication non confirmées : échec
        //    d'envoi précédent, arrêt brutal ou redémarrage de l'API. Le drapeau
        //    est propre au projet et n'est levé qu'une fois les deux envois
        //    confirmés.
        var pendingPublications = await ProjectsRaw
            .Find(Builders<BsonDocument>.Filter.Eq(PublicationPendingField, true))
            .Limit(100)
            .ToListAsync(cancellationToken);

        foreach (var pending in pendingPublications)
        {
            if (pending.TryGetValue("_id", out var id) && id.IsObjectId)
            {
                await NotifyPublicationOnceAsync(id.AsObjectId.ToString(), cancellationToken);
            }
        }

        return new FeedbackProcessingResult(published, (int)expiration.ModifiedCount, remindersSent);
    }

    private async System.Threading.Tasks.Task PublishIfEligibleAsync(string projectId, CancellationToken cancellationToken)
    {
        var docs = await Feedbacks
            .Find(f => f.ProjectId == projectId)
            .ToListAsync(cancellationToken);

        var hidden = docs.Where(d => d.Status == FeedbackStatus.SubmittedHidden).ToList();
        if (hidden.Count == 0)
        {
            return;
        }

        var otherReady = docs.Any(d => d.Status is FeedbackStatus.Published or FeedbackStatus.Expired);
        if (hidden.Count >= 2 || (hidden.Count == 1 && otherReady))
        {
            await PublishIdsAsync(projectId, hidden.Select(d => d.Id).ToList(), cancellationToken);
            await NotifyPublicationOnceAsync(projectId, cancellationToken);
        }
    }

    private async Task<int> PublishIdsAsync(string projectId, List<string> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
        {
            return 0;
        }

        // Drapeau de reprise : tant que les notifications des deux destinataires
        // ne sont pas confirmées, le projet reste « en attente de notification »
        // et sera repris au cycle suivant, même après un redémarrage.
        if (ObjectId.TryParse(projectId, out var projectObjectId))
        {
            await ProjectsRaw.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("_id", projectObjectId),
                Builders<BsonDocument>.Update.Set(PublicationPendingField, true),
                cancellationToken: cancellationToken);
        }

        var now = Now;
        var result = await Feedbacks.UpdateManyAsync(
            Builders<Feedback>.Filter.And(
                Builders<Feedback>.Filter.In(f => f.Id, ids),
                Builders<Feedback>.Filter.Eq(f => f.Status, FeedbackStatus.SubmittedHidden)),
            Builders<Feedback>.Update
                .Set(f => f.Status, FeedbackStatus.Published)
                .Set(f => f.PublishedAt, now)
                .Set(f => f.UpdatedAt, now),
            cancellationToken: cancellationToken);

        return (int)result.ModifiedCount;
    }

    /// <summary>
    /// Notifie la publication aux deux participants, chacun indépendamment.
    /// Le marqueur de chaque destinataire n'est posé qu'après un envoi réellement
    /// réussi : un échec pour l'un ne bloque pas l'autre et sera retenté au
    /// cycle suivant. Les identifiants de notification sont déterministes, donc
    /// deux instances concurrentes ne créent jamais de doublon.
    /// </summary>
    private async System.Threading.Tasks.Task NotifyPublicationOnceAsync(string projectId, CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(projectId, out var objectId))
        {
            return;
        }

        var published = await Feedbacks
            .Find(f => f.ProjectId == projectId && f.Status == FeedbackStatus.Published)
            .ToListAsync(cancellationToken);

        if (published.Count == 0)
        {
            // Aucun avis publié : l'écriture a pu être interrompue. Le drapeau
            // reste posé et le cycle suivant réessaiera ; les avis encore
            // masqués sont publiés par les étapes 1 à 3.
            return;
        }

        var projectTitle = published[0].ProjectTitle;
        var clientId = published[0].ClientId;
        var freelancerId = published[0].FreelancerId;
        var bothPublished = published.Count >= 2;
        var message = bothPublished
            ? $"Les deux évaluations du projet « {projectTitle} » sont maintenant publiées."
            : $"Une évaluation du projet « {projectTitle} » est maintenant publiée.";

        await NotifyPublicationRecipientOnceAsync(
            objectId,
            projectId,
            clientId,
            ClientPublicationMarker,
            message,
            projectTitle,
            cancellationToken);

        var freelancerIsClient = string.IsNullOrWhiteSpace(freelancerId) || freelancerId == clientId;
        if (!freelancerIsClient)
        {
            await NotifyPublicationRecipientOnceAsync(
                objectId,
                projectId,
                freelancerId,
                FreelancerPublicationMarker,
                message,
                projectTitle,
                cancellationToken);
        }

        // Le drapeau de reprise n'est levé que si les deux destinataires sont
        // confirmés : un échec pour l'un maintient la reprise pour le suivant.
        var project = await ProjectsRaw
            .Find(Builders<BsonDocument>.Filter.Eq("_id", objectId))
            .FirstOrDefaultAsync(cancellationToken);

        if (project is not null
            && MarkerSet(project, ClientPublicationMarker)
            && (freelancerIsClient || MarkerSet(project, FreelancerPublicationMarker)))
        {
            await SetPublicationPendingAsync(objectId, false, cancellationToken);
        }
    }

    private async System.Threading.Tasks.Task NotifyPublicationRecipientOnceAsync(
        ObjectId projectObjectId,
        string projectId,
        string recipientId,
        string markerField,
        string message,
        string projectTitle,
        CancellationToken cancellationToken)
    {
        if (!ObjectId.TryParse(recipientId, out _))
        {
            // Aucun destinataire valide : marquer comme traité évite une reprise
            // infinie, sans jamais créer de notification.
            _logger.LogWarning(
                "Feedback publication notification skipped for project {ProjectId}: invalid participant identifier.",
                projectId);
            await ProjectsRaw.UpdateOneAsync(
                Builders<BsonDocument>.Filter.Eq("_id", projectObjectId),
                Builders<BsonDocument>.Update.Set(markerField, Now),
                cancellationToken: cancellationToken);
            return;
        }

        BsonDocument? project;
        try
        {
            project = await ProjectsRaw
                .Find(Builders<BsonDocument>.Filter.Eq("_id", projectObjectId))
                .FirstOrDefaultAsync(cancellationToken);
        }
        catch (MongoCommandException)
        {
            return;
        }

        if (project is null)
        {
            return;
        }

        // Marqueur propre à ce destinataire : jamais partagé avec l'autre.
        if (project.Contains(markerField) && !project[markerField].IsBsonNull)
        {
            return;
        }

        // Une notification identique peut déjà exister (exécution antérieure ou
        // concurrente, éventuellement avec l'ancien identifiant aléatoire).
        var delivered = await _notifications.ExistsAsync(recipientId, "feedback-published", projectId, cancellationToken);

        if (!delivered)
        {
            delivered = await _notifications.CreateOnceAsync(
                NotificationService.StableId($"feedback-published:{projectId}:{recipientId}"),
                recipientId,
                "feedback-published",
                "Évaluations publiées",
                message,
                projectId,
                projectTitle,
                string.Empty,
                cancellationToken);
        }

        if (!delivered)
        {
            // Marqueur laissé vide : le prochain cycle retente l'envoi.
            _logger.LogWarning(
                "Feedback publication notification could not be delivered for project {ProjectId}; it will be retried.",
                projectId);
            return;
        }

        await ProjectsRaw.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", projectObjectId),
            Builders<BsonDocument>.Update.Set(markerField, Now),
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Envoie la demande d'évaluation une seule fois. Le marqueur n'est posé
    /// qu'après un envoi réussi, de sorte qu'un échec est rejoué au cycle
    /// suivant sans jamais dupliquer une notification déjà livrée.
    /// </summary>
    private async System.Threading.Tasks.Task NotifyRequestOnceAsync(Feedback request, CancellationToken cancellationToken)
    {
        if (request.DueAt is not null && request.DueAt <= Now)
        {
            return;
        }

        if (request.RequestNotifiedAt is not null)
        {
            return;
        }

        var recipient = string.IsNullOrWhiteSpace(request.RecipientName)
            ? "l'autre participant"
            : request.RecipientName;

        var delivered = await _notifications.CreateOnceAsync(
            NotificationService.StableId($"feedback-request:{request.ProjectId}:{request.AuthorId}"),
            request.AuthorId,
            "feedback-request",
            "Évaluation demandée",
            $"Le projet « {request.ProjectTitle} » est terminé. Évaluez {recipient} avant le {request.DueAt:dd/MM/yyyy}.",
            request.ProjectId,
            request.ProjectTitle,
            string.Empty,
            cancellationToken);

        if (!delivered)
        {
            _logger.LogWarning(
                "Feedback request notification could not be delivered for project {ProjectId}; it will be retried.",
                request.ProjectId);
            return;
        }

        await Feedbacks.UpdateOneAsync(
            Builders<Feedback>.Filter.And(
                Builders<Feedback>.Filter.Eq(f => f.Id, request.Id),
                Builders<Feedback>.Filter.Eq(f => f.RequestNotifiedAt, null)),
            Builders<Feedback>.Update.Set(f => f.RequestNotifiedAt, Now),
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Envoie le rappel unique à un participant qui n'a pas encore répondu.
    /// Renvoie <c>true</c> si le rappel a été livré (ou l'était déjà).
    /// </summary>
    private async Task<bool> NotifyReminderOnceAsync(
        Feedback reminder,
        DateTime now,
        CancellationToken cancellationToken)
    {
        if (reminder.ReminderNotifiedAt is not null)
        {
            return false;
        }

        var delivered = await _notifications.CreateOnceAsync(
            NotificationService.StableId($"feedback-reminder:{reminder.ProjectId}:{reminder.AuthorId}"),
            reminder.AuthorId,
            "feedback-reminder",
            "Évaluation en attente",
            $"Votre évaluation du projet « {reminder.ProjectTitle} » est toujours attendue. Vous pouvez la soumettre jusqu'au {reminder.DueAt:dd/MM/yyyy}.",
            reminder.ProjectId,
            reminder.ProjectTitle,
            string.Empty,
            cancellationToken);

        if (!delivered)
        {
            _logger.LogWarning(
                "Feedback reminder could not be delivered for project {ProjectId}; it will be retried.",
                reminder.ProjectId);
            return false;
        }

        await Feedbacks.UpdateOneAsync(
            Builders<Feedback>.Filter.And(
                Builders<Feedback>.Filter.Eq(f => f.Id, reminder.Id),
                Builders<Feedback>.Filter.Eq(f => f.ReminderNotifiedAt, null)),
            Builders<Feedback>.Update.Set(f => f.ReminderNotifiedAt, now),
            cancellationToken: cancellationToken);

        return true;
    }

    private async System.Threading.Tasks.Task SetPublicationPendingAsync(
        ObjectId projectId,
        bool pending,
        CancellationToken cancellationToken)
    {
        await ProjectsRaw.UpdateOneAsync(
            Builders<BsonDocument>.Filter.Eq("_id", projectId),
            Builders<BsonDocument>.Update.Set(PublicationPendingField, pending),
            cancellationToken: cancellationToken);
    }

    private static bool MarkerSet(BsonDocument project, string field) =>
        project.Contains(field) && !project[field].IsBsonNull;

    // ---------------------------------------------------------------------
    // Mapping
    // ---------------------------------------------------------------------

    private static FilterDefinition<Feedback> PublishedForRecipientFilter(string userId)
    {
        // Seuls les avis publiés dont l'utilisateur est le destinataire sont
        // exposés. La migration au démarrage garantit recipientId sur les avis
        // historiques : aucun document n'est oublié.
        return Builders<Feedback>.Filter.And(
            Builders<Feedback>.Filter.Eq(f => f.Status, FeedbackStatus.Published),
            Builders<Feedback>.Filter.Eq(f => f.RecipientId, userId));
    }

    private static FeedbackResponse ToResponse(Feedback feedback, bool includeContent)
    {
        var status = string.IsNullOrWhiteSpace(feedback.Status) ? FeedbackStatus.Published : feedback.Status;
        var direction = string.IsNullOrWhiteSpace(feedback.Direction)
            ? FeedbackDirection.ClientToFreelancer
            : feedback.Direction;
        var authorRole = string.IsNullOrWhiteSpace(feedback.AuthorRole)
            ? (direction == FeedbackDirection.ClientToFreelancer ? UserRole.Client : UserRole.Freelancer)
            : feedback.AuthorRole;
        var recipientRole = string.IsNullOrWhiteSpace(feedback.RecipientRole)
            ? (direction == FeedbackDirection.ClientToFreelancer ? UserRole.Freelancer : UserRole.Client)
            : feedback.RecipientRole;

        var authorName = !string.IsNullOrWhiteSpace(feedback.AuthorName)
            ? feedback.AuthorName
            : direction == FeedbackDirection.ClientToFreelancer
                ? feedback.ClientName
                : feedback.FreelancerName;
        var recipientName = !string.IsNullOrWhiteSpace(feedback.RecipientName)
            ? feedback.RecipientName
            : direction == FeedbackDirection.ClientToFreelancer
                ? feedback.FreelancerName
                : feedback.ClientName;

        var response = new FeedbackResponse
        {
            Id = feedback.Id,
            ProjectId = feedback.ProjectId,
            ProjectTitle = feedback.ProjectTitle,
            ClientId = feedback.ClientId,
            ClientName = feedback.ClientName,
            FreelancerId = feedback.FreelancerId,
            FreelancerName = feedback.FreelancerName,
            AuthorId = feedback.AuthorId,
            AuthorName = authorName,
            AuthorRole = authorRole,
            RecipientId = feedback.RecipientId,
            RecipientName = recipientName,
            RecipientRole = recipientRole,
            Direction = direction,
            Status = status,
            Rating = feedback.Rating,
            AverageRating = feedback.AverageRating > 0 ? feedback.AverageRating : feedback.Rating,
            Criteria = feedback.Criteria is null ? new Dictionary<string, int>() : new Dictionary<string, int>(feedback.Criteria),
            Comment = feedback.Comment,
            Strengths = feedback.Strengths,
            Improvements = feedback.Improvements,
            Recommend = feedback.Recommend,
            SubmittedAt = feedback.SubmittedAt ?? (status == FeedbackStatus.Published ? feedback.CreatedAt : null),
            PublishedAt = status == FeedbackStatus.Published ? feedback.PublishedAt ?? feedback.CreatedAt : null,
            DueAt = feedback.DueAt,
            CreatedAt = feedback.CreatedAt,
            UpdatedAt = feedback.UpdatedAt,
        };

        if (!includeContent || status is not (FeedbackStatus.SubmittedHidden or FeedbackStatus.Published))
        {
            response.Rating = 0;
            response.AverageRating = 0;
            response.Criteria = new Dictionary<string, int>();
            response.Comment = string.Empty;
            response.Strengths = string.Empty;
            response.Improvements = string.Empty;
            response.Recommend = null;
            response.SubmittedAt = null;
        }

        if (status != FeedbackStatus.Published)
        {
            response.PublishedAt = null;
        }

        return response;
    }

    private static string DisplayName(User user)
    {
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return name.Length > 0 ? name : user.Email;
    }
}

/// <summary>
/// Résultat d'un cycle de traitement des évaluations en attente. Utilisé pour
/// les journaux du service planifié ; ne contient aucun contenu d'avis.
/// </summary>
public sealed record FeedbackProcessingResult(int Published, int Expired, int Reminders);
