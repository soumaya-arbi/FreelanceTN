using System.ComponentModel.DataAnnotations;

namespace FreelanceTn.Api.Dtos.Tasks;

public class CreateTaskCommentRequest
{
    [Required]
    public string Content { get; set; } = string.Empty;
}