using FreelanceTn.Api.Dtos.Account;
using FreelanceTn.Api.Dtos.Auth;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/account")]
public class AccountController : ControllerBase
{
    private readonly AccountService _account;
    private readonly AuthService _authService;

    public AccountController(AccountService account, AuthService authService)
    {
        _account = account;
        _authService = authService;
    }

    private string UserId()
    {
        var userId = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        if (string.IsNullOrWhiteSpace(userId))
        {
            throw new UnauthorizedException("Session invalide.");
        }

        return userId;
    }

    private string? SessionKey() => User.FindFirst("sid")?.Value;

    private void RequireClient()
    {
        var role = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value;
        if (!string.Equals(role, UserRole.Client, StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Cette fonctionnalité est réservée aux comptes client.");
        }
    }

    // ------------------------------------------------------------ Profil client

    [HttpGet("profile")]
    [Authorize]
    public async Task<IActionResult> GetProfile(CancellationToken cancellationToken)
    {
        RequireClient();
        return Ok(await _account.GetClientProfileAsync(UserId(), cancellationToken));
    }

    [HttpPut("profile")]
    [Authorize]
    public async Task<IActionResult> UpdateProfile(
        [FromBody] UpdateClientProfileRequest request,
        CancellationToken cancellationToken)
    {
        RequireClient();
        return Ok(await _account.UpdateClientProfileAsync(UserId(), request, cancellationToken));
    }

    [HttpPut("avatar")]
    [Authorize]
    public async Task<IActionResult> UpdateAvatar(
        [FromBody] AvatarStyleRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await _account.SetAvatarStyleAsync(UserId(), request, cancellationToken));
    }

    // ------------------------------------------------------------ Équipe

    [HttpGet("team")]
    [Authorize]
    public async Task<IActionResult> GetTeam(CancellationToken cancellationToken)
    {
        RequireClient();
        return Ok(await _account.GetTeamAsync(UserId(), cancellationToken));
    }

    [HttpPost("team/invite")]
    [Authorize]
    public async Task<IActionResult> InviteTeamMember(
        [FromBody] TeamInviteRequest request,
        CancellationToken cancellationToken)
    {
        RequireClient();
        return Ok(await _account.InviteTeamMemberAsync(UserId(), request, cancellationToken));
    }

    [HttpPut("team/{id}/role")]
    [Authorize]
    public async Task<IActionResult> UpdateTeamRole(
        string id,
        [FromBody] TeamRoleRequest request,
        CancellationToken cancellationToken)
    {
        RequireClient();
        return Ok(await _account.UpdateTeamRoleAsync(UserId(), id, request.Role, cancellationToken));
    }

    [HttpPost("team/{id}/revoke")]
    [Authorize]
    public async Task<IActionResult> RevokeTeamMember(string id, CancellationToken cancellationToken)
    {
        RequireClient();
        return Ok(await _account.RevokeTeamMemberAsync(UserId(), id, cancellationToken));
    }

