using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Comments;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
public class CommentsController : ControllerBase
{
    private readonly CommentService _commentService;

    public CommentsController(CommentService commentService)
    {
        _commentService = commentService;
    }

    private string CurrentUserId =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new UnauthorizedException("Session invalide.");

    private string? CurrentUserIdOrNull =>
        User.Identity?.IsAuthenticated == true
            ? User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            : null;

    // --- List comments for a project ---
    [HttpGet("api/comments")]
    [AllowAnonymous]
    public async Task<IActionResult> ListByQuery([FromQuery] string projectId, CancellationToken cancellationToken)
    {
        var comments = await _commentService.ListByProjectAsync(projectId, CurrentUserIdOrNull, cancellationToken);
        return Ok(comments);
    }

    [HttpGet("api/comments/project/{projectId}")]
    [AllowAnonymous]
    public async Task<IActionResult> ListByProject(string projectId, CancellationToken cancellationToken)
    {
        var comments = await _commentService.ListByProjectAsync(projectId, CurrentUserIdOrNull, cancellationToken);
        return Ok(comments);
    }

    [HttpGet("api/projects/{projectId}/comments")]
    [AllowAnonymous]
    public async Task<IActionResult> ListByProjectNested(string projectId, CancellationToken cancellationToken)
    {
        var comments = await _commentService.ListByProjectAsync(projectId, CurrentUserIdOrNull, cancellationToken);
        return Ok(comments);
    }

    // --- Create comment ---
    [HttpPost("api/comments")]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateCommentRequest request, CancellationToken cancellationToken)
    {
        var comment = await _commentService.CreateAsync(CurrentUserId, request.ProjectId, request.Content, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = comment.Id }, comment);
    }

    [HttpPost("api/projects/{projectId}/comments")]
    [Authorize]
    public async Task<IActionResult> CreateNested(string projectId, [FromBody] UpdateCommentRequest? request, CancellationToken cancellationToken)
    {
        var content = request?.Content ?? string.Empty;
        // Allow content in body as { content } or { text }? handle both via dynamic? Keep simple.
        var comment = await _commentService.CreateAsync(CurrentUserId, projectId, content, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = comment.Id }, comment);
    }

    [HttpGet("api/comments/{id}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetById(string id, CancellationToken cancellationToken)
    {
        // Not implemented lookup by id; return 404 placeholder? Better implement in service.
        return NotFound();
    }

    [HttpPut("api/comments/{id}")]
    [Authorize]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateCommentRequest request, CancellationToken cancellationToken)
    {
        var comment = await _commentService.UpdateAsync(CurrentUserId, id, request.Content, cancellationToken);
        return Ok(comment);
    }

    [HttpDelete("api/comments/{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        await _commentService.DeleteAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }
}
