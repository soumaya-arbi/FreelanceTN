using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Invitations;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/invitations")]
public class InvitationsController : ControllerBase
{
    private readonly InvitationService _svc;
    public InvitationsController(InvitationService svc) { _svc = svc; }

    private string CurrentUserId => User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? throw new UnauthorizedException("Session invalide.");

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateInvitationRequest req, CancellationToken ct)
    {
        var r = await _svc.CreateAsync(CurrentUserId, req, ct);
        return CreatedAtAction(nameof(GetById), new { id = r.Id }, r);
    }

    [HttpGet("mine")]
    [Authorize]
    public async Task<IActionResult> Mine(CancellationToken ct) => Ok(await _svc.ListForFreelancerAsync(CurrentUserId, ct));

    [HttpGet("sent")]
    [Authorize]
    public async Task<IActionResult> Sent(CancellationToken ct) => Ok(await _svc.ListForClientAsync(CurrentUserId, ct));

    [HttpGet("{id}")]
    [Authorize]
    public async Task<IActionResult> GetById(string id, CancellationToken ct)
    {
        // reuse list filtering by id: fetch via service? Add GetAsync not exposed; implement quick lookup via lists
        var forFreelancer = await _svc.ListForFreelancerAsync(CurrentUserId, ct);
        var found = forFreelancer.FirstOrDefault(x => x.Id == id);
        if (found is null)
        {
            var forClient = await _svc.ListForClientAsync(CurrentUserId, ct);
            found = forClient.FirstOrDefault(x => x.Id == id);
        }
        if (found is null) return NotFound();
        return Ok(found);
    }

    [HttpPost("{id}/accept")]
    [Authorize]
    public async Task<IActionResult> Accept(string id, CancellationToken ct) => Ok(await _svc.AcceptAsync(CurrentUserId, id, ct));

    [HttpPost("{id}/decline")]
    [Authorize]
    public async Task<IActionResult> Decline(string id, [FromBody] DeclineInvitationRequest req, CancellationToken ct) => Ok(await _svc.DeclineAsync(CurrentUserId, id, req.Reason, ct));
}