using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Flux OAuth 2.0 / OpenID Connect « authorization code » côté serveur :
/// - <c>state</c> aléatoire, comparé en temps constant et conservé dans un cookie
///   httpOnly chiffré (protection CSRF) ;
/// - PKCE (S256) : le code d'autorisation ne peut être échangé que par le
///   navigateur qui a initié la connexion ;
/// - <c>nonce</c> : le jeton d'identité Google doit le contenir (protection replay) ;
/// - validation cryptographique du <c>id_token</c> (signature JWKS Google, issuer,
///   audience, expiration, e-mail vérifié par Google).
/// </summary>
public class GoogleAuthService
{
    public const string StateCookieName = "freelancetn_oauth";

    private const string MetadataAddress = "https://accounts.google.com/.well-known/openid-configuration";
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";

    private static readonly string[] ValidIssuers = ["https://accounts.google.com", "accounts.google.com"];

    private readonly AuthSettings _settings;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IDataProtector _protector;
    private readonly AuthService _authService;
    private readonly ILogger<GoogleAuthService> _logger;
    private readonly ConfigurationManager<OpenIdConnectConfiguration> _openIdConfiguration;

    public GoogleAuthService(
        IOptions<AuthSettings> settings,
        IHttpClientFactory httpClientFactory,
        IDataProtectionProvider dataProtectionProvider,
        AuthService authService,
        ILogger<GoogleAuthService> logger)
    {
        _settings = settings.Value;
        _httpClientFactory = httpClientFactory;
        _protector = dataProtectionProvider.CreateProtector("FreelanceTn.GoogleOAuth");
        _authService = authService;
        _logger = logger;

        // Les clés publiques Google sont mises en cache et rafraîchies
        // automatiquement (rotation des clés de signature).
        _openIdConfiguration = new ConfigurationManager<OpenIdConnectConfiguration>(
            MetadataAddress,
            new OpenIdConnectConfigurationRetriever(),
            new HttpDocumentRetriever { RequireHttps = true });
    }

    public bool IsConfigured => _settings.Google.IsConfigured;

    public GoogleAuthorizationRequest CreateAuthorizationRequest(string? role)
    {
        if (!IsConfigured)
        {
            throw new BadRequestException("La connexion Google n'est pas configurée.");
        }

        var redirectUri = _settings.Google.RedirectUri.Trim();
        if (!Uri.TryCreate(redirectUri, UriKind.Absolute, out var redirectUriParsed) ||
            (redirectUriParsed.Scheme != Uri.UriSchemeHttp && redirectUriParsed.Scheme != Uri.UriSchemeHttps))
        {
            throw new BadRequestException(
                "L'URL de redirection Google configurée est invalide (Auth:Google:RedirectUri).");
        }

        var state = CreateOpaqueToken();
        var nonce = CreateOpaqueToken();
        var codeVerifier = CreateCodeVerifier();

        var statePayload = new OAuthState
        {
            State = state,
            Nonce = nonce,
            CodeVerifier = codeVerifier,
            Role = UserRole.IsValid(role) ? UserRole.Normalize(role) : null,
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeSeconds(),
        };

        var stateCookie = ProtectState(statePayload);
        var query = new Dictionary<string, string>
        {
            ["client_id"] = _settings.Google.ClientId.Trim(),
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["scope"] = "openid email profile",
            ["state"] = state,
            ["nonce"] = nonce,
            ["code_challenge"] = CreateCodeChallenge(codeVerifier),
            ["code_challenge_method"] = "S256",
            ["access_type"] = "online",
            ["include_granted_scopes"] = "true",
            ["prompt"] = "select_account",
        };

        var url = "https://accounts.google.com/o/oauth2/v2/auth?" +
                  string.Join("&", query.Select(pair =>
                      $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));

        return new GoogleAuthorizationRequest(url, stateCookie);
    }

