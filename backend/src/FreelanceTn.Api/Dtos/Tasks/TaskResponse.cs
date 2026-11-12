using System;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Dtos.Tasks;

public class TaskResponse
{
    public string Id { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Assignee { get; set; } = string.Empty;
    public string AssigneeUserId { get; set; } = string.Empty;
    public string AssigneeRole { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Priority { get; set; } = string.Empty;
    public int StoryPoints { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime DueDate { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<TaskStatusHistoryEntryDto> StatusHistory { get; set; } = new();
}

public class TaskStatusHistoryEntryDto
{
    public string Status { get; set; } = string.Empty;
    public string ChangedBy { get; set; } = string.Empty;
    public DateTime ChangedAt { get; set; }
    public string? Note { get; set; }
}