using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Projects;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/projects")]
public class ProjectsController : ControllerBase
{
    private readonly ProjectService _projectService;

    public ProjectsController(ProjectService projectService)
    {
        _projectService = projectService;
    }

    // Identité du propriétaire : uniquement issue de la session authentifiée.
    private string CurrentUserId =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new UnauthorizedException("Session invalide.");

    // Identité optionnelle : utilisée par les endpoints consultables par tous,
    // où le propriétaire reste prioritaire sur ses propres brouillons.
    private string? CurrentUserIdOrNull =>
        User.Identity?.IsAuthenticated == true
            ? User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            : null;

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateProjectRequest request, CancellationToken cancellationToken)
    {
        var project = await _projectService.CreateAsync(CurrentUserId, request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = project.Id }, project);
    }

    /// <summary>Projets du compte connecté, tous statuts confondus.</summary>
    [HttpGet]
    [Authorize]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var projects = await _projectService.ListAsync(CurrentUserId, cancellationToken);
        return Ok(projects);
    }

    /// <summary>Catalogue public : uniquement les projets publiés (statut « Open »).</summary>
    [HttpGet("catalog")]
    [AllowAnonymous]
    public async Task<IActionResult> Catalog(
        [FromQuery] string? category,
        [FromQuery] string? q,
        [FromQuery] string? type,
        [FromQuery] decimal? minBudget,
        [FromQuery] decimal? maxBudget,
        [FromQuery] int? durationValue,
        [FromQuery] string? durationUnit,
        [FromQuery] int limit = 50,
        CancellationToken cancellationToken = default)
    {
        var projects = await _projectService.ListCatalogAsync(category, q, Math.Clamp(limit, 1, 200), type, minBudget, maxBudget, durationValue, durationUnit, cancellationToken);
        return Ok(projects);
    }

    /// <summary>Projets approuvés par un client pour le freelance connecté.</summary>
    [HttpGet("assigned")]
    [Authorize]
    public async Task<IActionResult> Assigned(CancellationToken cancellationToken)
    {
        var projects = await _projectService.ListAssignedAsync(CurrentUserId, cancellationToken);
        return Ok(projects);
    }

    /// <summary>Comptes freelances qu'un client peut approuver sur un projet.</summary>
    [HttpGet("assignees")]
    [Authorize]
    public async Task<IActionResult> Assignees(CancellationToken cancellationToken)
    {
        var assignees = await _projectService.ListAssigneesAsync(CurrentUserId, cancellationToken);
        return Ok(assignees);
    }

    [HttpGet("catalog/categories")]
    [AllowAnonymous]
    public async Task<IActionResult> CatalogCategories(CancellationToken cancellationToken)
    {
        var categories = await _projectService.ListCatalogCategoriesAsync(cancellationToken);
        return Ok(categories);
    }

    [HttpGet("{id}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetById(string id, CancellationToken cancellationToken)
    {
        var project = await _projectService.GetAsync(CurrentUserIdOrNull, id, cancellationToken);
        return Ok(project);
    }

    [HttpPut("{id}")]
    [Authorize]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateProjectRequest request, CancellationToken cancellationToken)
    {
        var project = await _projectService.UpdateAsync(CurrentUserId, id, request, cancellationToken);
        return Ok(project);
    }

    [HttpPost("{id}/submit-review")]
    [Authorize]
    public async Task<IActionResult> SubmitForReview(string id, [FromBody] SubmitForReviewRequest? request, CancellationToken cancellationToken)
    {
        var project = await _projectService.SubmitForReviewAsync(CurrentUserId, id, cancellationToken, request?.Message);
        return Ok(project);
    }

    [HttpPost("{id}/reopen")]
    [Authorize]
    public async Task<IActionResult> Reopen(string id, [FromBody] ReopenProjectRequest? request, CancellationToken cancellationToken)
    {
        var project = await _projectService.ReopenAsync(CurrentUserId, id, request ?? new ReopenProjectRequest(), cancellationToken);
        return Ok(project);
    }

    [HttpPost("{id}/milestones/{milestoneId}/action")]
    [Authorize]
    public async Task<IActionResult> MilestoneAction(string id, string milestoneId, [FromBody] MilestoneActionRequest request, CancellationToken cancellationToken)
    {
        var project = await _projectService.MilestoneActionAsync(CurrentUserId, id, milestoneId, request, cancellationToken);
        return Ok(project);
    }

    [HttpPost("{id}/milestones")]
    [Authorize]
    public async Task<IActionResult> AddMilestone(string id, [FromBody] CreateMilestoneRequest request, CancellationToken cancellationToken)
    {
        var project = await _projectService.AddMilestoneAsync(CurrentUserId, id, request, cancellationToken);
        return Ok(project);
    }

    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        await _projectService.DeleteAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }
}
