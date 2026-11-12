using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FreelanceTn.Api.Dtos.Feedbacks;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/feedbacks")]
public class FeedbacksController : ControllerBase
{
    private readonly FeedbackService _feedbackService;

    public FeedbacksController(FeedbackService feedbackService)
    {
        _feedbackService = feedbackService;
    }

    private string CurrentUserId =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new UnauthorizedException("Session invalide.");

    /// <summary>
    /// Avis publiés reçus par un utilisateur (profil public). Les avis masqués
    /// et les demandes non soumises ne sont jamais renvoyés.
    /// </summary>
    [HttpGet("freelancer/{freelancerId}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetForFreelancer(string freelancerId, CancellationToken cancellationToken)
    {
        var feedbacks = await _feedbackService.ListPublishedForRecipientAsync(freelancerId, cancellationToken);
        return Ok(feedbacks);
    }

    /// <summary>
    /// Avis publiés reçus par n'importe quel utilisateur (client ou freelancer).
    /// </summary>
    [HttpGet("user/{userId}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetForUser(string userId, CancellationToken cancellationToken)
    {
        var feedbacks = await _feedbackService.ListPublishedForRecipientAsync(userId, cancellationToken);
        return Ok(feedbacks);
    }

    /// <summary>
    /// Réputation publique : moyenne, répartition, moyennes par critère,
    /// recommandations et liste des avis publiés.
    /// </summary>
    [HttpGet("summary/{userId}")]
    [AllowAnonymous]
    public async Task<IActionResult> Summary(string userId, CancellationToken cancellationToken)
    {
        var summary = await _feedbackService.GetSummaryAsync(userId, cancellationToken);
        return Ok(summary);
    }

    /// <summary>
    /// Demandes et évaluations de l'utilisateur connecté. L'auteur voit son
    /// propre contenu, jamais celui de l'autre participant avant publication.
    /// </summary>
    [HttpGet("mine")]
    [Authorize]
    public async Task<IActionResult> Mine(CancellationToken cancellationToken)
    {
        var feedbacks = await _feedbackService.ListMineAsync(CurrentUserId, cancellationToken);
        return Ok(feedbacks);
    }

    /// <summary>
    /// Crée de façon idempotente les deux demandes d'évaluation d'un projet
    /// terminé. Appelé à la transition vers Completed et utilisable comme
    /// filet de sécurité.
    /// </summary>
    [HttpPost("requests/{projectId}")]
    [Authorize]
    public async Task<IActionResult> EnsureRequests(string projectId, CancellationToken cancellationToken)
    {
        var requests = await _feedbackService.EnsureRequestsAsync(projectId, CurrentUserId, cancellationToken);
        return Ok(requests);
    }

    /// <summary>
    /// Soumet l'évaluation structurée de l'utilisateur connecté. Le rôle et la
    /// direction sont déduits du projet.
    /// </summary>
    [HttpPost("{projectId}/submit")]
    [Authorize]
    public async Task<IActionResult> Submit(
        string projectId,
        [FromBody] SubmitFeedbackRequest request,
        CancellationToken cancellationToken)
    {
        var feedback = await _feedbackService.SubmitAsync(CurrentUserId, projectId, request, cancellationToken);
        return Ok(feedback);
    }

    /// <summary>Un avis soumis ne peut plus être modifié.</summary>
    [HttpPut("{id}")]
    [Authorize]
    public async Task<IActionResult> Update(string id, CancellationToken cancellationToken)
    {
        await _feedbackService.UpdateAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }

    /// <summary>Un avis soumis ne peut plus être supprimé.</summary>
    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        await _feedbackService.DeleteAsync(CurrentUserId, id, cancellationToken);
        return NoContent();
    }
}
