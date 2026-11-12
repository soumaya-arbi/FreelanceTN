using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Comments;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

public class CommentService
{
    private readonly MongoContext _mongo;

    public CommentService(MongoContext mongo)
    {
        _mongo = mongo;
    }

    private IMongoCollection<Comment> Comments => _mongo.GetCollection<Comment>(_mongo.Settings.CommentsCollection);
    private IMongoCollection<Project> Projects => _mongo.GetCollection<Project>(_mongo.Settings.ProjectsCollection);
    private IMongoCollection<User> Users => _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);

    public async Task<List<CommentResponse>> ListByProjectAsync(string projectId, string? requesterId, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(projectId, out _))
            throw new NotFoundException("Projet introuvable.");

        var project = await Projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Projet introuvable.");

        if (string.IsNullOrWhiteSpace(requesterId))
            throw new UnauthorizedException("Authentification requise.");

        var requester = await Users.Find(u => u.Id == requesterId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        var isOwner = project.OwnerId == requesterId;
        var isAssigned = !string.IsNullOrWhiteSpace(project.AssignedTo) && project.AssignedTo == requesterId;
        var isOpenFreelancer = string.Equals(project.Status, ProjectStatus.Open, StringComparison.OrdinalIgnoreCase)
            && string.Equals(requester.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase);

        if (!isOwner && !isAssigned && !isOpenFreelancer)
            throw new ForbiddenException("Vous n'êtes pas autorisé à consulter cette discussion.");

        var comments = await Comments
            .Find(c => c.ProjectId == projectId)
            .SortBy(c => c.CreatedAt)
            .ToListAsync(cancellationToken);

        return comments.Select(ToResponse).ToList();
    }

    public async Task<CommentResponse> CreateAsync(string authorId, string projectId, string content, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(projectId, out _))
            throw new NotFoundException("Projet introuvable.");

        var author = await Users.Find(u => u.Id == authorId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        var project = await Projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Projet introuvable.");

        if (!string.Equals(project.Status, ProjectStatus.Open, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(project.Status, ProjectStatus.InProgress, StringComparison.OrdinalIgnoreCase))
            throw new ConflictException("La discussion est en lecture seule pour ce projet.");

        var isOwner = project.OwnerId == authorId;
        var isClient = string.Equals(author.Role, UserRole.Client, StringComparison.OrdinalIgnoreCase);
        var isAssigned = !string.IsNullOrWhiteSpace(project.AssignedTo) && project.AssignedTo == authorId;
        var isOpenFreelancer = string.Equals(project.Status, ProjectStatus.Open, StringComparison.OrdinalIgnoreCase)
            && string.Equals(author.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase);
        var isInProgressFreelancer = string.Equals(project.Status, ProjectStatus.InProgress, StringComparison.OrdinalIgnoreCase)
            && string.Equals(author.Role, UserRole.Freelancer, StringComparison.OrdinalIgnoreCase)
            && isAssigned;

        if (isClient && !isOwner)
            throw new ForbiddenException("Seul le client propriétaire du projet peut répondre.");

        if (!isOwner && !isOpenFreelancer && !isInProgressFreelancer)
            throw new ForbiddenException("Vous n'êtes pas autorisé à participer à cette discussion.");

        var trimmed = content.Trim();
        if (trimmed.Length == 0)
            throw new ConflictException("Le commentaire est obligatoire.");
        if (trimmed.Length > 2000)
            throw new ConflictException("Le commentaire ne peut pas dépasser 2000 caractères.");

        var now = DateTime.UtcNow;
        var comment = new Comment
        {
            ProjectId = project.Id,
            ProjectTitle = project.Title,
            AuthorId = author.Id,
            AuthorName = $"{author.FirstName} {author.LastName}".Trim(),
            AuthorAvatar = author.Avatar ?? string.Empty,
            AuthorRole = author.Role,
            Content = trimmed,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await Comments.InsertOneAsync(comment, cancellationToken: cancellationToken);
        return ToResponse(comment);
    }

    public async Task<CommentResponse> UpdateAsync(string userId, string commentId, string content, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(commentId, out _))
            throw new NotFoundException("Commentaire introuvable.");

        var comment = await Comments.Find(c => c.Id == commentId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Commentaire introuvable.");

        if (comment.AuthorId != userId)
            throw new ForbiddenException("Seul l'auteur de ce commentaire peut le modifier.");

        var trimmed = content.Trim();
        if (trimmed.Length == 0)
            throw new ConflictException("Le commentaire est obligatoire.");
        if (trimmed.Length > 2000)
            throw new ConflictException("Le commentaire ne peut pas dépasser 2000 caractères.");

        comment.Content = trimmed;
        comment.UpdatedAt = DateTime.UtcNow;

        await Comments.ReplaceOneAsync(c => c.Id == comment.Id, comment, cancellationToken: cancellationToken);
        return ToResponse(comment);
    }

    public async System.Threading.Tasks.Task DeleteAsync(string userId, string commentId, CancellationToken cancellationToken)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(commentId, out _))
            throw new NotFoundException("Commentaire introuvable.");

        var comment = await Comments.Find(c => c.Id == commentId).FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Commentaire introuvable.");

        if (comment.AuthorId != userId)
            throw new ForbiddenException("Seul l'auteur de ce commentaire peut le supprimer.");

        await Comments.DeleteOneAsync(c => c.Id == comment.Id, cancellationToken: cancellationToken);
    }

    private static CommentResponse ToResponse(Comment comment) => new()
    {
        Id = comment.Id,
        ProjectId = comment.ProjectId,
        ProjectTitle = comment.ProjectTitle,
        AuthorId = comment.AuthorId,
        AuthorName = comment.AuthorName,
        AuthorAvatar = comment.AuthorAvatar,
        AuthorRole = comment.AuthorRole,
        Content = comment.Content,
        CreatedAt = comment.CreatedAt,
        UpdatedAt = comment.UpdatedAt,
    };
}
