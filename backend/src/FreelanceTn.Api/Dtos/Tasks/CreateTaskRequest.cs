using System.ComponentModel.DataAnnotations;

namespace FreelanceTn.Api.Dtos.Tasks;

public class CreateTaskRequest
{
    [Required]
    public string ProjectId { get; set; } = string.Empty;

    [Required]
    public string Title { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;
    public string Assignee { get; set; } = string.Empty;
    public string AssigneeUserId { get; set; } = string.Empty;
    public string AssigneeRole { get; set; } = "freelancer"; // freelancer | client
    public string Status { get; set; } = "todo"; // todo, in-progress, in-review, done
    public string Priority { get; set; } = "medium"; // low, medium, high, urgent
    public int StoryPoints { get; set; } = 0;
    public DateTime StartDate { get; set; } = DateTime.UtcNow;
    public DateTime DueDate { get; set; } = DateTime.UtcNow.AddDays(7);
}