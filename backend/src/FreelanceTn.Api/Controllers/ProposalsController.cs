using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Proposals;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/proposals")]
public class ProposalsController : ControllerBase
{
    private readonly ProposalService _proposalService;

    public ProposalsController(ProposalService proposalService)
    {
        _proposalService = proposalService;
    }

    // Identité de l'utilisateur : uniquement issue de la session authentifiée.
    // Le frontend ne peut pas influencer le freelance ni le propriétaire du
    // projet associés à une candidature.
    private string CurrentUserId =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new UnauthorizedException("Session invalide.");

    /// <summary>Dépose une candidature sur un projet publié (freelance uniquement).</summary>
    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateProposalRequest request, CancellationToken cancellationToken)
    {
        var proposal = await _proposalService.CreateAsync(CurrentUserId, request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = proposal.Id }, proposal);
    }

    /// <summary>Candidatures déposées par le freelance connecté.</summary>
    [HttpGet("mine")]
    [Authorize]
    public async Task<IActionResult> Mine(CancellationToken cancellationToken)
    {
        var proposals = await _proposalService.ListMineAsync(CurrentUserId, cancellationToken);
        return Ok(proposals);
    }

    /// <summary>Candidatures reçues par le client connecté (ses projets uniquement).</summary>
    [HttpGet("received")]
    [Authorize]
    public async Task<IActionResult> Received([FromQuery] string? projectId, CancellationToken cancellationToken)
    {
        var proposals = await _proposalService.ListReceivedAsync(CurrentUserId, projectId, cancellationToken);
        return Ok(proposals);
    }

    /// <summary>Consultation d'une candidature : auteur ou propriétaire du projet.</summary>
    [HttpGet("{id}", Name = "GetProposalById")]
    [Authorize]
    public async Task<IActionResult> GetById(string id, CancellationToken cancellationToken)
    {
        var proposal = await _proposalService.GetAsync(CurrentUserId, id, cancellationToken);
        return Ok(proposal);
    }

    /// <summary>Décision du client : accepter ou refuser une candidature.</summary>
    [HttpPut("{id}/status")]
    [Authorize]
    public async Task<IActionResult> UpdateStatus(
        string id,
        [FromBody] UpdateProposalStatusRequest request,
        CancellationToken cancellationToken)
    {
        var proposal = await _proposalService.ReviewAsync(CurrentUserId, id, request.Status, cancellationToken);
        return Ok(proposal);
    }

    /// <summary>Retrait d'une propre candidature par le freelance (jamais celle d'autrui).</summary>
    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        await _proposalService.DeleteAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }
}