    [HttpPost("team/accept")]
    [AllowAnonymous]
    public async Task<IActionResult> AcceptInvitation(
        [FromBody] TeamInvitationTokenRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await _account.AcceptInvitationAsync(request.Token, cancellationToken));
    }

    [HttpPost("team/decline")]
    [AllowAnonymous]
    public async Task<IActionResult> DeclineInvitation(
        [FromBody] TeamInvitationTokenRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await _account.DeclineInvitationAsync(request.Token, cancellationToken));
    }

    [HttpPost("team/activate")]
    [AllowAnonymous]
    public async Task<IActionResult> ActivateInvitation(
        [FromBody] TeamActivateRequest request,
        CancellationToken cancellationToken)
    {
        return Ok(await _account.ActivateTeamMemberAsync(request.Token, request.Password, cancellationToken));
    }

    // ------------------------------------------------------------ Facturation

    [HttpGet("billing")]
    [Authorize]
    public async Task<IActionResult> GetBilling(CancellationToken cancellationToken)
    {
        RequireClient();
        return Ok(await _account.GetBillingAsync(UserId(), cancellationToken));
    }

    [HttpPut("billing")]
    [Authorize]
    public async Task<IActionResult> UpdateBilling(
        [FromBody] UpdateBillingRequest request,
        CancellationToken cancellationToken)
    {
        RequireClient();
        return Ok(await _account.UpdateBillingAsync(UserId(), request, cancellationToken));
    }

    // ------------------------------------------------------------ Notifications

    [HttpGet("notifications")]
    [Authorize]
    public async Task<IActionResult> GetNotificationPreferences(CancellationToken cancellationToken)
    {
        return Ok(await _account.GetNotificationPreferencesAsync(UserId(), cancellationToken));
    }

    [HttpPut("notifications")]
    [Authorize]
    public async Task<IActionResult> UpdateNotificationPreferences(
        [FromBody] NotificationPreferencesDto request,
        CancellationToken cancellationToken)
    {
        return Ok(await _account.UpdateNotificationPreferencesAsync(UserId(), request, cancellationToken));
    }

    // ------------------------------------------------------------ Préférences

    [HttpGet("preferences")]
    [Authorize]
    public async Task<IActionResult> GetPreferences(CancellationToken cancellationToken)
    {
        return Ok(await _account.GetPreferencesAsync(UserId(), cancellationToken));
    }

    [HttpPut("preferences")]
    [Authorize]
    public async Task<IActionResult> UpdatePreferences(
        [FromBody] UserPreferencesDto request,
        CancellationToken cancellationToken)
    {
        return Ok(await _account.UpdatePreferencesAsync(UserId(), request, cancellationToken));
    }

    // ------------------------------------------------------------ Sécurité

    [HttpGet("security")]
    [Authorize]
    public async Task<IActionResult> GetSecurity(CancellationToken cancellationToken)
    {
        return Ok(await _account.GetSecurityOverviewAsync(UserId(), SessionKey(), cancellationToken));
    }

    [HttpPost("security/change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword(
        [FromBody] ChangePasswordRequest request,
        CancellationToken cancellationToken)
    {
        await _authService.ChangePasswordAsync(
            UserId(),
            request.CurrentPassword,
            request.NewPassword,
            SessionKey(),
            cancellationToken);

        return Ok(new MessageResponse { Message = "Mot de passe mis à jour. Les autres sessions ont été déconnectées." });
    }

    [HttpPost("security/2fa/setup")]
    [Authorize]
    public async Task<IActionResult> TwoFactorSetup(CancellationToken cancellationToken)
    {
        var (secret, uri) = await _authService.StartTwoFactorSetupAsync(UserId(), cancellationToken);
        return Ok(new { secret, otpAuthUri = uri });
    }

    [HttpPost("security/2fa/enable")]
    [Authorize]
    public async Task<IActionResult> TwoFactorEnable([FromBody] TwoFactorCodeRequest request, CancellationToken cancellationToken)
    {
        var codes = await _authService.EnableTwoFactorAsync(UserId(), request.Code, cancellationToken);
        return Ok(new { recoveryCodes = codes });
    }

    [HttpPost("security/2fa/disable")]
    [Authorize]
    public async Task<IActionResult> TwoFactorDisable([FromBody] TwoFactorPasswordRequest request, CancellationToken cancellationToken)
    {
        await _authService.DisableTwoFactorAsync(UserId(), request.Password, cancellationToken);
        return Ok(new MessageResponse { Message = "2FA désactivée." });
    }

    [HttpPost("security/2fa/recovery-codes/regenerate")]
    [Authorize]
    public async Task<IActionResult> TwoFactorRegenerateRecoveryCodes([FromBody] TwoFactorPasswordRequest request, CancellationToken cancellationToken)
    {
        var codes = await _authService.RegenerateRecoveryCodesAsync(UserId(), request.Password, cancellationToken);
        return Ok(new { recoveryCodes = codes });
    }

    [HttpPost("security/sessions/{id}/revoke")]
    [Authorize]
    public async Task<IActionResult> RevokeSession(string id, CancellationToken cancellationToken)
    {
        var revoked = await _account.RevokeSessionAsync(UserId(), id, cancellationToken);
        if (!revoked)
        {
            throw new NotFoundException("Session introuvable ou déjà déconnectée.");
        }
        return NoContent();
    }

    [HttpPost("security/sessions/revoke-others")]
    [Authorize]
    public async Task<IActionResult> RevokeOtherSessions(CancellationToken cancellationToken)
    {
        var count = await _account.RevokeOtherSessionsAsync(UserId(), SessionKey(), cancellationToken);
        return Ok(new { message = $"{count} session(s) déconnectée(s).", count });
    }

    // ------------------------------------------------------------ Historique / export / public

    [HttpGet("history")]
    [Authorize]
    public async Task<IActionResult> GetHistory(CancellationToken cancellationToken)
    {
        return Ok(await _account.GetChangesAsync(UserId(), cancellationToken));
    }

    [HttpGet("export")]
    [Authorize]
    public async Task<IActionResult> Export(CancellationToken cancellationToken)
    {
        return Ok(await _account.ExportAsync(UserId(), cancellationToken));
    }

    [HttpGet("public/{id}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetPublicProfile(string id, CancellationToken cancellationToken)
    {
        return Ok(await _account.GetPublicProfileAsync(id, cancellationToken));
    }
}
