using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using FreelanceTn.Api.Dtos.Tasks;
using TaskModel = FreelanceTn.Api.Models.Task;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TasksController : ControllerBase
{
    private readonly TaskService _taskService;
    private readonly ILogger<TasksController> _logger;

    public TasksController(TaskService taskService, ILogger<TasksController> logger)
    {
        _taskService = taskService;
        _logger = logger;
    }

    private string UserId() =>
        User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
        ?? string.Empty;

    private static TaskResponse ToResponse(TaskModel t) => new TaskResponse
    {
        Id = t.Id,
        ProjectId = t.ProjectId,
        Title = t.Title,
        Description = t.Description,
        Assignee = t.Assignee,
        AssigneeUserId = t.AssigneeUserId,
        AssigneeRole = t.AssigneeRole,
        Status = t.Status,
        Priority = t.Priority,
        StartDate = t.StartDate,
        DueDate = t.DueDate,
        CreatedAt = t.CreatedAt,
        UpdatedAt = t.UpdatedAt,
        StatusHistory = t.StatusHistory.Select(h => new TaskStatusHistoryEntryDto
        {
            Status = h.Status,
            ChangedBy = h.ChangedBy,
            ChangedAt = h.ChangedAt,
            Note = h.Note,
        }).ToList(),
    };

    // GET api/tasks
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TaskResponse>>> List(CancellationToken ct)
    {
        var tasks = await _taskService.ListAsync(UserId(), ct);
        return Ok(tasks.Select(ToResponse).ToList());
    }

    // GET api/tasks/{id}
    [HttpGet("{id}")]
    public async Task<ActionResult<TaskResponse>> Get(string id, CancellationToken ct)
    {
        var task = await _taskService.GetAsync(UserId(), id, ct);
        return Ok(ToResponse(task));
    }

    // POST api/tasks
    [HttpPost]
    public async Task<ActionResult<TaskResponse>> Create([FromBody] CreateTaskRequest request, CancellationToken ct)
    {
        var task = await _taskService.CreateAsync(UserId(), request, ct);
        return Created($"/api/tasks/{task.Id}", ToResponse(task));
    }

    // PUT api/tasks/{id}
    [HttpPut("{id}")]
    public async Task<ActionResult<TaskResponse>> Update(string id, [FromBody] UpdateTaskRequest request, CancellationToken ct)
    {
        var task = await _taskService.UpdateAsync(UserId(), id, request, ct);
        return Ok(ToResponse(task));
    }

    // DELETE api/tasks/{id}
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        await _taskService.DeleteAsync(UserId(), id, ct);
        return NoContent();
    }

    // GET api/tasks/{id}/comments
    [HttpGet("{id}/comments")]
    public async Task<ActionResult<IReadOnlyList<TaskComment>>> ListComments(string id, CancellationToken ct)
    {
        var comments = await _taskService.ListCommentsAsync(UserId(), id, ct);
        return Ok(comments);
    }

    // POST api/tasks/{id}/comments
    [HttpPost("{id}/comments")]
    public async Task<ActionResult<TaskComment>> AddComment(string id, [FromBody] CreateTaskCommentRequest request, CancellationToken ct)
    {
        var comment = await _taskService.AddCommentAsync(UserId(), id, request.Content, ct);
        return Created($"/api/tasks/{id}/comments/{comment.Id}", comment);
    }
}