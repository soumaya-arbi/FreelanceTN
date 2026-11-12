using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

public class TaskStatusHistoryEntry
{
    public string Status { get; set; } = string.Empty;
    public string ChangedBy { get; set; } = string.Empty;
    public DateTime ChangedAt { get; set; } = DateTime.UtcNow;
    public string? Note { get; set; }
}

public class Task
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonRepresentation(BsonType.ObjectId)]
    public string ProjectId { get; set; } = null!;

    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    // Backward compatible display name (kept for existing data).
    public string Assignee { get; set; } = string.Empty;
    // New structured assignee fields.
    public string AssigneeUserId { get; set; } = string.Empty;
    public string AssigneeRole { get; set; } = "freelancer"; // freelancer | client

    public string Status { get; set; } = "todo"; // todo, in-progress, in-review, done
    public string Priority { get; set; } = "medium"; // low, medium, high, urgent
    public int StoryPoints { get; set; } = 0;
    public DateTime StartDate { get; set; } = DateTime.UtcNow;
    public DateTime DueDate { get; set; } = DateTime.UtcNow.AddDays(7);
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public List<TaskStatusHistoryEntry> StatusHistory { get; set; } = new();
}