using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Services;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

/// <summary>
/// Services (offres) des freelances. Les écritures sont réservées au freelance
/// connecté et les modifications portent toujours sur ses propres services :
/// le propriétaire n'est jamais accepté depuis le corps de la requête.
/// </summary>
[ApiController]
[Route("api/services")]
public class ServicesController : ControllerBase
{
    private readonly ServiceService _serviceService;

    public ServicesController(ServiceService serviceService)
    {
        _serviceService = serviceService;
    }

    // Identité du freelance : uniquement issue de la session authentifiée.
    private string CurrentUserId =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new UnauthorizedException("Session invalide.");

    // Identité optionnelle : utilisée pour les endpoints consultables par tous,
    // où le propriétaire reste prioritaire sur son propre brouillon.
    private string? CurrentUserIdOrNull =>
        User.Identity?.IsAuthenticated == true
            ? User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            : null;

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateServiceRequest request, CancellationToken cancellationToken)
    {
        var service = await _serviceService.CreateAsync(CurrentUserId, request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = service.Id }, service);
    }

    [HttpGet("mine")]
    [Authorize]
    public async Task<IActionResult> ListMine(CancellationToken cancellationToken)
    {
        var services = await _serviceService.ListMineAsync(CurrentUserId, cancellationToken);
        return Ok(services);
    }

    /// <summary>Catalogue public : uniquement les services publiés.</summary>
    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> List(
        [FromQuery] string? category,
        [FromQuery] string? q,
        [FromQuery] int limit = 50,
        CancellationToken cancellationToken = default)
    {
        var services = await _serviceService.ListPublishedAsync(category, q, Math.Clamp(limit, 1, 200), cancellationToken);
        return Ok(services);
    }

    [HttpGet("{id}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetById(string id, CancellationToken cancellationToken)
    {
        var service = await _serviceService.GetAsync(CurrentUserIdOrNull, id, cancellationToken);
        return Ok(service);
    }

    [HttpPut("{id}")]
    [Authorize]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateServiceRequest request, CancellationToken cancellationToken)
    {
        var service = await _serviceService.UpdateAsync(CurrentUserId, id, request, cancellationToken);
        return Ok(service);
    }

    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        await _serviceService.DeleteAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }
}
