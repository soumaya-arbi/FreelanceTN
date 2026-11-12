using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Proposals;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Candidatures des freelances sur les projets publiés. Un freelance
/// authentifié peut candidater à un projet qui lui appartient ; le client
/// propriétaire peut accepter ou refuser. L'acceptation réutilise le mécanisme
/// d'affectation existant (<see cref="ProjectService.ApplyAssignmentAsync"/>)
/// et maintient la cohérence du projet : le projet passe « In progress » et
/// quitte le catalogue des opportunités, les autres candidatures en attente
/// sont refusées, et le compteur <see cref="Project.Proposals"/> reste aligné
/// sur le nombre de candidatures actives.
/// </summary>
public class ProposalService
{
    private readonly MongoContext _mongo;
    private readonly ProjectService _projects;

    public ProposalService(MongoContext mongo, ProjectService projects)
    {
        _mongo = mongo;
        _projects = projects;
    }

    private IMongoCollection<Proposal> Proposals =>
        _mongo.GetCollection<Proposal>(_mongo.Settings.ProposalsCollection);

    private IMongoCollection<User> Users =>
        _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);

    private IMongoCollection<PortfolioItem> Portfolio =>
        _mongo.GetCollection<PortfolioItem>(_mongo.Settings.PortfolioCollection);

    private IMongoCollection<Notification> Notifications =>
        _mongo.GetCollection<Notification>(_mongo.Settings.NotificationsCollection);

    /// <summary>
    /// Dépose une candidature. Le freelance et le propriétaire du projet sont
    /// toujours dérivés de la session et du document projet : rien n'est pris
    /// au mot côté client.
    /// </summary>
    public async Task<ProposalResponse> CreateAsync(
        string freelancerId,
        CreateProposalRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(freelancerId, cancellationToken);

        var project = await _projects.GetAsync(freelancerId, request.ProjectId.Trim(), cancellationToken);

        // Un client ne peut pas candidater à son propre projet : le contrôleur
        // n'applique pas EnsureClientAsync ici, donc on le vérifie explicitement.
        if (project.OwnerId == freelancerId)
        {
            throw new ForbiddenException("Vous ne pouvez pas candidater sur un projet qui vous appartient.");
        }

        if (!ProjectStatus.IsPublished(project.Status))
        {
            throw new ConflictException("Ce projet n'est plus ouvert aux candidatures.");
        }

        if (project.AssignedTo is not null)
        {
            throw new ConflictException("Ce projet a déjà été attribué à un freelance.");
        }

        var duplicate = await Proposals
            .Find(proposal => proposal.ProjectId == project.Id && proposal.FreelancerId == freelancerId)
            .FirstOrDefaultAsync(cancellationToken);

        if (duplicate is not null)
        {
            throw new ConflictException("Vous avez déjà déposé une candidature sur ce projet.");
        }

        var freelancer = await Users.Find(item => item.Id == freelancerId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        var portfolioId = await ValidatePortfolioIdAsync(freelancerId, request.PortfolioId, cancellationToken);

        var now = DateTime.UtcNow;
        var proposal = new Proposal
        {
            ProjectId = project.Id,
            ProjectTitle = project.Title,
            ProjectBudget = project.Budget,
            ProjectType = project.Type,
            ProjectStatus = project.Status,
            ProjectOwnerId = project.OwnerId,
            FreelancerId = freelancer.Id,
            FreelancerName = $"{freelancer.FirstName} {freelancer.LastName}".Trim(),
            FreelancerTitle = freelancer.Title,
            CoverLetter = request.CoverLetter.Trim(),
            Price = request.Price.Trim(),
            Delivery = request.Delivery.Trim(),
            PortfolioId = portfolioId,
            Status = ProposalStatus.Pending,
            CreatedAt = now,
            UpdatedAt = now,
        };

        try
        {
            await Proposals.InsertOneAsync(proposal, cancellationToken: cancellationToken);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Course possible entre le contrôle de doublon ci-dessus et l'insertion :
            // l'index unique (projectId, freelancerId) fait autorité.
            throw new ConflictException("Vous avez déjà déposé une candidature sur ce projet.");
        }

        // Compteur de propositions aligné sur le nombre réel de candidatures.
        // Opération atomique : pas de lecture-écriture non concurrente.
        await _projects.AddProposalsAsync(project.Id, 1, cancellationToken);

        // Notification au client propriétaire du projet.
        if (!string.IsNullOrWhiteSpace(project.OwnerId) && project.OwnerId != freelancerId)
        {
            var notification = new Notification
            {
                RecipientId = project.OwnerId,
                Type = "proposal",
                Title = project.Title,
                Message = $"Nouvelle proposition reçue pour « {project.Title} » de {freelancer.FirstName} {freelancer.LastName}.",
                ProjectId = project.Id,
                TaskTitle = string.Empty,
                ProjectTitle = project.Title,
                ActorName = $"{freelancer.FirstName} {freelancer.LastName}".Trim(),
                CreatedAt = DateTime.UtcNow,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        return ToResponse(proposal);
    }

    /// <summary>Candidatures déposées par le freelance connecté.</summary>
    public async Task<List<ProposalResponse>> ListMineAsync(string freelancerId, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(freelancerId, cancellationToken);

        var proposals = await Proposals
            .Find(proposal => proposal.FreelancerId == freelancerId)
            .SortByDescending(proposal => proposal.CreatedAt)
            .ToListAsync(cancellationToken);

        return proposals.Select(ToResponse).ToList();
    }

    /// <summary>Candidatures reçues par le client connecté, sur ses projets uniquement.</summary>
    public async Task<List<ProposalResponse>> ListReceivedAsync(string clientId, string? projectId, CancellationToken cancellationToken)
    {
        await EnsureClientAsync(clientId, cancellationToken);

        var filter = Builders<Proposal>.Filter.Eq(proposal => proposal.ProjectOwnerId, clientId);
        // Le filtre par projet reste borné au propriétaire : un identifiant de
        // projet fourni par le client ne peut jamais élargir la portée.
        if (!string.IsNullOrWhiteSpace(projectId))
        {
            filter &= Builders<Proposal>.Filter.Eq(proposal => proposal.ProjectId, projectId.Trim());
        }

        var proposals = await Proposals
            .Find(filter)
            .SortByDescending(proposal => proposal.CreatedAt)
            .ToListAsync(cancellationToken);

        return proposals.Select(ToResponse).ToList();
    }

    /// <summary>
    /// Consultation d'une candidature : réservée à son auteur et au propriétaire
    /// du projet concerné. Toute autre demande reçoit le même 404 afin de ne rien
    /// divulguer sur l'existence du document.
    /// </summary>
    public async Task<ProposalResponse> GetAsync(string requesterId, string proposalId, CancellationToken cancellationToken)
    {
        var proposal = await FindAsync(proposalId, cancellationToken);

        if (proposal.FreelancerId != requesterId && proposal.ProjectOwnerId != requesterId)
        {
            throw new NotFoundException("Candidature introuvable.");
        }

        return ToResponse(proposal);
    }

    /// <summary>
    /// Décision du client sur une candidature. L'acceptation réutilise le
    /// mécanisme d'affectation existant et impose la cohérence du projet : le
    /// projet doit toujours être disponible, un seul freelance peut être retenu,
    /// et les autres candidatures en attente sont refusées.
    /// </summary>
    public async Task<ProposalResponse> ReviewAsync(
        string clientId,
        string proposalId,
        string status,
        CancellationToken cancellationToken)
    {
        await EnsureClientAsync(clientId, cancellationToken);

        var proposal = await FindAsync(proposalId, cancellationToken);

        if (proposal.ProjectOwnerId != clientId)
        {
            throw new NotFoundException("Candidature introuvable.");
        }

        if (!string.Equals(proposal.Status, ProposalStatus.Pending, StringComparison.OrdinalIgnoreCase))
        {
            throw new ConflictException($"Cette candidature a déjà été traitée (statut « {proposal.Status} »).");
        }

        var decision = ProposalStatus.Normalize(status);

        // Statut attendu de la candidature : l'écriture finale est
        // conditionnelle, afin qu'une décision concurrente (ou une annulation
        // d'acceptation) ne soit jamais écrasée.
        var expectedStatus = proposal.Status;

        if (string.Equals(decision, ProposalStatus.Accepted, StringComparison.Ordinal))
        {
            await AcceptAsync(clientId, proposal, cancellationToken);
        }
        else
        {
            proposal.Status = ProposalStatus.Refused;
        }

        proposal.UpdatedAt = DateTime.UtcNow;
        var updateResult = await Proposals.ReplaceOneAsync(
            item => item.Id == proposal.Id && item.Status == expectedStatus,
            proposal,
            cancellationToken: cancellationToken);

        if (updateResult.MatchedCount == 0)
        {
            throw new ConflictException($"Cette candidature a déjà été traitée (statut « {expectedStatus} »).");
        }

        // Notification au freelance concerné.
        if (!string.IsNullOrWhiteSpace(proposal.FreelancerId) && proposal.FreelancerId != clientId)
        {
            var isAccepted = string.Equals(proposal.Status, ProposalStatus.Accepted, StringComparison.OrdinalIgnoreCase);
            var notification = new Notification
            {
                RecipientId = proposal.FreelancerId,
                Type = isAccepted ? "proposal-accepted" : "proposal-refused",
                Title = proposal.ProjectTitle,
                Message = isAccepted
                    ? $"Votre proposition pour « {proposal.ProjectTitle} » a été acceptée."
                    : $"Votre proposition pour « {proposal.ProjectTitle} » a été refusée.",
                ProjectId = proposal.ProjectId,
                TaskTitle = string.Empty,
                ProjectTitle = proposal.ProjectTitle,
                ActorName = string.Empty,
                CreatedAt = DateTime.UtcNow,
            };
            await Notifications.InsertOneAsync(notification, cancellationToken: cancellationToken);
        }

        return ToResponse(proposal);
    }

    /// <summary>
    /// Retrait d'une propre candidature par son auteur. Une candidature déjà
    /// acceptée ne peut pas être retirée : le projet a été attribué.
    /// </summary>
    public async System.Threading.Tasks.Task DeleteAsync(string freelancerId, string proposalId, CancellationToken cancellationToken)
    {
        await EnsureFreelancerAsync(freelancerId, cancellationToken);

        var proposal = await Proposals
            .Find(item => item.Id == proposalId && item.FreelancerId == freelancerId)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Candidature introuvable.");

        if (string.Equals(proposal.Status, ProposalStatus.Accepted, StringComparison.OrdinalIgnoreCase))
        {
            throw new ConflictException("Une candidature acceptée ne peut pas être retirée : le projet vous a été attribué.");
        }

        await Proposals.DeleteOneAsync(item => item.Id == proposal.Id, cancellationToken: cancellationToken);

        // Le compteur du projet ne compte que les candidatures actives.
        await _projects.AddProposalsAsync(proposal.ProjectId, -1, cancellationToken);
    }

    // --- Logique interne ---------------------------------------------------

    /// <summary>Acceptation : affecte le freelance et aligne le projet.</summary>
    private async System.Threading.Tasks.Task AcceptAsync(string clientId, Proposal proposal, CancellationToken cancellationToken)
    {
        var project = await _projects.GetOwnedAsync(clientId, proposal.ProjectId, cancellationToken);

        // Le projet doit toujours être disponible : il peut avoir été dépublié,
        // clôturé ou attribué entre-temps.
        if (!ProjectStatus.IsPublished(project.Status))
        {
            throw new ConflictException("Ce projet n'est plus ouvert : impossible d'accepter cette candidature.");
        }

        if (project.AssignedTo is not null &&
            !string.Equals(project.AssignedTo, proposal.FreelancerId, StringComparison.Ordinal))
        {
            throw new ConflictException("Ce projet a déjà été attribué à un autre freelance.");
        }

        // Réutilisation du mécanisme d'affectation existant : contrôle du rôle
        // du freelance visé, renseignement de assignedTo / assignedToName /
        // assignedAt.
        await _projects.ApplyAssignmentAsync(project, proposal.FreelancerId, cancellationToken);

        // Cohérence du projet : un projet attribué sort du catalogue des
        // opportunités et entre en cours d'exécution. La transition « Open »
        // vers « In progress » est autorisée par la machine à états.
        ProjectMilestoneWorkflow.Sync(project, project.Status, ProjectStatus.InProgress, DateTime.UtcNow);
        project.Status = ProjectStatus.InProgress;
        project.UpdatedAt = DateTime.UtcNow;

        // Réclamation atomique du projet : l'écriture n'aboutit que si le
        // projet est toujours « Open » et non attribué à un autre freelance.
        // Deux acceptations concurrentes ne peuvent donc pas attribuer le
        // projet à deux freelances différents.
        var claimed = await _projects.TryClaimAssignmentAsync(project, proposal.FreelancerId, cancellationToken);
        if (!claimed)
        {
            throw new ConflictException("Ce projet a déjà été attribué à un autre freelance.");
        }

        proposal.Status = ProposalStatus.Accepted;
        proposal.ProjectStatus = project.Status;

        // Un seul freelance retenu : les autres candidatures en attente du même
        // projet sont refusées pour ne pas laisser une liste périmée.
        await Proposals.UpdateManyAsync(
            item => item.ProjectId == proposal.ProjectId
                && item.Id != proposal.Id
                && item.Status == ProposalStatus.Pending,
            Builders<Proposal>.Update
                .Set(item => item.Status, ProposalStatus.Refused)
                .Set(item => item.UpdatedAt, DateTime.UtcNow),
            cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Une candidature ne peut référencer qu'une réalisation publiée et
    /// partageable du freelance qui candidate. Un identifiant inconnu renvoie
    /// 404 et une réalisation d'un autre freelance reste inaccessible.
    /// </summary>
    private async Task<string?> ValidatePortfolioIdAsync(
        string freelancerId,
        string? portfolioId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(portfolioId)) return null;

        var normalized = portfolioId.Trim();
        if (!MongoDB.Bson.ObjectId.TryParse(normalized, out _))
        {
            throw new NotFoundException("Réalisation introuvable.");
        }

        var item = await Portfolio.Find(entry => entry.Id == normalized).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Réalisation introuvable.");

        if (!string.Equals(item.OwnerId, freelancerId, StringComparison.Ordinal))
        {
            throw new ForbiddenException("Cette réalisation ne vous appartient pas.");
        }

        if (!item.Published || string.Equals(item.Visibility, PortfolioVisibility.Private, StringComparison.Ordinal))
        {
            throw new ConflictException("Cette réalisation n'est pas publiée pour les clients.");
        }

        return normalized;
    }

    private async Task<Proposal> FindAsync(string proposalId, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(proposalId, out _))
        {
            throw new NotFoundException("Candidature introuvable.");
        }

        return await Proposals.Find(item => item.Id == proposalId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Candidature introuvable.");
    }

    /// <summary>Seul un compte freelance peut candidater.</summary>
    private async System.Threading.Tasks.Task EnsureFreelancerAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(item => item.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (!string.Equals(user.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seuls les freelancers peuvent déposer des candidatures.");
        }
    }

    /// <summary>Seul un compte client peut statuer sur les candidatures reçues.</summary>
    private async System.Threading.Tasks.Task EnsureClientAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await Users.Find(item => item.Id == userId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (!string.Equals(user.Role, UserRole.Client, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Seuls les clients peuvent examiner les candidatures.");
        }
    }

    private static ProposalResponse ToResponse(Proposal proposal) => new()
    {
        Id = proposal.Id,
        ProjectId = proposal.ProjectId,
        ProjectTitle = proposal.ProjectTitle,
        ProjectBudget = proposal.ProjectBudget,
        ProjectType = proposal.ProjectType,
        ProjectStatus = proposal.ProjectStatus,
        ProjectOwnerId = proposal.ProjectOwnerId,
        FreelancerId = proposal.FreelancerId,
        FreelancerName = proposal.FreelancerName,
        FreelancerTitle = proposal.FreelancerTitle,
        CoverLetter = proposal.CoverLetter,
        Price = proposal.Price,
        Delivery = proposal.Delivery,
        PortfolioId = proposal.PortfolioId,
        Status = proposal.Status,
        CreatedAt = proposal.CreatedAt,
        UpdatedAt = proposal.UpdatedAt,
    };
}
