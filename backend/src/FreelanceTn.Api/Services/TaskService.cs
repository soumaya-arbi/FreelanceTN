using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Tasks;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using MongoDB.Bson;
using MongoDB.Driver;
using TaskModel = FreelanceTn.Api.Models.Task;

namespace FreelanceTn.Api.Services;

public class TaskService
{
    private readonly MongoContext _mongo;
    private readonly IMongoCollection<TaskModel> _tasks;
    private readonly IMongoCollection<TaskComment> _comments;
    private readonly IMongoCollection<User> _users;
    private readonly IMongoCollection<Project> _projects;
    private readonly IMongoCollection<Notification> _notifications;

    public TaskService(MongoContext mongo)
    {
        _mongo = mongo;
        _tasks = _mongo.GetCollection<TaskModel>(_mongo.Settings.TasksCollection);
        _comments = _mongo.GetCollection<TaskComment>(_mongo.Settings.TaskCommentsCollection);
        _users = _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);
        _projects = _mongo.GetCollection<Project>(_mongo.Settings.ProjectsCollection);
        _notifications = _mongo.GetCollection<Notification>(_mongo.Settings.NotificationsCollection);
    }

    private async Task<Project> GetProjectAsync(string projectId, CancellationToken ct)
    {
        if (!ObjectId.TryParse(projectId, out _))
            throw new BadRequestException("Identifiant de projet invalide.");
        var project = await _projects.Find(p => p.Id == projectId).FirstOrDefaultAsync(ct);
        if (project is null)
            throw new NotFoundException("Projet introuvable.");
        return project;
    }

    private async System.Threading.Tasks.Task ValidateAccessAsync(string projectId, string requesterId, CancellationToken ct)
    {
        var project = await GetProjectAsync(projectId, ct);
        if (project.OwnerId != requesterId && (project.AssignedTo == null || project.AssignedTo != requesterId))
            throw new ForbiddenException("Accès refusé au projet.");
    }

    private async Task<User?> GetUserAsync(string userId, CancellationToken ct)
    {
        if (!ObjectId.TryParse(userId, out _)) return null;
        return await _users.Find(u => u.Id == userId).FirstOrDefaultAsync(ct);
    }

    private static string DisplayName(User? user, string fallback)
    {
        if (user is null) return fallback;
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private async Task<bool> IsOwnerAsync(string projectId, string requesterId, CancellationToken ct)
    {
        var project = await GetProjectAsync(projectId, ct);
        return project.OwnerId == requesterId;
    }

    public async Task<TaskModel> CreateAsync(string requesterId, CreateTaskRequest request, CancellationToken ct)
    {
        await ValidateAccessAsync(request.ProjectId, requesterId, ct);

        var requester = await GetUserAsync(requesterId, ct);
        var assigneeUserId = string.IsNullOrWhiteSpace(request.AssigneeUserId) ? requesterId : request.AssigneeUserId.Trim();
        var assigneeRole = string.IsNullOrWhiteSpace(request.AssigneeRole) ? "freelancer" : request.AssigneeRole.Trim().ToLowerInvariant();
        var assigneeUser = await GetUserAsync(assigneeUserId, ct);
        var assigneeName = string.IsNullOrWhiteSpace(request.Assignee)
            ? DisplayName(assigneeUser, assigneeUserId)
            : request.Assignee.Trim();

        // Validate assignee is a participant of the project.
        var project = await GetProjectAsync(request.ProjectId, ct);
        var allowed = new HashSet<string> { project.OwnerId };
        if (!string.IsNullOrWhiteSpace(project.AssignedTo)) allowed.Add(project.AssignedTo!);
        if (!allowed.Contains(assigneeUserId))
            throw new BadRequestException("Le responsable doit être le freelance ou le client du projet.");

        var status = string.IsNullOrWhiteSpace(request.Status) ? "todo" : request.Status.Trim().ToLowerInvariant();
        var task = new TaskModel
        {
            ProjectId = request.ProjectId,
            Title = request.Title,
            Description = request.Description ?? string.Empty,
            Assignee = assigneeName,
            AssigneeUserId = assigneeUserId,
            AssigneeRole = assigneeRole,
            Status = status,
            Priority = request.Priority ?? "medium",
            StoryPoints = request.StoryPoints,
            StartDate = request.StartDate,
            DueDate = request.DueDate,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        task.StatusHistory.Add(new TaskStatusHistoryEntry
        {
            Status = status,
            ChangedBy = requesterId,
            ChangedAt = DateTime.UtcNow,
            Note = "Création",
        });
        await _tasks.InsertOneAsync(task, cancellationToken: ct);
        // Notify assignee if different from creator
        var actor = await GetUserAsync(requesterId, ct);
        var actorName = DisplayName(actor, requesterId);
        var recipients = new List<string> { assigneeUserId };
        await NotifyAsync(recipients, "assign", task.Title, project.Title, actorName, $"Vous avez été assigné à la tâche « {task.Title} ».", task, requesterId, ct);
        return task;
    }

    private async System.Threading.Tasks.Task NotifyAsync(IEnumerable<string> recipientIds, string type, string taskTitle, string projectTitle, string actorName, string message, TaskModel task, string actorId, CancellationToken ct)
    {
        foreach (var rid in recipientIds.Distinct())
        {
            if (string.IsNullOrWhiteSpace(rid) || rid == actorId) continue;
            if (!ObjectId.TryParse(rid, out _)) continue;
            var n = new Notification
            {
                RecipientId = rid,
                Type = type,
                Title = taskTitle,
                Message = message,
                TaskId = task.Id,
                ProjectId = task.ProjectId,
                TaskTitle = task.Title,
                ProjectTitle = projectTitle,
                ActorName = actorName,
                CreatedAt = DateTime.UtcNow,
            };
            await _notifications.InsertOneAsync(n, cancellationToken: ct);
        }
    }

    public async Task<IReadOnlyList<TaskModel>> ListAsync(string requesterId, CancellationToken ct)
    {
        var accessibleProjectIds = await GetAccessibleProjectIds(requesterId, ct);
        var filter = Builders<TaskModel>.Filter.In(t => t.ProjectId, accessibleProjectIds);
        var tasks = await _tasks.Find(filter).SortByDescending(t => t.UpdatedAt).ToListAsync(ct);
        return tasks;
    }

    private async Task<HashSet<string>> GetAccessibleProjectIds(string userId, CancellationToken ct)
    {
        var proj = await _projects.Find(p => p.OwnerId == userId || p.AssignedTo == userId).Project(p => p.Id).ToListAsync(ct);
        return new HashSet<string>(proj);
    }

    public async Task<TaskModel> GetAsync(string requesterId, string taskId, CancellationToken ct)
    {
        if (!ObjectId.TryParse(taskId, out _))
            throw new BadRequestException("Identifiant de tâche invalide.");
        var task = await _tasks.Find(t => t.Id == taskId).FirstOrDefaultAsync(ct);
        if (task is null)
            throw new NotFoundException("Tâche introuvable.");
        await ValidateAccessAsync(task.ProjectId, requesterId, ct);
        return task;
    }

    public async Task<TaskModel> UpdateAsync(string requesterId, string taskId, UpdateTaskRequest request, CancellationToken ct)
    {
        var task = await GetAsync(requesterId, taskId, ct);
        task.StatusHistory ??= new List<TaskStatusHistoryEntry>();
        var project = await GetProjectAsync(task.ProjectId, ct);
        var isOwner = project.OwnerId == requesterId;
        var isFreelancer = project.AssignedTo == requesterId;

        if (request.Title is not null) task.Title = request.Title;
        if (request.Description is not null) task.Description = request.Description;
        if (request.Priority is not null) task.Priority = request.Priority;
        if (request.StoryPoints.HasValue) task.StoryPoints = request.StoryPoints.Value;
        if (request.StartDate.HasValue) task.StartDate = request.StartDate.Value;
        if (request.DueDate.HasValue) task.DueDate = request.DueDate.Value;

        // Assignee update
        if (request.AssigneeUserId is not null || request.Assignee is not null || request.AssigneeRole is not null)
        {
            var newAssigneeUserId = request.AssigneeUserId is not null ? request.AssigneeUserId.Trim() : task.AssigneeUserId;
            if (string.IsNullOrWhiteSpace(newAssigneeUserId))
                newAssigneeUserId = task.AssigneeUserId;
            var allowed = new HashSet<string> { project.OwnerId };
            if (!string.IsNullOrWhiteSpace(project.AssignedTo)) allowed.Add(project.AssignedTo!);
            if (!allowed.Contains(newAssigneeUserId))
                throw new BadRequestException("Le responsable doit être le freelance ou le client du projet.");

            var newRole = request.AssigneeRole is not null ? request.AssigneeRole.Trim().ToLowerInvariant() : task.AssigneeRole;
            if (string.IsNullOrWhiteSpace(newRole)) newRole = task.AssigneeRole;
            var assigneeUser = await GetUserAsync(newAssigneeUserId, ct);
            var newName = request.Assignee is not null ? request.Assignee.Trim() : DisplayName(assigneeUser, newAssigneeUserId);

            if (newAssigneeUserId != task.AssigneeUserId || newRole != task.AssigneeRole || newName != task.Assignee)
            {
                task.AssigneeUserId = newAssigneeUserId;
                task.AssigneeRole = newRole;
                task.Assignee = newName;
                task.StatusHistory.Add(new TaskStatusHistoryEntry
                {
                    Status = task.Status,
                    ChangedBy = requesterId,
                    ChangedAt = DateTime.UtcNow,
                    Note = $"Réassignation à {newName}",
                });
                var assignActor = await GetUserAsync(requesterId, ct);
                await NotifyAsync(new[] { newAssigneeUserId }, "assign", task.Title, project.Title, DisplayName(assignActor, requesterId), $"Vous avez été assigné à la tâche « {task.Title} ».", task, requesterId, ct);
            }
        }

        // Status transition
        if (request.Status is not null)
        {
            var newStatus = request.Status.Trim().ToLowerInvariant();
            if (newStatus != task.Status)
            {
                var previousStatus = task.Status;
                ValidateTransition(previousStatus, newStatus, isOwner, isFreelancer, request.Comment);
                task.Status = newStatus;
                task.StatusHistory.Add(new TaskStatusHistoryEntry
                {
                    Status = newStatus,
                    ChangedBy = requesterId,
                    ChangedAt = DateTime.UtcNow,
                    Note = request.Comment,
                });
                // Notify the other participant
                var statusActor = await GetUserAsync(requesterId, ct);
                var statusActorName = DisplayName(statusActor, requesterId);
                var recipient = isOwner ? task.AssigneeUserId : project.OwnerId;
                if (string.IsNullOrWhiteSpace(recipient))
                    recipient = isOwner ? (project.AssignedTo ?? string.Empty) : project.OwnerId;
                var recipients = new List<string> { recipient };
                string nType, nMsg;
                if (newStatus == "in-review") { nType = "review"; nMsg = $"La tâche « {task.Title} » a été soumise pour validation."; }
                else if (newStatus == "done") { nType = "approve"; nMsg = $"La tâche « {task.Title} » a été approuvée."; }
                else if (previousStatus == "in-review" && newStatus == "in-progress") { nType = "reject"; nMsg = $"Des corrections sont demandées pour « {task.Title} » : {request.Comment}"; }
                else { nType = "status"; nMsg = $"Le statut de « {task.Title} » est maintenant {newStatus}."; }
                await NotifyAsync(recipients, nType, task.Title, project.Title, statusActorName, nMsg, task, requesterId, ct);
                // store rejection comment
                if (!string.IsNullOrWhiteSpace(request.Comment) && (newStatus == "in-progress" || newStatus == "done"))
                {
                    var comment = new TaskComment
                    {
                        TaskId = task.Id,
                        ProjectId = task.ProjectId,
                        AuthorId = requesterId,
                        AuthorName = statusActorName,
                        AuthorAvatar = statusActor?.Avatar ?? string.Empty,
                        AuthorRole = isOwner ? "client" : "freelancer",
                        Content = request.Comment.Trim(),
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow,
                    };
                    await _comments.InsertOneAsync(comment, cancellationToken: ct);
                }
            }
        }

        if (request.ProjectId is not null && request.ProjectId != task.ProjectId)
        {
            await ValidateAccessAsync(request.ProjectId, requesterId, ct);
            task.ProjectId = request.ProjectId;
        }

        task.UpdatedAt = DateTime.UtcNow;
        await _tasks.ReplaceOneAsync(t => t.Id == taskId, task, cancellationToken: ct);
        return task;
    }

    private static void ValidateTransition(string current, string next, bool isOwner, bool isFreelancer, string? comment)
    {
        var allowed = new HashSet<(string, string)>();
        // Freelancer transitions
        if (isFreelancer)
        {
            allowed.Add(("todo", "in-progress"));
            allowed.Add(("in-progress", "in-review"));
        }
        // Client (owner) transitions
        if (isOwner)
        {
            allowed.Add(("in-review", "done")); // approve
            allowed.Add(("in-review", "in-progress")); // reject
        }
        if (!allowed.Contains((current, next)))
            throw new ForbiddenException("Transition de statut non autorisée.");
        if (current == "in-review" && next == "in-progress" && string.IsNullOrWhiteSpace(comment))
            throw new BadRequestException("Un commentaire est requis pour demander des corrections.");
    }

    public async System.Threading.Tasks.Task DeleteAsync(string requesterId, string taskId, CancellationToken ct)
    {
        var task = await GetAsync(requesterId, taskId, ct);
        await _tasks.DeleteOneAsync(t => t.Id == taskId, ct);
        await _comments.DeleteManyAsync(c => c.TaskId == taskId, ct);
    }

    // Comments
    public async Task<IReadOnlyList<TaskComment>> ListCommentsAsync(string requesterId, string taskId, CancellationToken ct)
    {
        var task = await GetAsync(requesterId, taskId, ct);
        var comments = await _comments.Find(c => c.TaskId == task.Id).SortBy(c => c.CreatedAt).ToListAsync(ct);
        return comments;
    }

    public async Task<TaskComment> AddCommentAsync(string requesterId, string taskId, string content, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(content))
            throw new BadRequestException("Le commentaire ne peut pas être vide.");
        var task = await GetAsync(requesterId, taskId, ct);
        var project = await GetProjectAsync(task.ProjectId, ct);
        var requester = await GetUserAsync(requesterId, ct);
        var isOwner = project.OwnerId == requesterId;
        var comment = new TaskComment
        {
            TaskId = task.Id,
            ProjectId = task.ProjectId,
            AuthorId = requesterId,
            AuthorName = DisplayName(requester, requesterId),
            AuthorAvatar = requester?.Avatar ?? string.Empty,
            AuthorRole = isOwner ? "client" : "freelancer",
            Content = content.Trim(),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        await _comments.InsertOneAsync(comment, cancellationToken: ct);
        // Notify the other participant
        var otherRecipient = isOwner ? task.AssigneeUserId : project.OwnerId;
        if (string.IsNullOrWhiteSpace(otherRecipient)) otherRecipient = isOwner ? (project.AssignedTo ?? "") : project.OwnerId;
        if (!string.IsNullOrWhiteSpace(otherRecipient) && otherRecipient != requesterId)
        {
            var commentActor = await GetUserAsync(requesterId, ct);
            await NotifyAsync(new[] { otherRecipient }, "comment", task.Title, project.Title, DisplayName(commentActor, requesterId), $"{DisplayName(commentActor, requesterId)} a commenté « {task.Title} ».", task, requesterId, ct);
        }
        return comment;
    }
}