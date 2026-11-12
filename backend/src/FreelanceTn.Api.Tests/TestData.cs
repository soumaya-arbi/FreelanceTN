using FreelanceTn.Api.Data;
using FreelanceTn.Api.Models;
using MongoDB.Driver;

// Le modèle « Task » du module Tasks entre en conflit avec
// System.Threading.Tasks.Task : un alias explicif est utilisé.
using TaskModel = FreelanceTn.Api.Models.Task;

namespace FreelanceTn.Api.Tests;

/// <summary>
/// Helpers d'écriture des données de test. Toutes les insertions sont faites
/// dans la base éphémère du fixture : la base de développement n'est jamais
/// modifiée.
/// </summary>
internal static class TestData
{
    public static async Task<User> InsertUserAsync(MongoContext mongo, string role, string firstName, string lastName)
    {
        var id = MongoFixture.NewId();
        var user = new User
        {
            Id = id,
            Email = $"{firstName}.{lastName}.{id}@test.local",
            EmailNormalized = $"{firstName}.{lastName}.{id}@test.local".ToUpperInvariant(),
            Role = role,
            FirstName = firstName,
            LastName = lastName,
            Title = $"{firstName} {lastName}",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };

        await mongo.GetCollection<User>(mongo.Settings.UsersCollection).InsertOneAsync(user);
        return user;
    }

    public static async Task<Project> InsertProjectAsync(
        MongoContext mongo,
        User owner,
        string status,
        User? assignee = null,
        int proposals = 0)
    {
        var project = new Project
        {
            Id = MongoFixture.NewId(),
            OwnerId = owner.Id,
            Title = $"Projet de test {MongoFixture.NewId()}",
            Description = "Description du projet de test.",
            Budget = "1000",
            Type = "Fixed price",
            Client = $"{owner.FirstName} {owner.LastName}",
            Status = status,
            Proposals = proposals,
            Skills = ["C#"],
            AssignedTo = assignee?.Id,
            AssignedToName = assignee is null ? null : $"{assignee.FirstName} {assignee.LastName}",
            AssignedAt = assignee is null ? null : DateTime.UtcNow.AddDays(-2),
            CreatedAt = DateTime.UtcNow.AddDays(-10),
            UpdatedAt = DateTime.UtcNow.AddDays(-1),
        };

        await mongo.GetCollection<Project>(mongo.Settings.ProjectsCollection).InsertOneAsync(project);
        return project;
    }

    public static async Task<Proposal> InsertProposalAsync(
        MongoContext mongo,
        Project project,
        User freelancer,
        string status)
    {
        var proposal = new Proposal
        {
            Id = MongoFixture.NewId(),
            ProjectId = project.Id,
            ProjectTitle = project.Title,
            ProjectBudget = project.Budget,
            ProjectType = project.Type,
            ProjectStatus = project.Status,
            ProjectOwnerId = project.OwnerId,
            FreelancerId = freelancer.Id,
            FreelancerName = $"{freelancer.FirstName} {freelancer.LastName}",
            FreelancerTitle = freelancer.Title,
            CoverLetter = "Lettre de motivation suffisamment longue pour être acceptée par l'API.",
            Price = "900",
            Delivery = "4 weeks",
            Status = status,
            CreatedAt = DateTime.UtcNow.AddDays(-3),
            UpdatedAt = DateTime.UtcNow.AddDays(-2),
        };

        await mongo.GetCollection<Proposal>(mongo.Settings.ProposalsCollection).InsertOneAsync(proposal);
        return proposal;
    }

    public static async Task<TaskModel> InsertTaskAsync(MongoContext mongo, Project project, User assignee)
    {
        var task = new TaskModel
        {
            Id = MongoFixture.NewId(),
            ProjectId = project.Id,
            Title = "Tâche de test",
            Description = "Une tâche attachée au projet.",
            Assignee = $"{assignee.FirstName} {assignee.LastName}",
            AssigneeUserId = assignee.Id,
            Status = "todo",
            Priority = "medium",
            CreatedAt = DateTime.UtcNow.AddDays(-4),
            UpdatedAt = DateTime.UtcNow.AddDays(-4),
        };

        await mongo.GetCollection<TaskModel>(mongo.Settings.TasksCollection).InsertOneAsync(task);
        return task;
    }

    public static async Task<Project> GetProjectAsync(MongoContext mongo, string projectId) =>
        await mongo.GetCollection<Project>(mongo.Settings.ProjectsCollection)
            .Find(p => p.Id == projectId)
            .FirstAsync();

    public static async Task<List<Proposal>> GetProposalsAsync(MongoContext mongo, string projectId) =>
        await mongo.GetCollection<Proposal>(mongo.Settings.ProposalsCollection)
            .Find(p => p.ProjectId == projectId)
            .ToListAsync();

    public static async Task<Notification?> GetNotificationAsync(MongoContext mongo, string recipientId, string type) =>
        await mongo.GetCollection<Notification>(mongo.Settings.NotificationsCollection)
            .Find(n => n.RecipientId == recipientId && n.Type == type)
            .FirstOrDefaultAsync();

    public static async Task<long> CountNotificationsAsync(MongoContext mongo, string projectId) =>
        await mongo.GetCollection<Notification>(mongo.Settings.NotificationsCollection)
            .CountDocumentsAsync(n => n.ProjectId == projectId);

    public static async Task<long> CountTasksAsync(MongoContext mongo, string projectId) =>
        await mongo.GetCollection<TaskModel>(mongo.Settings.TasksCollection)
            .CountDocumentsAsync(t => t.ProjectId == projectId);
}
