using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Portfolio;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

/// <summary>
/// Portfolio des freelances. Les écritures sont réservées au freelance connecté
/// et le propriétaire n'est jamais accepté depuis le corps de la requête.
/// </summary>
[ApiController]
[Route("api/portfolio")]
public class PortfolioController : ControllerBase
{
    private readonly PortfolioService _portfolioService;
    private readonly CvImportService _cvImportService;
    private readonly CvPdfService _cvPdfService;

    public PortfolioController(
        PortfolioService portfolioService,
        CvImportService cvImportService,
        CvPdfService cvPdfService)
    {
        _portfolioService = portfolioService;
        _cvImportService = cvImportService;
        _cvPdfService = cvPdfService;
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

    private bool IsClient => User.Identity?.IsAuthenticated == true && User.IsInRole(UserRole.Client);

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create(
        [FromBody] CreatePortfolioItemRequest request,
        CancellationToken cancellationToken)
    {
        var item = await _portfolioService.CreateAsync(CurrentUserId, request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = item.Id }, item);
    }

    [HttpGet("mine")]
    [Authorize]
    public async Task<IActionResult> ListMine(CancellationToken cancellationToken)
    {
        var items = await _portfolioService.ListMineAsync(CurrentUserId, cancellationToken);
        return Ok(items);
    }

    /// <summary>Portfolio public d'un freelance : uniquement les éléments publiés.</summary>
    [HttpGet("freelancer/{freelancerId}")]
    [AllowAnonymous]
    public async Task<IActionResult> ListForFreelancer(string freelancerId, CancellationToken cancellationToken)
    {
        var items = await _portfolioService.ListForFreelancerAsync(freelancerId, IsClient, cancellationToken);
        return Ok(items);
    }

    [HttpGet("{id}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetById(string id, CancellationToken cancellationToken)
    {
        var item = await _portfolioService.GetAsync(CurrentUserIdOrNull, IsClient, id, cancellationToken);
        return Ok(item);
    }

    [HttpPut("{id}")]
    [Authorize]
    public async Task<IActionResult> Update(
        string id,
        [FromBody] UpdatePortfolioItemRequest request,
        CancellationToken cancellationToken)
    {
        var item = await _portfolioService.UpdateAsync(CurrentUserId, id, request, cancellationToken);
        return Ok(item);
    }

    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        await _portfolioService.DeleteAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }

    /// <summary>Importe un CV PDF et en extrait les informations exploitables.</summary>
    [HttpPost("cv/import")]
    [Authorize]
    [RequestSizeLimit(10 * 1024 * 1024 + 1024)]
    public async Task<ActionResult<CvImportResponse>> ImportCv(IFormFile? file, CancellationToken cancellationToken)
    {
        await _portfolioService.EnsureFreelancerAsync(CurrentUserId, cancellationToken);
        var result = await _cvImportService.ImportAsync(file, cancellationToken);
        return Ok(result);
    }

    /// <summary>Génère et télécharge le CV PDF du freelance connecté.</summary>
    [HttpGet("cv.pdf")]
    [Authorize]
    public async Task<IActionResult> DownloadCv(CancellationToken cancellationToken)
    {
        await _portfolioService.EnsureFreelancerAsync(CurrentUserId, cancellationToken);
        var bytes = await _cvPdfService.GenerateAsync(CurrentUserId, cancellationToken);
        return File(bytes, "application/pdf", "CV-FreelanceTN.pdf");
    }
}
