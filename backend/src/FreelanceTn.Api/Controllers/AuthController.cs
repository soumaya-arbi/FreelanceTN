using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Dtos.Auth;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FreelanceTn.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AuthService _authService;
    private readonly GoogleAuthService _googleAuthService;
    private readonly AuthEmailService _authEmailService;
    private readonly SessionService _sessionService;
    private readonly JwtSettings _jwtSettings;
    private readonly AuthSettings _authSettings;
    private readonly ILogger<AuthController> _logger;
    private readonly IWebHostEnvironment _environment;

    public AuthController(
        AuthService authService,
        GoogleAuthService googleAuthService,
        AuthEmailService authEmailService,
        SessionService sessionService,
        IOptions<JwtSettings> jwtSettings,
        IOptions<AuthSettings> authSettings,
        ILogger<AuthController> logger,
        IWebHostEnvironment environment)
    {
        _authService = authService;
        _googleAuthService = googleAuthService;
        _authEmailService = authEmailService;
        _sessionService = sessionService;
        _jwtSettings = jwtSettings.Value;
        _authSettings = authSettings.Value;
        _logger = logger;
        _environment = environment;
    }

    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken)
    {
        var response = await _authService.RegisterAsync(request, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, response);
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        var userAgent = Request.Headers.UserAgent.ToString();
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? string.Empty;
        var result = await _authService.LoginAsync(request, userAgent, ip, cancellationToken);

        if (result.RequiresTwoFactor)
        {
            return Ok(new
            {
                message = "Vérification 2FA requise.",
                requiresTwoFactor = true,
                preAuthToken = result.PreAuthToken,
            });
        }

        SetAuthCookie(result.Token, result.Persistent, result.ExpiresAt);

        return Ok(new
        {
            message = "Connexion réussie.",
            persistent = result.Persistent,
            expiresAt = result.ExpiresAt,
            user = AuthService.ToResponse(result.User),
        });
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        var sessionKey = User.FindFirst("sid")?.Value;
        var userId = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        // Révoque la session courante côté serveur : un cookie copié ne peut
        // plus être rejoué après la déconnexion.
        if (!string.IsNullOrWhiteSpace(userId) && !string.IsNullOrWhiteSpace(sessionKey))
        {
            var sessions = await _sessionService.ListAsync(userId, sessionKey, cancellationToken);
            var current = sessions.FirstOrDefault(s => s.Current);
            if (current is not null)
            {
                await _sessionService.RevokeAsync(userId, current.Id, cancellationToken);
            }
        }

        Response.Cookies.Delete(_jwtSettings.CookieName, new CookieOptions
        {
            Path = "/",
            HttpOnly = true,
            Secure = Request.IsHttps || !_environment.IsDevelopment(),
            SameSite = SameSiteMode.Lax,
        });

        return Ok(new { message = "Déconnexion réussie." });
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var user = await _authService.GetByIdAsync(userId, cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        return Ok(AuthService.ToResponse(user));
    }

    [HttpPut("me")]
    [Authorize]
    public async Task<IActionResult> UpdateMe([FromBody] UpdateProfileRequest request, CancellationToken cancellationToken)
    {
        var updated = await _authService.UpdateProfileAsync(GetUserId(), request, cancellationToken);
        return Ok(updated);
    }

    [HttpPost("2fa/verify")]
    [AllowAnonymous]
    public async Task<IActionResult> VerifyTwoFactor([FromBody] TwoFactorVerifyRequest request, CancellationToken cancellationToken)
    {
        var userAgent = Request.Headers.UserAgent.ToString();
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? string.Empty;
        var result = await _authService.CompleteTwoFactorLoginAsync(request.PreAuthToken, request.Code, userAgent, ip, cancellationToken);
        SetAuthCookie(result.Token, result.Persistent, result.ExpiresAt);
        return Ok(new
        {
            message = "Connexion réussie.",
            persistent = result.Persistent,
            expiresAt = result.ExpiresAt,
            user = AuthService.ToResponse(result.User),
        });
    }

    [HttpPost("verify-email")]
    [AllowAnonymous]
    public async Task<IActionResult> VerifyEmail([FromBody] VerifyEmailRequest request, CancellationToken cancellationToken)
    {
        var response = await _authService.VerifyEmailAsync(request.Token, cancellationToken);
        return Ok(response);
    }

    [HttpPost("resend-verification")]
    [AllowAnonymous]
    public async Task<IActionResult> ResendVerification(
        [FromBody] ResendVerificationRequest request,
        CancellationToken cancellationToken)
    {
        var response = await _authService.ResendVerificationAsync(request.Email, cancellationToken);
        return Ok(response);
    }

    [HttpPost("forgot-password")]
    [AllowAnonymous]
    public async Task<IActionResult> ForgotPassword(
        [FromBody] ForgotPasswordRequest request,
        CancellationToken cancellationToken)
    {
        await _authService.ForgotPasswordAsync(request.Email, cancellationToken);
        return Ok(new MessageResponse
        {
            Message = "Si un compte correspond à cette adresse, un e-mail de réinitialisation a été envoyé.",
        });
    }

    [HttpPost("reset-password")]
    [AllowAnonymous]
    public async Task<IActionResult> ResetPassword(
        [FromBody] ResetPasswordRequest request,
        CancellationToken cancellationToken)
    {
        await _authService.ResetPasswordAsync(request, cancellationToken);
        return Ok(new MessageResponse
        {
            Message = "Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous connecter.",
        });
    }

    [HttpGet("providers")]
    [AllowAnonymous]
    public IActionResult Providers()
    {
        var transport = _authEmailService.Transport switch
        {
            EmailTransport.Smtp => "smtp",
            EmailTransport.DevOutbox => "dev-outbox",
            _ => "none",
        };

        return Ok(new AuthProvidersResponse
        {
            Google = _googleAuthService.IsConfigured,
            EmailTransport = transport,
            GoogleConfigurationHint = _googleAuthService.IsConfigured
                ? null
                : "La connexion Google n'est pas configurée sur ce serveur.",
        });
    }

    [HttpGet("google/start")]
    [AllowAnonymous]
    public IActionResult GoogleStart([FromQuery] string? role)
    {
        var frontend = _authSettings.EffectiveFrontendBaseUrl.TrimEnd('/');

        if (!_googleAuthService.IsConfigured)
        {
            return Redirect($"{frontend}/login?authError=google_not_configured");
        }

        GoogleAuthorizationRequest request;
        try
        {
            request = _googleAuthService.CreateAuthorizationRequest(role);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "La connexion Google n'a pas pu démarrer.");
            return Redirect($"{frontend}/login?authError=google_failed");
        }

        Response.Cookies.Append(GoogleAuthService.StateCookieName, request.StateCookie, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps || !_environment.IsDevelopment(),
            SameSite = SameSiteMode.Lax,
            Expires = DateTimeOffset.UtcNow.AddMinutes(10),
            Path = "/api/auth/google",
            IsEssential = true,
        });

        return Redirect(request.Url);
    }

    [HttpGet("google/callback")]
    [AllowAnonymous]
    public async Task<IActionResult> GoogleCallback(
        [FromQuery] string? code,
        [FromQuery] string? state,
        [FromQuery] string? error,
        CancellationToken cancellationToken)
    {
        var frontend = _authSettings.EffectiveFrontendBaseUrl.TrimEnd('/');

        if (!string.IsNullOrWhiteSpace(error))
        {
            DeleteOAuthStateCookie();
            var errorCode = string.Equals(error, "access_denied", StringComparison.Ordinal)
                ? "google_cancelled"
                : "google_failed";
            return Redirect($"{frontend}/login?authError={errorCode}");
        }

        try
        {
            var stateCookie = Request.Cookies[GoogleAuthService.StateCookieName];
            var (user, token) = await _googleAuthService.HandleCallbackAsync(code, state, stateCookie, cancellationToken);

            DeleteOAuthStateCookie();
            SetAuthCookie(token);

            return Redirect($"{frontend}{HomePathForRole(user.Role)}");
        }
        catch (OAuthException exception)
        {
            DeleteOAuthStateCookie();
            var query = $"?authError={Uri.EscapeDataString(exception.Code)}";
            if (!string.IsNullOrWhiteSpace(exception.EmailHint))
            {
                query += $"&emailHint={Uri.EscapeDataString(exception.EmailHint)}";
            }
            if (exception.VerificationSent)
            {
                query += "&verificationSent=1";
            }
            if (exception.CooldownSeconds is > 0)
            {
                query += $"&cooldown={exception.CooldownSeconds.Value}";
            }

            return Redirect($"{frontend}/login{query}");
        }
        catch (EmailDeliveryException)
        {
            DeleteOAuthStateCookie();
            return Redirect($"{frontend}/login?authError=email_delivery_failed");
        }
        catch (Exception exception)
        {
            DeleteOAuthStateCookie();
            _logger.LogError(exception, "La connexion Google a échoué.");
            return Redirect($"{frontend}/login?authError=google_failed");
        }
    }

    private string GetUserId()
    {
        var userId = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        if (string.IsNullOrEmpty(userId))
        {
            throw new UnauthorizedException("Session invalide.");
        }

        return userId;
    }

    private void SetAuthCookie(string token, bool persistent = false, DateTime? expiresAt = null)
    {
        var options = new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps || !_environment.IsDevelopment(),
            SameSite = SameSiteMode.Lax,
            Path = "/",
            IsEssential = true,
        };

        // Cookie persistant uniquement si « Remember me » : sinon le navigateur
        // le supprime à la fermeture. La date correspond exactement à celle du
        // jeton JWT, pour éviter un cookie valide sans jeton (ou l'inverse).
        if (persistent)
        {
            options.Expires = new DateTimeOffset(expiresAt ?? DateTime.UtcNow.AddMinutes(_jwtSettings.ExpiryMinutes));
        }

        Response.Cookies.Append(_jwtSettings.CookieName, token, options);
    }

    private void DeleteOAuthStateCookie()
    {
        Response.Cookies.Delete(GoogleAuthService.StateCookieName, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps || !_environment.IsDevelopment(),
            SameSite = SameSiteMode.Lax,
            Path = "/api/auth/google",
        });
    }

    private static string HomePathForRole(string role)
    {
        return role == UserRole.Client ? "/client" : "/freelancer/dashboard";
    }
}
