using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using FreelanceTn.Api.Services;
using System.Threading;
using System.Threading.Tasks;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly NotificationService _service;
    private readonly AccountService _account;

    public NotificationsController(NotificationService service, AccountService account)
    {
        _service = service;
        _account = account;
    }

    private string UserId() =>
        User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
        ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
        ?? string.Empty;

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var userId = UserId();
        var preferences = await _account.GetNotificationPreferencesEntityAsync(userId, ct);
        var items = await _service.ListAsync(userId, preferences, ct);
        return Ok(items);
    }

    [HttpGet("unread-count")]
    public async Task<IActionResult> UnreadCount(CancellationToken ct)
    {
        var userId = UserId();
        var preferences = await _account.GetNotificationPreferencesEntityAsync(userId, ct);
        var count = await _service.UnreadCountAsync(userId, preferences, ct);
        return Ok(new { count });
    }

    [HttpPut("{id}/read")]
    public async Task<IActionResult> MarkRead(string id, CancellationToken ct)
    {
        await _service.MarkReadAsync(UserId(), id, ct);
        return NoContent();
    }

    [HttpPut("read-all")]
    public async Task<IActionResult> MarkAllRead(CancellationToken ct)
    {
        await _service.MarkAllReadAsync(UserId(), ct);
        return NoContent();
    }
}
