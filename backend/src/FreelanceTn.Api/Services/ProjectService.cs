using System.Globalization;
using System.Text.RegularExpressions;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Projects;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Gestion des projets. Un projet appartient à son creator (compte authentifié) :
/// celui-ci seul peut le modifier, le supprimer et l'approuver. Un projet publié
/// (statut « Open ») est visible par tous : c'est le catalogue des opportunités
/// que les freelances parcourent. Lorsqu'un client approuve un freelance pour un
/// projet, ce projet est référencé par <see cref="Project.AssignedTo"/> et
/// apparaît alors dans le tableau de bord du freelance concerné.
/// </summary>
public class ProjectService
{
    private readonly MongoContext _mongo;

    public ProjectService(MongoContext mongo)
    {
        _mongo = mongo;
    }

    private IMongoCollection<Project> Projects => _mongo.GetCollection<Project>(_mongo.Settings.ProjectsCollection);

    private IMongoCollection<User> Users => _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);

    private IMongoCollection<Proposal> Proposals => _mongo.GetCollection<Proposal>(_mongo.Settings.ProposalsCollection);

    private IMongoCollection<Notification> Notifications => _mongo.GetCollection<Notification>(_mongo.Settings.NotificationsCollection);

    public async Task<ProjectResponse> CreateAsync(string ownerId, CreateProjectRequest request, CancellationToken cancellationToken)
    {
        await EnsureClientAsync(ownerId, cancellationToken);

        var project = new Project
        {
            OwnerId = ownerId,
            Title = request.Title.Trim(),
            Description = request.Description.Trim(),
            Budget = request.Budget.Trim(),
            Type = request.Type.Trim(),
            BudgetMin = request.BudgetMin,
            BudgetMax = request.BudgetMax,
            DurationValue = request.DurationValue,
            DurationUnit = string.IsNullOrWhiteSpace(request.DurationUnit) ? null : request.DurationUnit.Trim(),
            Proposals = 0,
            Skills = NormalizeSkills(request.Skills),
            Client = request.Client.Trim(),
            Status = string.IsNullOrWhiteSpace(request.Status) ? ProjectStatus.Open : request.Status,
            Category = string.IsNullOrWhiteSpace(request.Category) ? null : request.Category.Trim(),
            Deadline = string.IsNullOrWhiteSpace(request.Deadline) ? null : request.Deadline.Trim(),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Attachments = request.Attachments != null ? DedupAttachments(request.Attachments) : [],
        };

        ProjectMilestoneWorkflow.Sync(project, null, project.Status, DateTime.UtcNow);

        await Projects.InsertOneAsync(project, cancellationToken: cancellationToken);
        return ToResponse(project);
    }

    // Toujours filtrés par ownerId : un compte ne voit que ses propres projets.
    public async Task<List<ProjectResponse>> ListAsync(string ownerId, CancellationToken cancellationToken)
    {
        var projects = await Projects
            .Find(p => p.OwnerId == ownerId)
            .SortByDescending(p => p.CreatedAt)
            .ToListAsync(cancellationToken);

        await EnsureMilestonesAsync(projects, cancellationToken);
        return projects.Select(ToResponse).ToList();
    }

    /// <summary>Catalogue public : uniquement les projets publiés (statut « Open »).</summary>
    public async Task<List<ProjectResponse>> ListCatalogAsync(
        string? category = null,
        string? query = null,
        int limit = 50,
        string? type = null,
        decimal? minBudget = null,
        decimal? maxBudget = null,
        int? durationValue = null,
        string? durationUnit = null,
        CancellationToken cancellationToken = default)
    {
        // Un projet attribué n'est plus une opportunité ouverte, même si son
        // statut n'a pas encore été basculé (approbation manuelle).
        var filter = Builders<Project>.Filter.Eq(project => project.Status, ProjectStatus.Open)
            & Builders<Project>.Filter.Eq(project => project.AssignedTo, (string?)null);

        if (!string.IsNullOrWhiteSpace(category))
        {
            filter &= Builders<Project>.Filter.Regex(
                project => project.Category,
                new BsonRegularExpression($"^{Regex.Escape(category.Trim())}$", "i"));
        }

        if (!string.IsNullOrWhiteSpace(type))
        {
            // Les projets existants utilisent plusieurs libellés pour le même
            // type (« Fixed », « Fixed price », « Fixed-price »). Le filtre
            // « Fixed price » doit donc couvrir toutes ces variantes, comme le
            // filtre « Hourly » couvre « Hourly » / « Hourly rate ».
            var normalizedType = type.Trim();
            var pattern = normalizedType.StartsWith("fixed", StringComparison.OrdinalIgnoreCase)
                ? "^fixed"
                : normalizedType.StartsWith("hourly", StringComparison.OrdinalIgnoreCase)
                    ? "^hourly"
                    : $"^{Regex.Escape(normalizedType)}$";

            filter &= Builders<Project>.Filter.Regex(
                project => project.Type,
                new BsonRegularExpression(pattern, "i"));
        }

        if (!string.IsNullOrWhiteSpace(query))
        {
            // Recherche multi-mots : chaque mot doit être présent dans au moins
            // un des champs indexés. « web design » ne se transforme donc plus
            // en une seule chaîne qui ne correspondrait qu'à une phrase exacte.
            var tokens = Regex.Split(query.Trim(), @"\s+")
                .Where(token => token.Length > 0)
                .Take(10)
                .ToList();

            foreach (var token in tokens)
            {
                var pattern = new BsonRegularExpression(Regex.Escape(token), "i");
                filter &= Builders<Project>.Filter.Or(
                    Builders<Project>.Filter.Regex(project => project.Title, pattern),
                    Builders<Project>.Filter.Regex(project => project.Description, pattern),
                    Builders<Project>.Filter.Regex(project => project.Skills, pattern),
                    Builders<Project>.Filter.Regex(project => project.Client, pattern),
                    Builders<Project>.Filter.Regex(project => project.Category, pattern));
            }
        }

        // Les champs budgétaires structurés sont absents sur les projets créés
        // avant leur introduction : le budget est alors un texte libre
        // (« 2,000 TND-5,000 TND »). Le filtre est donc appliqué côté serveur
        // après lecture, sur la plage réellement déduite du projet.
        var projects = await Projects
            .Find(filter)
            .SortByDescending(project => project.CreatedAt)
            .Limit(1000)
            .ToListAsync(cancellationToken);

        if (minBudget.HasValue || maxBudget.HasValue)
        {
            projects = projects.Where(project => MatchesBudget(project, minBudget, maxBudget)).ToList();
        }

        if (durationValue.HasValue || !string.IsNullOrWhiteSpace(durationUnit))
        {
            projects = projects.Where(project => MatchesDuration(project, durationValue, durationUnit)).ToList();
        }

        await EnsureMilestonesAsync(projects, cancellationToken);

        return projects
            .Take(Math.Clamp(limit, 1, 200))
            .Select(ToResponse)
            .ToList();
    }

    /// <summary>
    /// Catégories réellement présentes dans le catalogue des projets publiés et
    /// non attribués. Utilisées par le filtre « All Categories » afin de ne
    /// jamais proposer une catégorie qui ne correspond à aucun projet.
    /// </summary>
    public async Task<List<string>> ListCatalogCategoriesAsync(CancellationToken cancellationToken)
    {
        var projects = await Projects
            .Find(Builders<Project>.Filter.Eq(project => project.Status, ProjectStatus.Open)
                & Builders<Project>.Filter.Eq(project => project.AssignedTo, (string?)null))
            .ToListAsync(cancellationToken);

        return projects
            .Select(project => project.Category?.Trim() ?? string.Empty)
            .Where(category => category.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(category => category, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Projets approuvés par un client pour le freelance connecté.</summary>
    public async Task<List<ProjectResponse>> ListAssignedAsync(string freelancerId, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(freelancerId, cancellationToken);

        var projects = await Projects
            .Find(project => project.AssignedTo == freelancerId)
            .SortByDescending(project => project.UpdatedAt)
            .ToListAsync(cancellationToken);

        await EnsureMilestonesAsync(projects, cancellationToken);
        return projects.Select(ToResponse).ToList();
    }

    /// <summary>
    /// Comptes freelances qu'un client peut approuver pour un projet. Seules les
    /// informations publiques sont renvoyées.
    /// </summary>
    public async Task<List<FreelancerSummaryResponse>> ListAssigneesAsync(string requesterId, CancellationToken cancellationToken)
    {
        await EnsureClientAsync(requesterId, cancellationToken);

        var users = await Users
            .Find(user => user.Role == UserRole.Freelancer)
            .SortBy(user => user.FirstName)
            .ToListAsync(cancellationToken);

        return users
            .Select(user => new FreelancerSummaryResponse
            {
                Id = user.Id,
                Name = $"{user.FirstName} {user.LastName}".Trim(),
                Title = user.Title,
                Avatar = user.Avatar,
            })
            .ToList();
    }

    /// <summary>
    /// Consultation d'un projet. Un projet publié est visible par tous ; un
    /// brouillon ou un projet en cours reste visible par son seul propriétaire.
    /// </summary>
    public async Task<ProjectResponse> GetAsync(string? requesterId, string projectId, CancellationToken cancellationToken)
    {
        var project = await FindAsync(projectId, cancellationToken);
        var isOwner = requesterId is not null && project.OwnerId == requesterId;
        // Le freelance attribué doit pouvoir consulter le projet qu'il exécute,
        // y compris après la soumission (statut « Client review »).
        var isAssigned = requesterId is not null
            && !string.IsNullOrWhiteSpace(project.AssignedTo)
            && project.AssignedTo == requesterId;

        if (!isOwner && !isAssigned && !ProjectStatus.IsPublished(project.Status))
        {
            throw new NotFoundException("Projet introuvable.");
        }

        await EnsureMilestonesAsync(project, cancellationToken);
        return ToResponse(project);
    }

    /// <summary>Accès à l'entité projet (usage interne service). Vérifie la visibilité comme GetAsync.</summary>
    public async Task<Project> GetEntityAsync(string? requesterId, string projectId, CancellationToken cancellationToken)
    {
        var project = await FindAsync(projectId, cancellationToken);
        var isOwner = requesterId is not null && project.OwnerId == requesterId;
        var isAssigned = requesterId is not null
            && !string.IsNullOrWhiteSpace(project.AssignedTo)
            && project.AssignedTo == requesterId;
        if (!isOwner && !isAssigned && !ProjectStatus.IsPublished(project.Status))
            throw new NotFoundException("Projet introuvable.");
        await EnsureMilestonesAsync(project, cancellationToken);
        return project;
    }

    public async Task<ProjectResponse> UpdateAsync(string ownerId, string projectId, UpdateProjectRequest request, CancellationToken cancellationToken)
    {
        // Seuls les comptes clients gèrent leurs projets : le rôle est relu en
        // base (source de vérité), jamais déduit d'une valeur fournie par le
        // client. FindOwnedAsync garantit ensuite que le projet appartient bien
        // au compte connecté (404 sinon, sans divulguer son existence).
        await EnsureClientAsync(ownerId, cancellationToken);

        var project = await FindOwnedAsync(ownerId, projectId, cancellationToken);
        var author = await Users.Find(item => item.Id == ownerId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");
        var now = DateTime.UtcNow;

        var previousStatus = project.Status;
        var previousAssignedTo = project.AssignedTo;
        var previousAssignedToName = project.AssignedToName;
        var previousAssignedAt = project.AssignedAt;

        var targetStatus = request.Status?.Trim();

        // La transition est validée avant toute écriture : une transition
        // refusée ne doit laisser aucune trace (ni proposition modifiée, ni
        // notification envoyée).
        if (!string.IsNullOrWhiteSpace(targetStatus)
            && !ProjectStatus.CanTransition(previousStatus, targetStatus))
        {
            throw new ConflictException($"Transition de statut non autorisée : « {previousStatus} » vers « {targetStatus} ».");
        }

        // Annulation d'acceptation : le projet en cours revient à « Open ».
        var cancelsAcceptance = !string.IsNullOrWhiteSpace(targetStatus)
            && string.Equals(previousStatus, ProjectStatus.InProgress, StringComparison.OrdinalIgnoreCase)
            && string.Equals(targetStatus, ProjectStatus.Open, StringComparison.OrdinalIgnoreCase);

        // Réouverture : un projet terminé redevient ouvert et publié.
        var reopensProject = !string.IsNullOrWhiteSpace(targetStatus)
            && string.Equals(previousStatus, ProjectStatus.Completed, StringComparison.OrdinalIgnoreCase)
            && string.Equals(targetStatus, ProjectStatus.Open, StringComparison.OrdinalIgnoreCase);

        // Réouverture en cours d'exécution : le projet terminé reprend avec le
        // même freelance assigné (aucune affectation libérée).
        var reopensExecution = !string.IsNullOrWhiteSpace(targetStatus)
            && string.Equals(previousStatus, ProjectStatus.Completed, StringComparison.OrdinalIgnoreCase)
            && string.Equals(targetStatus, ProjectStatus.InProgress, StringComparison.OrdinalIgnoreCase);

        // Retrait explicite de l'approbation (affectation vide).
        var removesApproval = request.AssignedTo is not null && string.IsNullOrWhiteSpace(request.AssignedTo);

        // Une transition libère l'affectation : la fixer dans le même appel
        // serait contradictoire.
        if ((cancelsAcceptance || reopensProject)
            && request.AssignedTo is not null
            && !string.IsNullOrWhiteSpace(request.AssignedTo))
        {
            throw new ConflictException("Impossible d'affecter un freelance pendant l'annulation d'une acceptation ou la réouverture d'un projet.");
        }

        if (request.Title is not null) project.Title = request.Title.Trim();
        if (request.Description is not null) project.Description = request.Description.Trim();
        if (request.Budget is not null) project.Budget = request.Budget.Trim();
        if (request.Type is not null) project.Type = request.Type.Trim();
        if (request.BudgetMin.HasValue) project.BudgetMin = request.BudgetMin;
        if (request.BudgetMax.HasValue) project.BudgetMax = request.BudgetMax;
        if (request.DurationValue.HasValue) project.DurationValue = request.DurationValue;
        if (request.DurationUnit is not null) project.DurationUnit = string.IsNullOrWhiteSpace(request.DurationUnit) ? null : request.DurationUnit.Trim();
        if (request.Client is not null) project.Client = request.Client.Trim();
        if (request.Category is not null) project.Category = request.Category.Trim();
        if (request.Deadline is not null) project.Deadline = request.Deadline.Trim();
        if (request.Skills is not null) project.Skills = NormalizeSkills(request.Skills);
        if (request.Attachments is not null) project.Attachments = DedupAttachments(request.Attachments);

        if (!string.IsNullOrWhiteSpace(targetStatus))
        {
            project.Status = targetStatus;
            // Les étapes standard suivent le statut réel du projet. La
            // synchronisation est idempotente : une étape existante est mise à
            // jour par sa clé, jamais dupliquée.
            ProjectMilestoneWorkflow.Sync(project, previousStatus, targetStatus, now);
        }

        var releasedAssignment = false;

        // Affectation : elle n'est modifiée que si le client l'a demandée, et
        // seulement en dehors des transitions qui libèrent l'affectation.
        if (request.AssignedTo is not null && !cancelsAcceptance && !reopensProject)
        {
            await ApplyAssignmentAsync(project, request.AssignedTo, cancellationToken);

            // Un changement de freelance retenu conserve la trace du précédent :
            // aucune information d'affectation n'est perdue.
            if (!string.IsNullOrWhiteSpace(request.AssignedTo)
                && !string.IsNullOrWhiteSpace(previousAssignedTo)
                && !string.Equals(request.AssignedTo.Trim(), previousAssignedTo, StringComparison.Ordinal))
            {
                AppendAssignmentHistory(
                    project,
                    previousAssignedTo,
                    previousAssignedToName,
                    previousAssignedAt,
                    AssignmentReleaseReason.Reassigned,
                    DateTime.UtcNow);
                releasedAssignment = true;
            }
        }

        if (cancelsAcceptance || reopensProject || removesApproval)
        {
            if (!string.IsNullOrWhiteSpace(previousAssignedTo))
            {
                var reason = reopensProject
                    ? AssignmentReleaseReason.ProjectReopened
                    : cancelsAcceptance
                        ? AssignmentReleaseReason.AcceptanceCancelled
                        : AssignmentReleaseReason.AssignmentRemoved;

                AppendAssignmentHistory(project, previousAssignedTo, previousAssignedToName, previousAssignedAt, reason, DateTime.UtcNow);
                releasedAssignment = true;
            }

            project.AssignedTo = null;
            project.AssignedToName = null;
            project.AssignedAt = null;
        }

        project.UpdatedAt = now;

        // Historique chronologique : un changement de statut et/ou un message
        // explicitement fourni par le client est conservé avec son auteur et sa
        // date. Une transition sans message reste tracée par un libellé lisible.
        var statusChanged = !string.IsNullOrWhiteSpace(targetStatus)
            && !string.Equals(previousStatus, project.Status, StringComparison.OrdinalIgnoreCase);
        var eventMessage = request.Message?.Trim();
        if (statusChanged || !string.IsNullOrWhiteSpace(eventMessage))
        {
            var eventType = reopensExecution
                ? "project-reopened"
                : statusChanged
                    ? "project-status"
                    : "comment";
            var text = string.IsNullOrWhiteSpace(eventMessage)
                ? DescribeStatusChange(previousStatus, project.Status)
                : eventMessage!;

            ProjectMilestoneWorkflow.AppendHistory(
                project,
                eventType,
                text,
                author.Id,
                DisplayName(author),
                author.Role,
                now);
        }

        // Annulation d'acceptation : la proposition acceptée est identifiée
        // avant l'écriture du projet, afin que le compteur puisse être
        // recalculé de façon cohérente avec la transition.
        Proposal? acceptedProposal = null;
        if (cancelsAcceptance && !string.IsNullOrWhiteSpace(previousAssignedTo))
        {
            acceptedProposal = await Proposals
                .Find(p => p.ProjectId == project.Id
                    && p.Status == ProposalStatus.Accepted
                    && p.FreelancerId == previousAssignedTo)
                .FirstOrDefaultAsync(cancellationToken);
        }

        // Le compteur est recalculé à partir des propositions existantes : il
        // exclut les propositions retirées, annulées et celle qui va être
        // annulée. La valeur est écrite dans le même échange que la
        // transition (une seule écriture atomique sur le document projet).
        if (cancelsAcceptance)
        {
            project.Proposals = await CountProposalsAsync(
                project.Id,
                cancellationToken,
                acceptedProposal?.Id);
        }

        // Écriture conditionnelle : le statut attendu doit toujours être le
        // statut lu. Deux transitions concurrentes ne peuvent donc pas aboutir
        // toutes les deux (compare-and-swap au niveau du document).
        var projectFilter = Builders<Project>.Filter.And(
            Builders<Project>.Filter.Eq(p => p.Id, project.Id),
            Builders<Project>.Filter.Eq(p => p.OwnerId, ownerId));

        if (!string.IsNullOrWhiteSpace(targetStatus))
        {
            projectFilter &= Builders<Project>.Filter.Eq(p => p.Status, previousStatus);
        }

        var writeResult = await Projects.ReplaceOneAsync(projectFilter, project, cancellationToken: cancellationToken);
        if (writeResult.MatchedCount == 0)
        {
            throw new ConflictException("Ce projet a été modifié entre-temps. Rechargez-le puis réessayez.");
        }

        // Annulation d'acceptation : la proposition acceptée passe à
        // « Cancelled ». Les autres propositions (Pending, Refused...) ne sont
        // jamais modifiées : une proposition refusée n'est jamais remise
        // automatiquement en attente.
        if (acceptedProposal is not null)
        {
            await Proposals.UpdateOneAsync(
                p => p.Id == acceptedProposal.Id && p.Status == ProposalStatus.Accepted,
                Builders<Proposal>.Update
                    .Set(p => p.Status, ProposalStatus.Cancelled)
                    .Set(p => p.ProjectStatus, project.Status)
                    .Set(p => p.UpdatedAt, DateTime.UtcNow),
                cancellationToken: cancellationToken);
        }

        // Recalcul final du compteur à partir des propositions réellement
        // présentes en base : le compteur reflète toujours l'état réel des
        // candidatures, même si la proposition annulée a été modifiée entre
        // la lecture et l'écriture.
        if (cancelsAcceptance)
        {
            var proposalCount = await CountProposalsAsync(project.Id, cancellationToken);
            if (proposalCount != project.Proposals)
            {
                await Projects.UpdateOneAsync(
                    p => p.Id == project.Id && p.OwnerId == ownerId,
                    Builders<Project>.Update.Set(p => p.Proposals, proposalCount),
                    cancellationToken: cancellationToken);
                project.Proposals = proposalCount;
            }
        }

        // Notification au freelance précédemment sélectionné lorsque son
        // acceptation est annulée.
        if (cancelsAcceptance
            && releasedAssignment
            && !string.IsNullOrWhiteSpace(previousAssignedTo)
            && previousAssignedTo != ownerId)
        {
            var notification = new Notification
            {
                RecipientId = previousAssignedTo!,
                Type = "proposal-cancelled",
                Title = project.Title,
                Message = $"L'acceptation de votre proposition pour « {project.Title} » a été annulée.",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.Client,
                CreatedAt = DateTime.UtcNow,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        // Notification à l'ancien freelancer lorsque le projet est rouvert.
        if (reopensProject
            && releasedAssignment
            && !string.IsNullOrWhiteSpace(previousAssignedTo)
            && previousAssignedTo != ownerId)
        {
            var notification = new Notification
            {
                RecipientId = previousAssignedTo!,
                Type = "project-reopened",
                Title = project.Title,
                Message = $"Le projet « {project.Title} » a été réouvert.",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.Client,
                CreatedAt = DateTime.UtcNow,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        // Notification au freelance assigné lorsque le projet terminé est
        // rouvert en cours d'exécution : l'affectation est conservée et le
        // freelance reprend le travail avec le message éventuel du client.
        if (reopensExecution
            && !string.IsNullOrWhiteSpace(project.AssignedTo)
            && project.AssignedTo != ownerId)
        {
            var detail = string.IsNullOrWhiteSpace(request.Message?.Trim())
                ? $"Le projet « {project.Title} » a été rouvert."
                : $"Le projet « {project.Title} » a été rouvert : {request.Message!.Trim()}";
            var notification = new Notification
            {
                RecipientId = project.AssignedTo!,
                Type = "project-reopened",
                Title = project.Title,
                Message = detail,
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.Client,
                CreatedAt = DateTime.UtcNow,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        // Notification au freelance lorsqu'un projet est marqué comme terminé.
        if (project.Status == ProjectStatus.Completed && previousStatus != ProjectStatus.Completed && !string.IsNullOrWhiteSpace(project.AssignedTo))
        {
            var notification = new Notification
            {
                RecipientId = project.AssignedTo!,
                Type = "project-completed",
                Title = project.Title,
                Message = $"Le projet « {project.Title} » a été marqué comme terminé.",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.Client,
                CreatedAt = DateTime.UtcNow,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        // Notification au freelance lorsqu'une correction est demandée après
        // une soumission : le projet revient « In progress ».
        if (string.Equals(previousStatus, ProjectStatus.ClientReview, StringComparison.OrdinalIgnoreCase)
            && string.Equals(project.Status, ProjectStatus.InProgress, StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(project.AssignedTo))
        {
            var notification = new Notification
            {
                RecipientId = project.AssignedTo!,
                Type = "project-revision-requested",
                Title = project.Title,
                Message = $"Le client a demandé des corrections sur « {project.Title} ».",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.Client,
                CreatedAt = DateTime.UtcNow,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        return ToResponse(project);
    }

    /// <summary>
    /// Soumission d'un projet par le freelance pour validation client.
    /// Le projet doit être attribué au freelance et en cours (In progress).
    /// </summary>
    public async Task<ProjectResponse> SubmitForReviewAsync(string freelancerId, string projectId, CancellationToken cancellationToken, string? message = null)
    {
        var freelancer = await EnsureFreelancerAsync(freelancerId, cancellationToken);

        var project = await FindAsync(projectId, cancellationToken);
        if (!string.Equals(project.AssignedTo, freelancerId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Vous n'etes pas le freelance attribue a ce projet.");
        }
        if (!ProjectStatus.CanTransition(project.Status, ProjectStatus.ClientReview))
        {
            throw new ConflictException($"Transition de statut non autorisee : {project.Status} vers {ProjectStatus.ClientReview}.");
        }

        var previousStatus = project.Status;
        var now = DateTime.UtcNow;
        project.Status = ProjectStatus.ClientReview;
        project.UpdatedAt = now;

        // Le travail soumis est reflété dans les étapes et dans l'historique :
        // le client comprend immédiatement où en est le projet.
        ProjectMilestoneWorkflow.Sync(project, previousStatus, ProjectStatus.ClientReview, now);
        var submittedMessage = string.IsNullOrWhiteSpace(message)
            ? "Le freelance a soumis le projet pour validation."
            : message.Trim();
        ProjectMilestoneWorkflow.AppendHistory(
            project,
            "submitted",
            submittedMessage,
            freelancer.Id,
            DisplayName(freelancer),
            freelancer.Role,
            now);

        var filter = Builders<Project>.Filter.And(
            Builders<Project>.Filter.Eq(p => p.Id, project.Id),
            Builders<Project>.Filter.Eq(p => p.AssignedTo, freelancerId),
            Builders<Project>.Filter.Eq(p => p.Status, previousStatus));
        var result = await Projects.ReplaceOneAsync(filter, project, cancellationToken: cancellationToken);
        if (result.MatchedCount == 0)
        {
            throw new ConflictException("Ce projet a ete modifie entre-temps. Rechargez-le puis reessayez.");
        }

        if (!string.IsNullOrWhiteSpace(project.OwnerId) && project.OwnerId != freelancerId)
        {
            var notification = new Notification
            {
                RecipientId = project.OwnerId,
                Type = "project-submitted-review",
                Title = project.Title,
                Message = $"Le projet {project.Title} a ete soumis pour votre validation.",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.AssignedToName ?? string.Empty,
                CreatedAt = DateTime.UtcNow,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        return ToResponse(project);
    }

    /// <summary>
    /// Réouverture d'un projet terminé par son client propriétaire. Le projet
    /// reprend en cours d'exécution avec le même freelance assigné : les
    /// milestones sont réinitialisés sans perdre l'historique, l'événement est
    /// tracé et le freelance est notifié.
    /// </summary>
    public async Task<ProjectResponse> ReopenAsync(
        string ownerId,
        string projectId,
        ReopenProjectRequest request,
        CancellationToken cancellationToken)
    {
        var author = await EnsureClientAsync(ownerId, cancellationToken);
        var project = await FindOwnedAsync(ownerId, projectId, cancellationToken);

        if (!string.Equals(project.Status, ProjectStatus.Completed, StringComparison.OrdinalIgnoreCase))
        {
            throw new ConflictException("Seul un projet terminé peut être rouvert.");
        }

        var previousStatus = project.Status;
        var now = DateTime.UtcNow;
        project.Status = ProjectStatus.InProgress;
        project.UpdatedAt = now;
        ProjectMilestoneWorkflow.Sync(project, previousStatus, ProjectStatus.InProgress, now);

        var message = request.Message?.Trim();
        ProjectMilestoneWorkflow.AppendHistory(
            project,
            "project-reopened",
            string.IsNullOrWhiteSpace(message) ? "Le client a rouvert le projet." : message!,
            author.Id,
            DisplayName(author),
            author.Role,
            now);

        var filter = Builders<Project>.Filter.And(
            Builders<Project>.Filter.Eq(p => p.Id, project.Id),
            Builders<Project>.Filter.Eq(p => p.OwnerId, ownerId),
            Builders<Project>.Filter.Eq(p => p.Status, previousStatus));

        var result = await Projects.ReplaceOneAsync(filter, project, cancellationToken: cancellationToken);
        if (result.MatchedCount == 0)
        {
            throw new ConflictException("Ce projet a été modifié entre-temps. Rechargez-le puis réessayez.");
        }

        if (!string.IsNullOrWhiteSpace(project.AssignedTo) && project.AssignedTo != ownerId)
        {
            var notification = new Notification
            {
                RecipientId = project.AssignedTo,
                Type = "project-reopened",
                Title = project.Title,
                Message = string.IsNullOrWhiteSpace(message)
                    ? $"Le projet « {project.Title} » a été rouvert."
                    : $"Le projet « {project.Title} » a été rouvert : {message}",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.Client,
                CreatedAt = now,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        return ToResponse(project);
    }

    /// <summary>
    /// Action sur une étape du projet. Le client propriétaire peut valider une
    /// étape ou demander des modifications ; le freelance assigné peut mettre à
    /// jour sa progression. Chaque action est historisée avec son auteur.
    /// </summary>
    public async Task<ProjectResponse> MilestoneActionAsync(
        string userId,
        string projectId,
        string milestoneId,
        MilestoneActionRequest request,
        CancellationToken cancellationToken)
    {
        var user = await Users.Find(item => item.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        var project = await FindAsync(projectId, cancellationToken);
        var isOwner = string.Equals(project.OwnerId, userId, StringComparison.Ordinal);
        var isAssigned = !string.IsNullOrWhiteSpace(project.AssignedTo)
            && string.Equals(project.AssignedTo, userId, StringComparison.Ordinal);

        if (!isOwner && !isAssigned)
        {
            throw new ForbiddenException("Vous n'êtes pas autorisé à modifier les étapes de ce projet.");
        }

        var action = request.Action?.Trim().ToLowerInvariant() ?? string.Empty;
        if (action.Length == 0)
        {
            throw new ConflictException("Action de milestone manquante.");
        }

        var previousStatus = project.Status;
        var now = DateTime.UtcNow;
        var message = request.Message?.Trim();

        // Une demande de modification sur un projet soumis le repasse en cours
        // d'exécution. La synchronisation est faite avant l'action pour que
        // l'étape concernée conserve son statut « Changes requested ».
        var movesBackToProgress = action == "request-changes"
            && string.Equals(project.Status, ProjectStatus.ClientReview, StringComparison.OrdinalIgnoreCase);
        if (movesBackToProgress)
        {
            project.Status = ProjectStatus.InProgress;
            ProjectMilestoneWorkflow.Sync(project, previousStatus, ProjectStatus.InProgress, now);
        }

        project.Milestones ??= [];
        var milestone = project.Milestones.FirstOrDefault(item =>
            string.Equals(item.Id, milestoneId, StringComparison.Ordinal))
            ?? throw new NotFoundException("Étape introuvable.");

        string eventType;
        string eventMessage;

        switch (action)
        {
            case "progress":
            case "submit":
                if (!isAssigned)
                {
                    throw new ForbiddenException("Seul le freelance assigné peut mettre à jour la progression.");
                }
                if (!string.Equals(project.Status, ProjectStatus.InProgress, StringComparison.OrdinalIgnoreCase))
                {
                    throw new ConflictException("La progression ne peut être mise à jour que sur un projet en cours.");
                }

                milestone.Status = action == "submit" ? MilestoneStatus.Submitted : MilestoneStatus.InProgress;
                milestone.Progress = Math.Clamp(
                    request.Progress ?? (action == "submit" ? 100 : milestone.Progress),
                    0,
                    100);
                eventType = "milestone-status";
                eventMessage = string.IsNullOrWhiteSpace(message)
                    ? $"Le freelance a mis à jour l'étape « {milestone.Title} » ({milestone.Progress} %)."
                    : message!;
                break;

            case "approve":
                if (!isOwner)
                {
                    throw new ForbiddenException("Seul le client propriétaire peut valider une étape.");
                }
                milestone.Status = MilestoneStatus.Approved;
                milestone.Progress = 100;
                eventType = "approved";
                eventMessage = string.IsNullOrWhiteSpace(message)
                    ? $"Le client a validé l'étape « {milestone.Title} »."
                    : message!;
                break;

            case "request-changes":
                if (!isOwner)
                {
                    throw new ForbiddenException("Seul le client propriétaire peut demander des modifications.");
                }
                if (string.IsNullOrWhiteSpace(message) || message.Length < 5)
                {
                    throw new ConflictException("Expliquez les modifications attendues (au moins 5 caractères).");
                }
                milestone.Status = MilestoneStatus.ChangesRequested;
                milestone.Progress = Math.Min(milestone.Progress, 90);
                eventType = "changes-requested";
                eventMessage = message;
                break;

            case "comment":
                if (string.IsNullOrWhiteSpace(message))
                {
                    throw new ConflictException("Le message est obligatoire.");
                }
                eventType = "comment";
                eventMessage = message;
                break;

            default:
                throw new ConflictException("Action de milestone inconnue.");
        }

        milestone.UpdatedAt = now;
        project.UpdatedAt = now;
        ProjectMilestoneWorkflow.AppendHistory(
            project,
            eventType,
            eventMessage,
            user.Id,
            DisplayName(user),
            user.Role,
            now,
            milestone);

        var filter = Builders<Project>.Filter.And(
            Builders<Project>.Filter.Eq(p => p.Id, project.Id),
            Builders<Project>.Filter.Eq(p => p.Status, previousStatus));

        var result = await Projects.ReplaceOneAsync(filter, project, cancellationToken: cancellationToken);
        if (result.MatchedCount == 0)
        {
            throw new ConflictException("Ce projet a été modifié entre-temps. Rechargez-le puis réessayez.");
        }

        if (movesBackToProgress && !string.IsNullOrWhiteSpace(project.AssignedTo))
        {
            await Notifications.InsertOneAsync(new Notification
            {
                RecipientId = project.AssignedTo,
                Type = "project-revision-requested",
                Title = project.Title,
                Message = $"Le client a demandé des modifications sur « {project.Title} » : {message}",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.Client,
                CreatedAt = now,
            }, cancellationToken: cancellationToken);
        }

        if (action == "approve"
            && !string.IsNullOrWhiteSpace(project.AssignedTo)
            && project.AssignedTo != userId)
        {
            await Notifications.InsertOneAsync(new Notification
            {
                RecipientId = project.AssignedTo,
                Type = "milestone-approved",
                Title = project.Title,
                Message = $"Le client a validé l'étape « {milestone.Title} » du projet « {project.Title} ».",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = project.Client,
                CreatedAt = now,
            }, cancellationToken: cancellationToken);
        }

        return ToResponse(project);
    }

    /// <summary>Ajoute une étape personnalisée au projet (client propriétaire).</summary>
    public async Task<ProjectResponse> AddMilestoneAsync(
        string ownerId,
        string projectId,
        CreateMilestoneRequest request,
        CancellationToken cancellationToken)
    {
        var author = await EnsureClientAsync(ownerId, cancellationToken);
        var project = await FindOwnedAsync(ownerId, projectId, cancellationToken);

        var title = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            throw new ConflictException("Le titre de l'étape est obligatoire.");
        }

        var now = DateTime.UtcNow;
        project.Milestones ??= [];
        var milestone = new ProjectMilestone
        {
            Key = string.Empty,
            Title = title,
            Status = MilestoneStatus.Pending,
            Progress = 0,
            Date = request.Date,
            CreatedAt = now,
            UpdatedAt = now,
        };
        project.Milestones.Add(milestone);
        project.UpdatedAt = now;
        ProjectMilestoneWorkflow.AppendHistory(
            project,
            "milestone-status",
            $"Nouvelle étape ajoutée : « {title} ».",
            author.Id,
            DisplayName(author),
            author.Role,
            now,
            milestone);

        var filter = Builders<Project>.Filter.And(
            Builders<Project>.Filter.Eq(p => p.Id, project.Id),
            Builders<Project>.Filter.Eq(p => p.OwnerId, ownerId));
        await Projects.ReplaceOneAsync(filter, project, cancellationToken: cancellationToken);

        return ToResponse(project);
    }

    /// <summary>
    /// Garantit qu'un projet existant dispose des étapes standard, y compris
    /// lorsqu'il a été créé avant l'introduction des milestones. L'écriture est
    /// additive : aucune étape ni aucun historique existant n'est supprimé.
    /// </summary>
    private async Task<Project> EnsureMilestonesAsync(Project project, CancellationToken cancellationToken)
    {
        if (project.Milestones is { Count: > 0 })
        {
            return project;
        }

        var now = DateTime.UtcNow;
        project.Milestones ??= [];
        ProjectMilestoneWorkflow.Sync(project, null, project.Status, now);

        await Projects.UpdateOneAsync(
            item => item.Id == project.Id,
            Builders<Project>.Update.Set(item => item.Milestones, project.Milestones),
            cancellationToken: cancellationToken);

        return project;
    }

    private async Task<List<Project>> EnsureMilestonesAsync(List<Project> projects, CancellationToken cancellationToken)
    {
        foreach (var project in projects.Where(item => item.Milestones is null || item.Milestones.Count == 0))
        {
            await EnsureMilestonesAsync(project, cancellationToken);
        }

        return projects;
    }

    public async System.Threading.Tasks.Task DeleteAsync(string ownerId, string projectId, CancellationToken cancellationToken)
    {
        await FindOwnedAsync(ownerId, projectId, cancellationToken);
        await Projects.DeleteOneAsync(p => p.Id == projectId && p.OwnerId == ownerId, cancellationToken);

        // Les candidatures sont dénormalisées (titre, statut, propriétaire) :
        // elles sont supprimées avec le projet pour ne laisser aucune candidature
        // orpheline dans la liste « reçues » du client.
        await Proposals.DeleteManyAsync(p => p.ProjectId == projectId, cancellationToken);
    }

    /// <summary>
    /// Récupère un projet appartenant au compte connecté. Exposé à
    /// <see cref="ProposalService"/> : l'acceptation d'une candidature réutilise
    /// exactement le même contrôle de propriété que la mise à jour d'un projet.
    /// </summary>
    public async Task<Project> GetOwnedAsync(string ownerId, string projectId, CancellationToken cancellationToken) =>
        await FindOwnedAsync(ownerId, projectId, cancellationToken);

    /// <summary>
    /// Réclame atomiquement l'affectation d'un projet au freelance donné.
    /// L'écriture n'aboutit que si le projet est toujours « Open » et non
    /// attribué (ou déjà attribué au même freelance) : deux acceptations
    /// concurrentes ne peuvent donc pas attribuer le projet à deux freelances
    /// différents. La méthode renvoie false lorsque l'écriture n'a pas
    /// abouti, sans modifier le projet.
    /// </summary>
    public async Task<bool> TryClaimAssignmentAsync(Project project, string freelancerId, CancellationToken cancellationToken)
    {
        var filter = Builders<Project>.Filter.And(
            Builders<Project>.Filter.Eq(p => p.Id, project.Id),
            Builders<Project>.Filter.Eq(p => p.OwnerId, project.OwnerId),
            Builders<Project>.Filter.Eq(p => p.Status, ProjectStatus.Open),
            Builders<Project>.Filter.Or(
                Builders<Project>.Filter.Eq(p => p.AssignedTo, (string?)null),
                Builders<Project>.Filter.Eq(p => p.AssignedTo, freelancerId)));

        var result = await Projects.ReplaceOneAsync(filter, project, cancellationToken: cancellationToken);
        return result.MatchedCount == 1;
    }

    /// <summary>
    /// Ajuste le compteur de propositions d'un projet lors du dépôt ou du
    /// retrait d'une candidature. L'incrémentation est atomique ; le compte ne
    /// descend jamais sous zéro : il reflète le nombre de candidatures actives.
    /// </summary>
    public async System.Threading.Tasks.Task AddProposalsAsync(string projectId, int delta, CancellationToken cancellationToken)
    {
        if (delta == 0)
        {
            return;
        }

        if (delta > 0)
        {
            await Projects.UpdateOneAsync(
                p => p.Id == projectId,
                Builders<Project>.Update.Inc(p => p.Proposals, delta),
                cancellationToken: cancellationToken);
            return;
        }

        var project = await Projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken);
        if (project is null)
        {
            return;
        }

        var next = Math.Max(0, project.Proposals + delta);
        if (next == project.Proposals)
        {
            return;
        }

        await Projects.UpdateOneAsync(
            p => p.Id == projectId,
            Builders<Project>.Update.Set(p => p.Proposals, next),
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Seul un compte client peut publier et gérer des projets. Le rôle est relu
    /// en base (source de vérité) et non déduit d'une valeur fournie par le
    /// client. La modification et la suppression restent, elles, réservées au
    /// propriétaire du projet.
    /// </summary>
    private async System.Threading.Tasks.Task<User> EnsureClientAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(item => item.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (!string.Equals(user.Role, UserRole.Client, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seuls les clients peuvent gérer leurs projets.");
        }

        return user;
    }

    /// <summary>
    /// Seul un compte freelance peut consulter les projets qui lui sont confiés.
    /// </summary>
    private async System.Threading.Tasks.Task<User> EnsureFreelancerAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(item => item.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (!string.Equals(user.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seuls les freelancers peuvent consulter les projets qui leur sont confiés.");
        }

        return user;
    }

    /// <summary>
    /// Applique (ou retire) l'approbation d'un freelance. Le freelance visé doit
    /// exister et avoir le rôle freelance : un client ne peut pas approuver un
    /// compte qui n'en est pas un.
    /// </summary>
    public async System.Threading.Tasks.Task ApplyAssignmentAsync(Project project, string assignedTo, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(assignedTo))
        {
            project.AssignedTo = null;
            project.AssignedToName = null;
            project.AssignedAt = null;
            return;
        }

        if (!MongoDB.Bson.ObjectId.TryParse(assignedTo.Trim(), out _))
        {
            throw new NotFoundException("Freelance introuvable.");
        }

        var user = await Users.Find(item => item.Id == assignedTo.Trim()).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Freelance introuvable.");

        if (!string.Equals(user.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seul un compte freelance peut être approuvé sur un projet.");
        }

        project.AssignedTo = user.Id;
        project.AssignedToName = $"{user.FirstName} {user.LastName}".Trim();
        project.AssignedAt = DateTime.UtcNow;
    }

    // Récupère un projet uniquement s'il appartient à l'utilisateur authentifié.
    // Un identifiant invalide ou un projet appartenant à un autre utilisateur
    // renvoie le même 404 : aucune information n'est divulguée.
    private async Task<Project> FindOwnedAsync(string ownerId, string projectId, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(projectId, out _))
        {
            throw new NotFoundException("Projet introuvable.");
        }

        var project = await Projects
            .Find(p => p.Id == projectId && p.OwnerId == ownerId)
            .FirstOrDefaultAsync(cancellationToken);

        return project ?? throw new NotFoundException("Projet introuvable.");
    }

    private async Task<Project> FindAsync(string projectId, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(projectId, out _))
        {
            throw new NotFoundException("Projet introuvable.");
        }

        var project = await Projects
            .Find(p => p.Id == projectId)
            .FirstOrDefaultAsync(cancellationToken);

        return project ?? throw new NotFoundException("Projet introuvable.");
    }

    /// <summary>
    /// Ajoute une trace à l'historique des affectations libérées. L'historique
    /// est append-only : une entrée existante n'est jamais modifiée ni
    /// supprimée, afin de conserver la trace des freelances qui ont
    /// précédemment travaillé sur le projet.
    /// </summary>
    private static void AppendAssignmentHistory(
        Project project,
        string freelancerId,
        string? freelancerName,
        DateTime? assignedAt,
        string reason,
        DateTime releasedAt)
    {
        project.AssignmentHistory ??= [];

        // Une même affectation ne doit pas être tracée deux fois : on évite
        // les doublons quand la libération est rejouée sur le même freelance.
        var alreadyTraced = project.AssignmentHistory.Any(entry =>
            string.Equals(entry.FreelancerId, freelancerId, StringComparison.Ordinal)
            && string.Equals(entry.Reason, reason, StringComparison.Ordinal)
            && entry.ReleasedAt.HasValue
            && Math.Abs((entry.ReleasedAt.Value - releasedAt).TotalSeconds) < 1);

        if (alreadyTraced)
        {
            return;
        }

        project.AssignmentHistory.Add(new AssignmentHistoryEntry
        {
            FreelancerId = freelancerId,
            FreelancerName = freelancerName ?? string.Empty,
            AssignedAt = assignedAt,
            ReleasedAt = releasedAt,
            Reason = reason,
        });
    }

    /// <summary>
    /// Compte les propositions actives d'un projet. Le compteur du projet est
    /// recalculé à partir de cette valeur afin de refléter toujours l'état
    /// réel des candidatures (après annulation d'une acceptation, par
    /// exemple). Les propositions retirées ou annulées ne sont pas comptées.
    /// <paramref name="excludeProposalId"/> permet d'exclure une proposition
    /// qui va être annulée dans le même traitement.
    /// </summary>
    private async Task<int> CountProposalsAsync(
        string projectId,
        CancellationToken cancellationToken,
        string? excludeProposalId = null)
    {
        var filter = Builders<Proposal>.Filter.Eq(p => p.ProjectId, projectId)
            & Builders<Proposal>.Filter.Ne(p => p.Status, ProposalStatus.Withdrawn)
            & Builders<Proposal>.Filter.Ne(p => p.Status, ProposalStatus.Cancelled);

        if (!string.IsNullOrWhiteSpace(excludeProposalId))
        {
            filter &= Builders<Proposal>.Filter.Ne(p => p.Id, excludeProposalId);
        }

        // CountDocumentsAsync renvoie un long : le compteur du projet est un int.
        return (int)await Proposals.CountDocumentsAsync(filter, cancellationToken: cancellationToken);
    }

    private static string DisplayName(User user)
    {
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return name.Length > 0 ? name : user.Email;
    }

    private static string DescribeStatusChange(string from, string to) =>
        $"Statut du projet : {from} → {to}.";

    private static bool MatchesBudget(Project project, decimal? minBudget, decimal? maxBudget)
    {
        var range = GetBudgetRange(project);
        if (range is null) return false;
        if (minBudget.HasValue && range.Value.Max < minBudget.Value) return false;
        if (maxBudget.HasValue && range.Value.Min > maxBudget.Value) return false;
        return true;
    }

    private static (decimal Min, decimal Max)? GetBudgetRange(Project project)
    {
        if (project.BudgetMin.HasValue || project.BudgetMax.HasValue)
        {
            var min = project.BudgetMin ?? project.BudgetMax ?? 0m;
            var max = project.BudgetMax ?? project.BudgetMin ?? 0m;
            return min <= max ? (min, max) : (max, min);
        }

        var numbers = Regex.Matches(project.Budget ?? string.Empty, @"\d[\d.,\s]*")
            .Select(match => ParseBudgetNumber(match.Value))
            .Where(value => value.HasValue)
            .Select(value => value!.Value)
            .OrderBy(value => value)
            .ToList();

        if (numbers.Count == 0) return null;
        return (numbers.First(), numbers.Last());
    }

    private static decimal? ParseBudgetNumber(string raw)
    {
        var cleaned = raw.Replace(" ", string.Empty).Replace(",", string.Empty).Trim();
        return decimal.TryParse(cleaned, NumberStyles.Number, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;
    }

    private static bool MatchesDuration(Project project, int? value, string? unit)
    {
        var normalizedUnit = NormalizeDurationUnit(unit);
        if (value.HasValue && !string.IsNullOrWhiteSpace(unit))
        {
            var requestedDays = ToDays(value.Value, normalizedUnit);
            var projectDays = ToDays(project.DurationValue, NormalizeDurationUnit(project.DurationUnit));
            return requestedDays.HasValue && projectDays.HasValue && projectDays.Value <= requestedDays.Value;
        }

        if (!string.IsNullOrWhiteSpace(unit))
        {
            return string.Equals(
                NormalizeDurationUnit(project.DurationUnit),
                normalizedUnit,
                StringComparison.OrdinalIgnoreCase);
        }

        if (value.HasValue)
        {
            return project.DurationValue == value.Value;
        }

        return true;
    }

    private static string? NormalizeDurationUnit(string? unit) => unit?.Trim().ToLowerInvariant() switch
    {
        "day" or "days" => "days",
        "week" or "weeks" => "weeks",
        "month" or "months" => "months",
        _ => null,
    };

    private static double? ToDays(int? value, string? unit)
    {
        if (!value.HasValue || unit is null) return null;
        var factor = unit switch
        {
            "days" => 1,
            "weeks" => 7,
            "months" => 30,
            _ => 0,
        };
        return factor == 0 ? null : value.Value * factor;
    }

    private static List<string> NormalizeSkills(IEnumerable<string> skills) =>
        skills.Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToList();

    private static List<ProjectAttachment> DedupAttachments(IEnumerable<ProjectAttachmentRequest> incoming)
    {
        var seenUrls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var deduped = new List<ProjectAttachment>();
        foreach (var item in incoming)
        {
            if (string.IsNullOrWhiteSpace(item.Url)) continue;
            var url = item.Url.Trim();
            if (seenUrls.Add(url))
            {
                deduped.Add(new ProjectAttachment
                {
                    FileName = item.FileName?.Trim() ?? string.Empty,
                    Url = url,
                    Size = item.Size,
                    UploadedAt = item.UploadedAt ?? DateTime.UtcNow,
                });
            }
        }
        return deduped;
    }

    public static ProjectResponse ToResponse(Project project) => new()
    {
        Id = project.Id,
        OwnerId = project.OwnerId,
        Title = project.Title,
        Description = project.Description,
        Budget = project.Budget,
        Type = project.Type,
        BudgetMin = project.BudgetMin,
        BudgetMax = project.BudgetMax,
        DurationValue = project.DurationValue,
        DurationUnit = project.DurationUnit,
        Proposals = project.Proposals,
        Skills = project.Skills,
        Client = project.Client,
        Status = project.Status,
        Category = project.Category,
        Deadline = project.Deadline,
        AssignedTo = project.AssignedTo,
        AssignedToName = project.AssignedToName,
        AssignedAt = project.AssignedAt,
        AssignmentHistory = (project.AssignmentHistory ?? [])
            .Select(entry => new AssignmentHistoryEntryResponse
            {
                FreelancerId = entry.FreelancerId,
                FreelancerName = entry.FreelancerName,
                AssignedAt = entry.AssignedAt,
                ReleasedAt = entry.ReleasedAt,
                Reason = entry.Reason,
            })
            .ToList(),
        Milestones = (project.Milestones ?? [])
            .Select(milestone => new ProjectMilestoneResponse
            {
                Id = milestone.Id,
                Key = milestone.Key,
                Title = milestone.Title,
                Status = milestone.Status,
                Progress = milestone.Progress,
                Date = milestone.Date,
                CreatedAt = milestone.CreatedAt,
                UpdatedAt = milestone.UpdatedAt,
            })
            .ToList(),
        MilestoneHistory = (project.MilestoneHistory ?? [])
            .Select(entry => new MilestoneHistoryEntryResponse
            {
                Id = entry.Id,
                MilestoneId = entry.MilestoneId,
                MilestoneTitle = entry.MilestoneTitle,
                Type = entry.Type,
                Message = entry.Message,
                AuthorId = entry.AuthorId,
                AuthorName = entry.AuthorName,
                AuthorRole = entry.AuthorRole,
                CreatedAt = entry.CreatedAt,
            })
            .ToList(),
        Attachments = (project.Attachments ?? [])
            .Select(a => new ProjectAttachmentResponse
            {
                FileName = a.FileName,
                Url = a.Url,
                Size = a.Size,
                UploadedAt = a.UploadedAt,
            })
            .ToList(),
        CreatedAt = project.CreatedAt,
        UpdatedAt = project.UpdatedAt,
    };
}
