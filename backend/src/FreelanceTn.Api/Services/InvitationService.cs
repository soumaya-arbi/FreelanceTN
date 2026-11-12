using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Invitations;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Driver;
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Services;

public class InvitationService
{
    private readonly MongoContext _mongo;
    private readonly ProjectService _projects;

    public InvitationService(MongoContext mongo, ProjectService projects)
    {
        _mongo = mongo;
        _projects = projects;
    }

    private IMongoCollection<Invitation> Invitations => _mongo.GetCollection<Invitation>(_mongo.Settings.InvitationsCollection);
    private IMongoCollection<User> Users => _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);
    private IMongoCollection<Notification> Notifications => _mongo.GetCollection<Notification>(_mongo.Settings.NotificationsCollection);

    public async Task<InvitationResponse> CreateAsync(string clientId, CreateInvitationRequest request, CancellationToken ct)
    {
        await EnsureClientAsync(clientId, ct);
        var project = await _projects.GetOwnedAsync(clientId, request.ProjectId.Trim(), ct);
        if (!ProjectStatus.IsPublished(project.Status))
            throw new ConflictException("Le projet doit être publié pour inviter un freelance.");
        if (project.AssignedTo is not null)
            throw new ConflictException("Ce projet est déjà attribué.");

        var freelancer = await Users.Find(u => u.Id == request.FreelancerId.Trim()).FirstOrDefaultAsync(ct)
            ?? throw new NotFoundException("Freelance introuvable.");
        if (!string.Equals(freelancer.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase))
            throw new ForbiddenException("Seul un compte freelance peut être invité.");

        // Doublon : une invitation pending déjà existante pour ce couple.
        var existing = await Invitations.Find(i => i.ProjectId == project.Id && i.FreelancerId == freelancer.Id && i.Status == InvitationStatus.Pending).FirstOrDefaultAsync(ct);
        if (existing is not null)
            throw new ConflictException("Une invitation est déjà en attente pour ce freelance sur ce projet.");

        var client = await Users.Find(u => u.Id == clientId).FirstOrDefaultAsync(ct)
            ?? throw new UnauthorizedException("Session invalide.");

        var invitation = new Invitation
        {
            ProjectId = project.Id,
            ProjectTitle = project.Title,
            ClientId = clientId,
            ClientName = $"{client.FirstName} {client.LastName}".Trim(),
            FreelancerId = freelancer.Id,
            FreelancerName = $"{freelancer.FirstName} {freelancer.LastName}".Trim(),
            Message = request.Message.Trim(),
            OfferedPrice = string.IsNullOrWhiteSpace(request.OfferedPrice) ? null : request.OfferedPrice.Trim(),
            OfferedDelivery = string.IsNullOrWhiteSpace(request.OfferedDelivery) ? null : request.OfferedDelivery.Trim(),
            Status = InvitationStatus.Pending,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(7),
        };
        await Invitations.InsertOneAsync(invitation, cancellationToken: ct);

        // Notification au freelance.
        var notif = new Notification
        {
            RecipientId = freelancer.Id,
            Type = "invitation",
            Title = project.Title,
            Message = $"Vous avez reçu une invitation pour le projet « {project.Title} ».",
            ProjectId = project.Id,
            TaskTitle = string.Empty,
            ProjectTitle = project.Title,
            ActorName = invitation.ClientName,
            CreatedAt = DateTime.UtcNow,
        };
        await Notifications.InsertOneAsync(notif, cancellationToken: ct);

        return ToResponse(invitation);
    }

    public async Task<List<InvitationResponse>> ListForFreelancerAsync(string freelancerId, CancellationToken ct)
    {
        await EnsureFreelancerAsync(freelancerId, ct);
        var items = await Invitations.Find(i => i.FreelancerId == freelancerId).SortByDescending(i => i.CreatedAt).ToListAsync(ct);
        return items.Select(ToResponse).ToList();
    }

    public async Task<List<InvitationResponse>> ListForClientAsync(string clientId, CancellationToken ct)
    {
        await EnsureClientAsync(clientId, ct);
        var items = await Invitations.Find(i => i.ClientId == clientId).SortByDescending(i => i.CreatedAt).ToListAsync(ct);
        return items.Select(ToResponse).ToList();
    }

    public async Task<InvitationResponse> AcceptAsync(string freelancerId, string invitationId, CancellationToken ct)
    {
        await EnsureFreelancerAsync(freelancerId, ct);
        var inv = await FindAsync(invitationId, ct);
        if (inv.FreelancerId != freelancerId) throw new NotFoundException("Invitation introuvable.");
        if (inv.Status != InvitationStatus.Pending) throw new ConflictException($"Cette invitation a déjà été traitée ({inv.Status}).");
        if (inv.ExpiresAt.HasValue && inv.ExpiresAt.Value < DateTime.UtcNow) throw new ConflictException("Cette invitation a expiré.");

        var project = await _projects.GetEntityAsync(freelancerId, inv.ProjectId, ct);
        if (!ProjectStatus.IsPublished(project.Status)) throw new ConflictException("Ce projet n'est plus disponible.");
        if (project.AssignedTo is not null && project.AssignedTo != freelancerId) throw new ConflictException("Ce projet a déjà été attribué.");

        await _projects.ApplyAssignmentAsync(project, freelancerId, ct);
        project.Status = ProjectStatus.InProgress;
        project.UpdatedAt = DateTime.UtcNow;
        var claimed = await _projects.TryClaimAssignmentAsync(project, freelancerId, ct);
        if (!claimed) throw new ConflictException("Ce projet a déjà été attribué à un autre freelance.");

        inv.Status = InvitationStatus.Accepted;
        inv.UpdatedAt = DateTime.UtcNow;
        var res = await Invitations.ReplaceOneAsync(i => i.Id == inv.Id && i.Status == InvitationStatus.Pending, inv, cancellationToken: ct);
        if (res.MatchedCount == 0) throw new ConflictException("Cette invitation a déjà été traitée.");

        // Refuser les autres invitations pending sur ce projet.
        await Invitations.UpdateManyAsync(
            i => i.ProjectId == inv.ProjectId && i.Id != inv.Id && i.Status == InvitationStatus.Pending,
            Builders<Invitation>.Update.Set(i => i.Status, InvitationStatus.Cancelled).Set(i => i.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);

        // Notification au client.
        var notif = new Notification
        {
            RecipientId = inv.ClientId,
            Type = "invitation-accepted",
            Title = inv.ProjectTitle,
            Message = $"{inv.FreelancerName} a accepté votre invitation pour « {inv.ProjectTitle} ».",
            ProjectId = inv.ProjectId,
            TaskTitle = string.Empty,
            ProjectTitle = inv.ProjectTitle,
            ActorName = inv.FreelancerName,
            CreatedAt = DateTime.UtcNow,
        };
        await Notifications.InsertOneAsync(notif, cancellationToken: ct);

        return ToResponse(inv);
    }

    public async Task<InvitationResponse> DeclineAsync(string freelancerId, string invitationId, string? reason, CancellationToken ct)
    {
        await EnsureFreelancerAsync(freelancerId, ct);
        var inv = await FindAsync(invitationId, ct);
        if (inv.FreelancerId != freelancerId) throw new NotFoundException("Invitation introuvable.");
        if (inv.Status != InvitationStatus.Pending) throw new ConflictException($"Cette invitation a déjà été traitée ({inv.Status}).");

        inv.Status = InvitationStatus.Declined;
        inv.DeclineReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        inv.UpdatedAt = DateTime.UtcNow;
        var res = await Invitations.ReplaceOneAsync(i => i.Id == inv.Id && i.Status == InvitationStatus.Pending, inv, cancellationToken: ct);
        if (res.MatchedCount == 0) throw new ConflictException("Cette invitation a déjà été traitée.");

        var notif = new Notification
        {
            RecipientId = inv.ClientId,
            Type = "invitation-declined",
            Title = inv.ProjectTitle,
            Message = $"{inv.FreelancerName} a décliné votre invitation pour « {inv.ProjectTitle} ».",
            ProjectId = inv.ProjectId,
            TaskTitle = string.Empty,
            ProjectTitle = inv.ProjectTitle,
            ActorName = inv.FreelancerName,
            CreatedAt = DateTime.UtcNow,
        };
        await Notifications.InsertOneAsync(notif, cancellationToken: ct);

        return ToResponse(inv);
    }

    private async Task<Invitation> FindAsync(string id, CancellationToken ct)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(id, out _)) throw new NotFoundException("Invitation introuvable.");
        return await Invitations.Find(i => i.Id == id).FirstOrDefaultAsync(ct) ?? throw new NotFoundException("Invitation introuvable.");
    }

    private async Task EnsureClientAsync(string userId, CancellationToken ct)
    {
        var u = await Users.Find(x => x.Id == userId).FirstOrDefaultAsync(ct) ?? throw new UnauthorizedException("Session invalide.");
        if (!string.Equals(u.Role, UserRole.Client, StringComparison.OrdinalIgnoreCase)) throw new ForbiddenException("Seuls les clients peuvent inviter.");
    }

    private async Task EnsureFreelancerAsync(string userId, CancellationToken ct)
    {
        var u = await Users.Find(x => x.Id == userId).FirstOrDefaultAsync(ct) ?? throw new UnauthorizedException("Session invalide.");
        if (!string.Equals(u.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase)) throw new ForbiddenException("Seuls les freelances peuvent répondre.");
    }

    private static InvitationResponse ToResponse(Invitation i) => new()
    {
        Id = i.Id,
        ProjectId = i.ProjectId,
        ProjectTitle = i.ProjectTitle,
        ClientId = i.ClientId,
        ClientName = i.ClientName,
        FreelancerId = i.FreelancerId,
        FreelancerName = i.FreelancerName,
        Message = i.Message,
        OfferedPrice = i.OfferedPrice,
        OfferedDelivery = i.OfferedDelivery,
        Status = i.Status,
        DeclineReason = i.DeclineReason,
        CreatedAt = i.CreatedAt,
        UpdatedAt = i.UpdatedAt,
        ExpiresAt = i.ExpiresAt,
    };
}