    public async Task<(User User, string Token)> HandleCallbackAsync(
        string? code,
        string? state,
        string? stateCookie,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            throw new BadRequestException("La connexion Google n'est pas configurée.");
        }

        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(stateCookie))
        {
            throw new OAuthException("invalid_callback", "La réponse Google est incomplète.");
        }

        var payload = UnprotectState(stateCookie);
        if (payload is null ||
            payload.ExpiresAt < DateTimeOffset.UtcNow.ToUnixTimeSeconds() ||
            !FixedTimeEquals(payload.State, state))
        {
            throw new OAuthException("invalid_state", "La session Google a expiré. Réessayez.");
        }

        if (string.IsNullOrWhiteSpace(payload.Nonce) || string.IsNullOrWhiteSpace(payload.CodeVerifier))
        {
            // Cookie d'état forgé ou émis par une version antérieure : on refuse.
            throw new OAuthException("invalid_state", "La session Google est invalide. Réessayez.");
        }

        var tokens = await ExchangeCodeAsync(code, payload.CodeVerifier, cancellationToken);
        var info = await ValidateIdTokenAsync(tokens.IdToken, payload.Nonce, cancellationToken);

        if (!info.EmailVerified)
        {
            throw new OAuthException("email_not_verified", "Google n'a pas confirmé cette adresse e-mail.");
        }

        return await _authService.LoginWithGoogleAsync(info, payload.Role, cancellationToken);
    }

    private async Task<GoogleTokenResponse> ExchangeCodeAsync(
        string code,
        string codeVerifier,
        CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient();
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = _settings.Google.ClientId.Trim(),
            ["client_secret"] = _settings.Google.ClientSecret.Trim(),
            ["redirect_uri"] = _settings.Google.RedirectUri.Trim(),
            ["grant_type"] = "authorization_code",
            ["code_verifier"] = codeVerifier,
        });

        using var response = await client.PostAsync(TokenEndpoint, content, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("L'échange du code Google a échoué avec le statut {StatusCode}.", (int)response.StatusCode);
            throw new OAuthException("token_exchange_failed", "La connexion Google a échoué.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;

        var idToken = ReadString(root, "id_token");
        if (string.IsNullOrWhiteSpace(idToken))
        {
            // Sans id_token (scope "openid" demandé), l'identité ne peut pas être
            // validée cryptographiquement : on refuse plutôt que de faire confiance
            // à des données non signées.
            _logger.LogWarning("La réponse du jeton Google ne contient pas d'id_token.");
            throw new OAuthException("missing_id_token", "La connexion Google a échoué.");
        }

        return new GoogleTokenResponse(idToken, ReadString(root, "access_token"));
    }

    private async Task<GoogleUserInfo> ValidateIdTokenAsync(
        string idToken,
        string expectedNonce,
        CancellationToken cancellationToken)
    {
        var configuration = await _openIdConfiguration.GetConfigurationAsync(cancellationToken);

        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var parameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = configuration.SigningKeys,
            ValidateIssuer = true,
            ValidIssuers = ValidIssuers,
            ValidateAudience = true,
            ValidAudience = _settings.Google.ClientId.Trim(),
            ValidateLifetime = true,
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ClockSkew = TimeSpan.FromMinutes(1),
        };

        ClaimsPrincipal principal;
        SecurityToken validatedToken;
        try
        {
            principal = handler.ValidateToken(idToken, parameters, out validatedToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "La validation du jeton d'identité Google a échoué.");
            throw new OAuthException("invalid_id_token", "La connexion Google a échoué.");
        }

        // Google signe ses id_token en RS256 : on refuse tout autre algorithme.
        if (validatedToken is not JwtSecurityToken jwt ||
            !string.Equals(jwt.Header.Alg, SecurityAlgorithms.RsaSha256, StringComparison.Ordinal))
        {
            throw new OAuthException("invalid_id_token", "La connexion Google a échoué.");
        }

        var nonce = principal.FindFirst("nonce")?.Value ?? string.Empty;
        if (!FixedTimeEquals(nonce, expectedNonce))
        {
            _logger.LogWarning("Le nonce du jeton d'identité Google ne correspond pas à la demande.");
            throw new OAuthException("invalid_nonce", "La session Google est invalide. Réessayez.");
        }

        var subject = principal.FindFirst("sub")?.Value?.Trim() ?? string.Empty;
        var email = principal.FindFirst("email")?.Value?.Trim() ?? string.Empty;
        if (subject.Length == 0 || email.Length == 0)
        {
            throw new OAuthException("userinfo_invalid", "Le profil Google est incomplet.");
        }

        return new GoogleUserInfo(
            subject,
            email,
            ReadBooleanClaim(principal, "email_verified"),
            principal.FindFirst("given_name")?.Value?.Trim() ?? string.Empty,
            principal.FindFirst("family_name")?.Value?.Trim() ?? string.Empty,
            principal.FindFirst("picture")?.Value?.Trim() ?? string.Empty);
    }

    private string ProtectState(OAuthState state)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(state);
        var protectedBytes = _protector.Protect(json);
        return Base64UrlEncode(protectedBytes);
    }

    private OAuthState? UnprotectState(string stateCookie)
    {
        try
        {
            var protectedBytes = Base64UrlDecode(stateCookie);
            var json = _protector.Unprotect(protectedBytes);
            return JsonSerializer.Deserialize<OAuthState>(json);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static bool ReadBooleanClaim(ClaimsPrincipal principal, string claimType)
    {
        var value = principal.FindFirst(claimType)?.Value;
        return bool.TryParse(value, out var result) && result;
    }

    private static string ReadString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()?.Trim() ?? string.Empty
            : string.Empty;
    }

    private static string CreateOpaqueToken()
    {
        return Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
    }

    /// <summary>Code verifier PKCE : 43 caractères base64url (32 octets aléatoires).</summary>
    private static string CreateCodeVerifier() => Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    private static string CreateCodeChallenge(string codeVerifier)
    {
        var hash = SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier));
        return Base64UrlEncode(hash);
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized = normalized.PadRight(normalized.Length + ((4 - normalized.Length % 4) % 4), '=');
        return Convert.FromBase64String(normalized);
    }

    private static bool FixedTimeEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length &&
               CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    private sealed class OAuthState
    {
        public string State { get; set; } = string.Empty;
        public string Nonce { get; set; } = string.Empty;
        public string CodeVerifier { get; set; } = string.Empty;
        public string? Role { get; set; }
        public long ExpiresAt { get; set; }
    }

    private sealed record GoogleTokenResponse(string IdToken, string AccessToken);
}

public record GoogleAuthorizationRequest(string Url, string StateCookie);
