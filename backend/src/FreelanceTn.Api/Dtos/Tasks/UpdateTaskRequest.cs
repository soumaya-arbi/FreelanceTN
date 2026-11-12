using System.ComponentModel.DataAnnotations;

namespace FreelanceTn.Api.Dtos.Tasks;

public class UpdateTaskRequest
{
    // All fields optional for partial update
    public string? ProjectId { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? Assignee { get; set; }
    public string? AssigneeUserId { get; set; }
    public string? AssigneeRole { get; set; }
    public string? Status { get; set; } // todo, in-progress, in-review, done
    public string? Priority { get; set; } // low, medium, high, urgent
    public int? StoryPoints { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? DueDate { get; set; }
    // Optional comment when rejecting (in-review -> in-progress)
    public string? Comment { get; set; }
}