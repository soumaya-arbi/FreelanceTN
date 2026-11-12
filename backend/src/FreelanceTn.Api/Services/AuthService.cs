using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using FreelanceTn.Api.Configuration;
using System.Collections.Concurrent;
using Microsoft.AspNetCore.DataProtection;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Auth;
using FreelanceTn.Api.Exceptions;
using FreelanceTn.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;
using Task = System.Threading.Tasks.Task;

namespace FreelanceTn.Api.Services;

public class AuthService
{
    private readonly MongoContext _mongo;
    private readonly JwtSettings _jwt;
    private readonly AuthSettings _auth;
    private readonly AuthEmailService _email;
    private readonly SessionService _sessions;
    private readonly ILogger<AuthService> _logger;
    private readonly IPasswordHasher<User> _passwordHasher;
    private readonly bool _exposeDevEmailLinks;
    private readonly IDataProtector _protector;
    private static readonly ConcurrentDictionary<string, (string UserId, bool RememberMe, DateTime ExpiresAt)> _preAuthTokens = new();

    public AuthService(
        MongoContext mongo,
        IOptions<JwtSettings> jwt,
        IOptions<AuthSettings> auth,
        AuthEmailService email,
        SessionService sessions,
        IWebHostEnvironment environment,
        ILogger<AuthService> logger,
        IDataProtectionProvider dataProtection)
    {
        _mongo = mongo;
        _jwt = jwt.Value;
        _auth = auth.Value;
        _email = email;
        _sessions = sessions;
        _logger = logger;
        _passwordHasher = new PasswordHasher<User>();
        _protector = dataProtection.CreateProtector("FreelanceTn.2FA");
        // Le lien de développement n'est exposé qu'en Development, et seulement
        // si les e-mails sont réellement écrits dans le dossier local.
        _exposeDevEmailLinks = _auth.ExposeDevEmailLinks &&
                               environment.IsDevelopment() &&
                               _email.Transport == EmailTransport.DevOutbox;
    }

    private IMongoCollection<User> Users => _mongo.GetCollection<User>(_mongo.Settings.UsersCollection);

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    /// <summary>
    /// Masque l'adresse pour les logs et l'interface : « soumaya.arbi@esprit.tn »
    /// devient « so***@esprit.tn ». L'adresse complète n'est jamais exposée.
    /// </summary>
    public static string MaskEmail(string email)
    {
        var trimmed = email.Trim();
        var at = trimmed.IndexOf('@');
        if (at <= 0)
        {
            return "***";
        }

        var local = trimmed[..at];
        var domain = trimmed[(at + 1)..];
        var visible = local.Length <= 2 ? local[..1] : local[..2];
        return $"{visible}***@{domain}";
    }

    public async Task<RegisterResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken)
    {
        var normalized = NormalizeEmail(request.Email);
        var now = DateTime.UtcNow;

        // Contrôle explicite avant insertion : le message est clair et l'index
        // unique sur "emailNormalized" reste la garantie en cas de course.
        var alreadyExists = await Users
            .Find(u => u.EmailNormalized == normalized)
            .AnyAsync(cancellationToken);
        if (alreadyExists)
        {
            throw new ConflictException("Un compte existe déjà avec cet email.");
        }

        var verificationToken = CreateOpaqueToken();

        var user = new User
        {
            Email = request.Email.Trim(),
            EmailNormalized = normalized,
            Role = UserRole.Normalize(request.Role),
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            Title = request.Title?.Trim() ?? string.Empty,
            Location = request.Location?.Trim() ?? string.Empty,
            Bio = request.Bio?.Trim() ?? string.Empty,
            Skills = request.Skills?.Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToList() ?? [],
            HourlyRate = request.HourlyRate,
            EmailVerified = false,
            EmailVerificationTokenHash = HashToken(verificationToken),
            EmailVerificationExpiresAt = now.AddHours(_auth.VerificationTokenHours),
            EmailVerificationSentAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };

        user.PasswordHash = _passwordHasher.HashPassword(user, request.Password);

        try
        {
            await Users.InsertOneAsync(user, cancellationToken: cancellationToken);
        }
        catch (MongoWriteException exception)
            when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            throw new ConflictException("Un compte existe déjà avec cet email.");
        }

        var delivery = new EmailDeliveryResponse
        {
            Transport = TransportName(),
        };

        string? verificationLink = null;
        try
        {
            verificationLink = await _email.SendVerificationAsync(user.Email, verificationToken, cancellationToken);
            delivery.Sent = true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "L'e-mail de vérification n'a pas pu être envoyé pour l'utilisateur {UserId}.",
                user.Id);

            // L'envoi a échoué : on libère immédiatement la possibilité de
            // redemander un e-mail (le délai anti-abus ne doit pas s'appliquer).
            user.EmailVerificationSentAt = null;
            await Users.UpdateOneAsync(
                u => u.Id == user.Id,
                Builders<User>.Update.Set(u => u.EmailVerificationSentAt, (DateTime?)null),
                cancellationToken: cancellationToken);
        }

        delivery.DevVerificationUrl = _exposeDevEmailLinks && delivery.Sent ? verificationLink : null;

        return new RegisterResponse
        {
            Message = delivery.Sent
                ? "Compte créé. Vérifiez votre adresse e-mail pour activer votre compte."
                : "Compte créé, mais l'e-mail de vérification n'a pas pu être envoyé. Utilisez « Renvoyer l'e-mail » pour réessayer.",
            Email = user.Email,
            RequiresEmailVerification = true,
            EmailDelivery = delivery,
        };
    }

    public async Task<LoginResult> LoginAsync(
        LoginRequest request,
        string? userAgent,
        string? ipAddress,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeEmail(request.Email);
        var user = await Users.Find(u => u.EmailNormalized == normalized).FirstOrDefaultAsync(cancellationToken);

        if (user is null || string.IsNullOrWhiteSpace(user.PasswordHash))
        {
            throw new UnauthorizedException("Email ou mot de passe incorrect.");
        }

        var result = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (result == PasswordVerificationResult.Failed)
        {
            throw new UnauthorizedException("Email ou mot de passe incorrect.");
        }

        if (user.EmailVerified == false)
        {
            throw new ForbiddenException("Veuillez vérifier votre adresse e-mail avant de vous connecter.");
        }

        if (user.TwoFactorEnabled && !string.IsNullOrWhiteSpace(user.TwoFactorSecret))
        {
            var preAuthToken = Guid.NewGuid().ToString("N");
            _preAuthTokens[preAuthToken] = (user.Id, request.RememberMe, DateTime.UtcNow.AddMinutes(5));
            return new LoginResult(user, string.Empty, request.RememberMe, DateTime.UtcNow.AddMinutes(5), true, preAuthToken);
        }

        // Durée du jeton = durée du cookie. « Remember me » prolonge les deux
        // (configurable) ; sinon la session expire avec le navigateur côté
        // cookie et après ExpiryMinutes côté jeton.
        var expiresAt = request.RememberMe
            ? DateTime.UtcNow.AddDays(Math.Max(1, _auth.RememberMeDays))
            : DateTime.UtcNow.AddMinutes(Math.Max(1, _jwt.ExpiryMinutes));

        var (_, sessionKey) = await _sessions.CreateAsync(
            user.Id,
            request.RememberMe,
            userAgent ?? string.Empty,
            ipAddress ?? string.Empty,
            expiresAt,
            cancellationToken);

        var token = CreateSessionToken(user, sessionKey, expiresAt);
        return new LoginResult(user, token, request.RememberMe, expiresAt);
    }

    public async Task<(string Secret, string OtpAuthUri)> StartTwoFactorSetupAsync(string userId, CancellationToken cancellationToken)
    {
        var user = await GetByIdAsync(userId, cancellationToken) ?? throw new UnauthorizedException("Session invalide.");
        var secretBytes = RandomNumberGenerator.GetBytes(20);
        var secret = Base32Encode(secretBytes);
        user.TwoFactorSecret = _protector.Protect(secret);
        user.TwoFactorEnabled = false;
        user.UpdatedAt = DateTime.UtcNow;
        await Users.ReplaceOneAsync(u => u.Id == userId, user, cancellationToken: cancellationToken);
        var issuer = "FreelanceTN";
        var account = user.Email;
        var uri = $"otpauth://totp/{Uri.EscapeDataString(issuer)}:{Uri.EscapeDataString(account)}?secret={secret}&issuer={Uri.EscapeDataString(issuer)}&digits=6&period=30";
        return (secret, uri);
    }

    public async Task<List<string>> EnableTwoFactorAsync(string userId, string code, CancellationToken cancellationToken)
    {
        var user = await GetByIdAsync(userId, cancellationToken) ?? throw new UnauthorizedException("Session invalide.");
        if (string.IsNullOrWhiteSpace(user.TwoFactorSecret))
        {
            throw new BadRequestException("Configuration 2FA non initialisée.");
        }
        var secret = _protector.Unprotect(user.TwoFactorSecret);
        if (!VerifyTotp(secret, code))
        {
            throw new BadRequestException("Code 2FA invalide.");
        }
        user.TwoFactorEnabled = true;
        user.TwoFactorEnabledAt = DateTime.UtcNow;
        var recoveryCodes = Enumerable.Range(0, 8).Select(_ => GenerateRecoveryCode()).ToList();
        user.RecoveryCodeHashes = recoveryCodes.Select(HashRecoveryCode).ToList();
        user.UpdatedAt = DateTime.UtcNow;
        await Users.ReplaceOneAsync(u => u.Id == userId, user, cancellationToken: cancellationToken);
        return recoveryCodes;
    }

    public async Task DisableTwoFactorAsync(string userId, string password, CancellationToken cancellationToken)
    {
        var user = await GetByIdAsync(userId, cancellationToken) ?? throw new UnauthorizedException("Session invalide.");
        if (string.IsNullOrWhiteSpace(user.PasswordHash) || _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password) == PasswordVerificationResult.Failed)
        {
            throw new UnauthorizedException("Mot de passe incorrect.");
        }
        user.TwoFactorEnabled = false;
        user.TwoFactorSecret = null;
        user.TwoFactorEnabledAt = null;
        user.RecoveryCodeHashes = [];
        user.UpdatedAt = DateTime.UtcNow;
        await Users.ReplaceOneAsync(u => u.Id == userId, user, cancellationToken: cancellationToken);
    }

    public async Task<List<string>> RegenerateRecoveryCodesAsync(string userId, string password, CancellationToken cancellationToken)
    {
        var user = await GetByIdAsync(userId, cancellationToken) ?? throw new UnauthorizedException("Session invalide.");
        if (!user.TwoFactorEnabled)
        {
            throw new BadRequestException("2FA non activée.");
        }
        if (string.IsNullOrWhiteSpace(user.PasswordHash) || _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password) == PasswordVerificationResult.Failed)
        {
            throw new UnauthorizedException("Mot de passe incorrect.");
        }
        var recoveryCodes = Enumerable.Range(0, 8).Select(_ => GenerateRecoveryCode()).ToList();
        user.RecoveryCodeHashes = recoveryCodes.Select(HashRecoveryCode).ToList();
        user.UpdatedAt = DateTime.UtcNow;
        await Users.ReplaceOneAsync(u => u.Id == userId, user, cancellationToken: cancellationToken);
        return recoveryCodes;
    }

    public async Task<LoginResult> CompleteTwoFactorLoginAsync(string preAuthToken, string code, string? userAgent, string? ipAddress, CancellationToken cancellationToken)
    {
        if (!_preAuthTokens.TryGetValue(preAuthToken, out var entry) || entry.ExpiresAt < DateTime.UtcNow)
        {
            throw new UnauthorizedException("Session de pré-authentification expirée.");
        }
        var user = await GetByIdAsync(entry.UserId, cancellationToken) ?? throw new UnauthorizedException("Session invalide.");
        if (user.TwoFactorLockoutUntil.HasValue && user.TwoFactorLockoutUntil.Value > DateTime.UtcNow)
        {
            throw new ForbiddenException("Trop de tentatives. Réessayez plus tard.");
        }

        bool valid = false;
        string? usedRecoveryHash = null;
        if (!string.IsNullOrWhiteSpace(user.TwoFactorSecret))
        {
            var secret = _protector.Unprotect(user.TwoFactorSecret);
            valid = VerifyTotp(secret, code);
        }
        if (!valid)
        {
            // recovery code?
            var hash = HashRecoveryCode(code);
            if (user.RecoveryCodeHashes.Contains(hash))
            {
                valid = true;
                usedRecoveryHash = hash;
            }
        }

        // (no debug logging in production)

        if (!valid)
        {
            user.TwoFactorFailedAttempts++;
            if (user.TwoFactorFailedAttempts >= 5)
            {
                user.TwoFactorLockoutUntil = DateTime.UtcNow.AddMinutes(15);
                user.TwoFactorFailedAttempts = 0;
            }
            await Users.ReplaceOneAsync(u => u.Id == user.Id, user, cancellationToken: cancellationToken);
            throw new UnauthorizedException("Code 2FA invalide.");
        }

        _preAuthTokens.TryRemove(preAuthToken, out _);

        if (usedRecoveryHash is not null)
        {
            user.RecoveryCodeHashes.Remove(usedRecoveryHash);
        }
        user.TwoFactorFailedAttempts = 0;
        user.TwoFactorLockoutUntil = null;

        var expiresAt = entry.RememberMe
            ? DateTime.UtcNow.AddDays(Math.Max(1, _auth.RememberMeDays))
            : DateTime.UtcNow.AddMinutes(Math.Max(1, _jwt.ExpiryMinutes));
        var (_, sessionKey) = await _sessions.CreateAsync(user.Id, entry.RememberMe, userAgent ?? string.Empty, ipAddress ?? string.Empty, expiresAt, cancellationToken);
        var token = CreateSessionToken(user, sessionKey, expiresAt);
        user.UpdatedAt = DateTime.UtcNow;
        await Users.ReplaceOneAsync(u => u.Id == user.Id, user, cancellationToken: cancellationToken);
        return new LoginResult(user, token, entry.RememberMe, expiresAt);
    }

    private static string GenerateRecoveryCode() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant();

    private static string HashRecoveryCode(string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code.Trim())));

    private static bool VerifyTotp(string secretBase32, string code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length != 6 || !code.All(char.IsDigit)) return false;
        var secret = Base32Decode(secretBase32);
        var unixTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        for (long offset = -1; offset <= 1; offset++)
        {
            var counter = (unixTime / 30) + offset;
            var expected = ComputeTotp(secret, counter);
            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(code)))
            {
                return true;
            }
        }
        return false;
    }

    private static string ComputeTotp(byte[] secret, long counter)
    {
        var counterBytes = BitConverter.GetBytes(counter);
        if (BitConverter.IsLittleEndian) Array.Reverse(counterBytes);
        using var hmac = new HMACSHA1(secret);
        var hash = hmac.ComputeHash(counterBytes);
        var offset = hash[^1] & 0x0F;
        var binary = ((hash[offset] & 0x7F) << 24)
                   | ((hash[offset + 1] & 0xFF) << 16)
                   | ((hash[offset + 2] & 0xFF) << 8)
                   | (hash[offset + 3] & 0xFF);
        var otp = binary % 1_000_000;
        return otp.ToString("D6");
    }

    private static string Base32Encode(byte[] data)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var result = new StringBuilder();
        int bits = 0, value = 0;
        foreach (var b in data)
        {
            value = (value << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                result.Append(alphabet[(value >> (bits - 5)) & 0x1F]);
                bits -= 5;
            }
        }
        if (bits > 0)
        {
            result.Append(alphabet[(value << (5 - bits)) & 0x1F]);
        }
        return result.ToString();
    }

    private static byte[] Base32Decode(string input)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var cleaned = input.Trim().Replace(" ", "").ToUpperInvariant();
        var bits = 0;
        var value = 0;
        var output = new List<byte>();
        foreach (var c in cleaned)
        {
            var idx = alphabet.IndexOf(c);
            if (idx < 0) continue;
            value = (value << 5) | idx;
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)((value >> (bits - 8)) & 0xFF));
                bits -= 8;
            }
        }
        return output.ToArray();
    }

    public async Task<VerifyEmailResponse> VerifyEmailAsync(string token, CancellationToken cancellationToken)
    {
        var normalizedToken = token.Trim();
        if (normalizedToken.Length == 0)
        {
            throw new BadRequestException(
                "Ce lien de vérification est incomplet. Demandez un nouvel e-mail de vérification.");
        }

        var hash = HashToken(normalizedToken);
        var user = await Users
            .Find(u => u.EmailVerificationTokenHash == hash)
            .FirstOrDefaultAsync(cancellationToken);

        if (user is null)
        {
            // Jeton inconnu : soit jamais émis, soit déjà consommé par une
            // vérification précédente. Le message reste explicite et actionnable.
            throw new BadRequestException(
                "Ce lien de vérification n'est pas valide ou a déjà été utilisé. Demandez un nouvel e-mail.");
        }

        var now = DateTime.UtcNow;
        if (user.EmailVerificationExpiresAt is null || user.EmailVerificationExpiresAt < now)
        {
            // Nettoyage : un lien expiré ne doit pas rester indéfiniment valable.
            await Users.UpdateOneAsync(
                u => u.Id == user.Id,
                Builders<User>.Update
                    .Set(u => u.EmailVerificationTokenHash, (string?)null)
                    .Set(u => u.EmailVerificationExpiresAt, (DateTime?)null)
                    .Set(u => u.EmailVerificationSentAt, (DateTime?)null)
                    .Set(u => u.UpdatedAt, now),
                cancellationToken: cancellationToken);

            throw new BadRequestException(
                "Ce lien de vérification a expiré. Demandez un nouvel e-mail de vérification.");
        }

        user.EmailVerified = true;
        user.EmailVerificationTokenHash = null;
        user.EmailVerificationExpiresAt = null;
        user.EmailVerificationSentAt = null;
        user.UpdatedAt = now;

        await Users.ReplaceOneAsync(u => u.Id == user.Id, user, cancellationToken: cancellationToken);

        return new VerifyEmailResponse
        {
            Message = "Votre adresse e-mail est vérifiée. Vous pouvez maintenant vous connecter.",
            Email = user.Email,
            EmailVerified = true,
        };
    }

    public async Task<ResendVerificationResponse> ResendVerificationAsync(string email, CancellationToken cancellationToken)
    {
        const string genericMessage =
            "Si un compte non vérifié correspond à cette adresse, un nouvel e-mail de vérification a été envoyé.";

        var normalized = NormalizeEmail(email);
        var user = await Users.Find(u => u.EmailNormalized == normalized).FirstOrDefaultAsync(cancellationToken);

        // Compte inexistant ou déjà vérifié : réponse générique identique pour
        // éviter d'énumérer les adresses inscrites.
        if (user is null || user.EmailVerified != false)
        {
            return new ResendVerificationResponse { Message = genericMessage };
        }

        var now = DateTime.UtcNow;
        if (user.EmailVerificationSentAt is not null)
        {
            var elapsed = now - user.EmailVerificationSentAt.Value;
            var cooldown = TimeSpan.FromSeconds(Math.Max(0, _auth.ResendCooldownSeconds));
            if (elapsed < cooldown)
            {
                var remaining = (int)Math.Ceiling((cooldown - elapsed).TotalSeconds);
                return new ResendVerificationResponse
                {
                    Message = $"Un e-mail de vérification a déjà été envoyé récemment. Réessayez dans {remaining} seconde(s).",
                    Sent = false,
                    CooldownSeconds = remaining,
                };
            }
        }

        var verificationToken = CreateOpaqueToken();
        user.EmailVerificationTokenHash = HashToken(verificationToken);
        user.EmailVerificationExpiresAt = now.AddHours(_auth.VerificationTokenHours);
        user.EmailVerificationSentAt = now;
        user.UpdatedAt = now;

        await Users.ReplaceOneAsync(u => u.Id == user.Id, user, cancellationToken: cancellationToken);

        string verificationLink;
        try
        {
            verificationLink = await _email.SendVerificationAsync(user.Email, verificationToken, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Le nouvel e-mail de vérification n'a pas pu être envoyé pour l'utilisateur {UserId}.",
                user.Id);

            // Libère le délai anti-abus pour permettre une nouvelle tentative.
            await Users.UpdateOneAsync(
                u => u.Id == user.Id,
                Builders<User>.Update.Set(u => u.EmailVerificationSentAt, (DateTime?)null),
                cancellationToken: cancellationToken);

            throw new EmailDeliveryException(
                "L'e-mail de vérification n'a pas pu être envoyé. Vérifiez la configuration e-mail puis réessayez.");
        }

        return new ResendVerificationResponse
        {
            Message = genericMessage,
            Sent = true,
            DevVerificationUrl = _exposeDevEmailLinks ? verificationLink : null,
        };
    }

    public async Task ForgotPasswordAsync(string email, CancellationToken cancellationToken)
    {
        var normalized = NormalizeEmail(email);
        var user = await Users.Find(u => u.EmailNormalized == normalized).FirstOrDefaultAsync(cancellationToken);

        // Réponse générique : l'existence du compte n'est jamais révélée.
        if (user is null)
        {
            return;
        }

        var now = DateTime.UtcNow;

        // Anti-abus : une nouvelle demande trop rapprochée ne régénère pas de
        // jeton et ne renvoie pas d'e-mail. La réponse reste identique.
        if (user.PasswordResetSentAt is not null &&
            user.PasswordResetSentAt > now.AddSeconds(-Math.Max(1, _auth.ForgotPasswordCooldownSeconds)))
        {
            return;
        }

        var resetToken = CreateOpaqueToken();
        user.PasswordResetTokenHash = HashToken(resetToken);
        user.PasswordResetExpiresAt = now.AddMinutes(_auth.ResetTokenMinutes);
        user.PasswordResetSentAt = now;
        user.UpdatedAt = now;

        await Users.ReplaceOneAsync(u => u.Id == user.Id, user, cancellationToken: cancellationToken);

        try
        {
            await _email.SendPasswordResetAsync(user.Email, resetToken, _auth.ResetTokenMinutes, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "L'e-mail de réinitialisation n'a pas pu être envoyé pour l'utilisateur {UserId}.", user.Id);
        }
    }

    public async Task ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        var hash = HashToken(request.Token.Trim());
        var user = await Users
            .Find(u => u.PasswordResetTokenHash == hash)
            .FirstOrDefaultAsync(cancellationToken);

        if (user is null || user.PasswordResetExpiresAt is null || user.PasswordResetExpiresAt < DateTime.UtcNow)
        {
            throw new BadRequestException("Ce lien de réinitialisation est invalide ou expiré.");
        }

        user.PasswordHash = _passwordHasher.HashPassword(user, request.Password);
        user.PasswordResetTokenHash = null;
        user.PasswordResetExpiresAt = null;
        user.PasswordResetSentAt = null;
        user.PasswordChangedAt = DateTime.UtcNow;
        user.EmailVerified = true;
        user.UpdatedAt = DateTime.UtcNow;

        await Users.ReplaceOneAsync(u => u.Id == user.Id, user, cancellationToken: cancellationToken);

        // Invalidation immédiate de toutes les sessions existantes : un ancien
        // cookie ne doit plus donner accès après une réinitialisation.
        await _sessions.RevokeAllAsync(user.Id, cancellationToken);
    }

    /// <summary>
    /// Change le mot de passe depuis le compte connecté, après vérification de
    /// l'ancien mot de passe. Toutes les autres sessions sont révoquées.
    /// </summary>
    public async Task ChangePasswordAsync(
        string userId,
        string currentPassword,
        string newPassword,
        string? currentSessionKey,
        CancellationToken cancellationToken)
    {
        var user = await GetByIdAsync(userId, cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (string.IsNullOrWhiteSpace(user.PasswordHash))
        {
            throw new BadRequestException(
                "Ce compte utilise la connexion Google : définissez un mot de passe via « Mot de passe oublié ».");
        }

        var result = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, currentPassword);
        if (result == PasswordVerificationResult.Failed)
        {
            throw new BadRequestException("Le mot de passe actuel est incorrect.");
        }

        user.PasswordHash = _passwordHasher.HashPassword(user, newPassword);
        user.RequirePasswordChange = false;
        user.PasswordResetTokenHash = null;
        user.PasswordResetExpiresAt = null;
        user.PasswordResetSentAt = null;
        user.PasswordChangedAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;
        await Users.ReplaceOneAsync(u => u.Id == user.Id, user, cancellationToken: cancellationToken);

        var team = _mongo.GetCollection<TeamMember>(_mongo.Settings.TeamMembersCollection);
        var memberUpdate = Builders<TeamMember>.Update
            .Set(m => m.Status, TeamMember.Statuses.Active)
            .Set(m => m.AcceptedAt, DateTime.UtcNow)
            .Set(m => m.InviteTokenHash, null)
            .Set(m => m.InviteExpiresAt, null)
            .Set(m => m.UpdatedAt, DateTime.UtcNow);
        await team.UpdateManyAsync(
            m => (m.UserId == user.Id || m.EmailNormalized == user.EmailNormalized) && m.Status == TeamMember.Statuses.Pending,
            memberUpdate,
            cancellationToken: cancellationToken);

        await _sessions.RevokeOthersAsync(user.Id, currentSessionKey, cancellationToken);
    }

    public async Task<(User User, string Token)> LoginWithGoogleAsync(
        GoogleUserInfo info,
        string? requestedRole,
        CancellationToken cancellationToken)
    {
        var googleId = info.Subject.Trim();
        var normalized = NormalizeEmail(info.Email);
        var now = DateTime.UtcNow;

        // Diagnostic ciblé : jamais l'adresse complète, uniquement une forme
        // masquée, et toujours la base/collection réellement interrogées.
        var database = _mongo.Settings.DatabaseName;
        var collection = _mongo.Settings.UsersCollection;
        var maskedGoogleEmail = MaskEmail(normalized);

        _logger.LogInformation(
            "Connexion Google : adresse renvoyée par Google = {MaskedEmail} (email_verified={GoogleEmailVerified}); " +
            "recherche dans {Database}.{Collection}.",
            maskedGoogleEmail,
            info.EmailVerified,
            database,
            collection);

        var user = await Users.Find(u => u.GoogleId == googleId).FirstOrDefaultAsync(cancellationToken);
        if (user is not null)
        {
            _logger.LogInformation(
                "Connexion Google : document trouvé par googleId dans {Database}.{Collection} : " +
                "_id={UserId}, email={MaskedEmail}.",
                database,
                collection,
                user.Id,
                MaskEmail(user.Email));

            return (user, CreateSessionToken(user));
        }

        var existing = await Users.Find(u => u.EmailNormalized == normalized).FirstOrDefaultAsync(cancellationToken);
        if (existing is null)
        {
            _logger.LogInformation(
                "Connexion Google : aucun document pour {MaskedEmail} dans {Database}.{Collection}.",
                maskedGoogleEmail,
                database,
                collection);
        }
        else
        {
            // Vérifie que le document retrouvé correspond réellement à l'adresse
            // Google normalisée (détecte une donnée incohérente ou un index périmé).
            var storedNormalized = NormalizeEmail(existing.Email);
            var exactMatch = existing.EmailNormalized == normalized && storedNormalized == normalized;

            _logger.LogInformation(
                "Connexion Google : document trouvé par emailNormalized dans {Database}.{Collection} : " +
                "_id={UserId}, email={MaskedEmail}, emailVerified={EmailVerified}, createdAt={CreatedAtUtc:O}, " +
                "correspondanceExacte={ExactMatch}.",
                database,
                collection,
                existing.Id,
                MaskEmail(existing.Email),
                existing.EmailVerified is null ? "champ absent (null)" : existing.EmailVerified.ToString(),
                existing.CreatedAt,
                exactMatch);

            if (!exactMatch)
            {
                // Le document indexé ne correspond pas à l'adresse : on refuse
                // plutôt que d'associer Google au mauvais compte.
                _logger.LogError(
                    "Connexion Google refusée : incohérence de données pour l'utilisateur {UserId} " +
                    "dans {Database}.{Collection} (emailNormalized ne correspond pas à email).",
                    existing.Id,
                    database,
                    collection);

                throw new OAuthException(
                    "account_mismatch",
                    "Les données de ce compte sont incohérentes. Contactez le support FreelanceTN.");
            }

            // Compte local non vérifié : on n'associe pas Google automatiquement,
            // car l'adresse a pu être réservée par un tiers avant vérification.
            // L'utilisateur doit d'abord prouver qu'il possède le compte local.
            if (existing.EmailVerified == false)
            {
                var maskedEmail = MaskEmail(existing.Email);

                // Trace utile au support : uniquement une adresse masquée.
                _logger.LogWarning(
                    "Connexion Google refusée : un compte local non vérifié existe pour {MaskedEmail} (id {UserId}).",
                    maskedEmail,
                    existing.Id);

                // On ne lie pas le compte, mais on ne laisse pas l'utilisateur dans
                // une impasse : le renvoi utilise le mécanisme existant (cooldown
                // anti-abus inclus) et ne peut être déclenché que par quelqu'un qui
                // vient de s'authentifier chez Google avec cette adresse.
                var verificationSent = false;
                int? cooldownSeconds = null;
                try
                {
                    var resend = await ResendVerificationAsync(existing.Email, cancellationToken);
                    verificationSent = resend.Sent;
                    cooldownSeconds = resend.CooldownSeconds;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    // L'échec d'envoi ne doit pas masquer la cause réelle (compte
                    // non vérifié) : on la conserve et on signale l'absence d'envoi.
                    _logger.LogWarning(
                        exception,
                        "Le renvoi automatique de l'e-mail de vérification a échoué pour l'utilisateur {UserId}.",
                        existing.Id);
                }

                throw new OAuthException(
                    "account_exists_unverified",
                    "Un compte FreelanceTN non vérifié existe déjà avec cette adresse e-mail. Vérifiez d'abord votre e-mail ou connectez-vous avec votre mot de passe.",
                    maskedEmail,
                    verificationSent,
                    cooldownSeconds);
            }

            if (string.IsNullOrWhiteSpace(existing.GoogleId))
            {
                existing.GoogleId = googleId;
            }

            existing.EmailVerified = true;
            if (string.IsNullOrWhiteSpace(existing.FirstName) && !string.IsNullOrWhiteSpace(info.FirstName))
            {
                existing.FirstName = info.FirstName.Trim();
            }
            if (string.IsNullOrWhiteSpace(existing.LastName) && !string.IsNullOrWhiteSpace(info.LastName))
            {
                existing.LastName = info.LastName.Trim();
            }
            if (string.IsNullOrWhiteSpace(existing.Avatar) && !string.IsNullOrWhiteSpace(info.Picture))
            {
                existing.Avatar = info.Picture.Trim();
            }
            existing.UpdatedAt = now;

            await Users.ReplaceOneAsync(u => u.Id == existing.Id, existing, cancellationToken: cancellationToken);

            _logger.LogInformation(
                "Connexion Google : compte local {UserId} associé à Google pour {MaskedEmail} dans {Database}.{Collection}.",
                existing.Id,
                maskedGoogleEmail,
                database,
                collection);

            return (existing, CreateSessionToken(existing));
        }

        if (!UserRole.IsValid(requestedRole))
        {
            throw new OAuthException(
                "role_required",
                "Choisissez votre rôle avant de créer un compte avec Google.");
        }

        var created = new User
        {
            Email = info.Email.Trim(),
            EmailNormalized = normalized,
            PasswordHash = string.Empty,
            Role = UserRole.Normalize(requestedRole),
            FirstName = info.FirstName.Trim(),
            LastName = info.LastName.Trim(),
            Avatar = info.Picture.Trim(),
            EmailVerified = true,
            GoogleId = googleId,
            CreatedAt = now,
            UpdatedAt = now,
        };

        try
        {
            await Users.InsertOneAsync(created, cancellationToken: cancellationToken);

            _logger.LogInformation(
                "Connexion Google : nouveau compte créé pour {MaskedEmail} dans {Database}.{Collection} (_id={UserId}).",
                maskedGoogleEmail,
                database,
                collection,
                created.Id);
        }
        catch (MongoWriteException exception)
            when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            var concurrent = await Users.Find(u => u.EmailNormalized == normalized).FirstOrDefaultAsync(cancellationToken);
            if (concurrent is null)
            {
                throw new ConflictException("Un compte existe déjà avec cet email.");
            }
            return (concurrent, CreateSessionToken(concurrent));
        }

        return (created, CreateSessionToken(created));
    }

    public async Task<User?> GetByIdAsync(string userId, CancellationToken cancellationToken)
    {
        return await Users.Find(u => u.Id == userId).FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Annuaire public : uniquement les comptes ayant le rôle freelance. Les
    /// informations sensibles (email, mot de passe, jetons) ne sont jamais
    /// renvoyées par l'endpoint qui consomme cette liste.
    /// </summary>
    public async Task<List<User>> ListFreelancersAsync(CancellationToken cancellationToken)
    {
        return await Users
            .Find(u => u.Role == UserRole.Freelancer)
            .SortBy(u => u.FirstName)
            .ToListAsync(cancellationToken);
    }

    public async Task<UserResponse> UpdateProfileAsync(string userId, UpdateProfileRequest request, CancellationToken cancellationToken)
    {
        var user = await GetByIdAsync(userId, cancellationToken)
            ?? throw new UnauthorizedException("Session invalide.");

        if (request.FirstName is not null) user.FirstName = request.FirstName.Trim();
        if (request.LastName is not null) user.LastName = request.LastName.Trim();
        if (request.Title is not null) user.Title = request.Title.Trim();
        if (request.Location is not null) user.Location = request.Location.Trim();
        if (request.Phone is not null) user.Phone = request.Phone.Trim();
        if (request.LinkedIn is not null) user.LinkedIn = request.LinkedIn.Trim();
        if (request.GitHub is not null) user.GitHub = request.GitHub.Trim();
        if (request.Website is not null) user.Website = request.Website.Trim();
        if (request.Bio is not null) user.Bio = request.Bio.Trim();
        if (request.Avatar is not null) user.Avatar = request.Avatar.Trim();
        if (request.CoverImage is not null) user.CoverImage = request.CoverImage.Trim();
        if (request.AvatarConfig is not null) user.AvatarConfig = request.AvatarConfig;
        if (request.AvatarSource is not null)
        {
            var source = request.AvatarSource.Trim().ToLowerInvariant();
            if (source is "initials" or "preset" or "upload" or "generated")
            {
                user.AvatarSource = source;
            }
        }
        if (request.Skills is not null)
        {
            user.Skills = request.Skills.Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToList();
        }
        if (request.HourlyRate.HasValue) user.HourlyRate = request.HourlyRate.Value;

        if (request.Experiences is not null)
        {
            user.Experiences = request.Experiences.Select(e => new CvExperience
            {
                Id = string.IsNullOrWhiteSpace(e.Id) ? Guid.NewGuid().ToString("N") : e.Id.Trim(),
                Role = e.Role?.Trim() ?? string.Empty,
                Company = e.Company?.Trim() ?? string.Empty,
                Location = e.Location?.Trim() ?? string.Empty,
                Period = e.Period?.Trim() ?? string.Empty,
                StartDate = CleanDate(e.StartDate),
                EndDate = CleanDate(e.EndDate),
                IsCurrent = e.IsCurrent,
                Technologies = CleanList(e.Technologies, 40),
                Description = e.Description?.Trim() ?? string.Empty,
            }).ToList();
        }

        if (request.Education is not null)
        {
            user.Education = request.Education.Select(e => new CvEducation
            {
                Id = string.IsNullOrWhiteSpace(e.Id) ? Guid.NewGuid().ToString("N") : e.Id.Trim(),
                Degree = e.Degree?.Trim() ?? string.Empty,
                Institution = e.Institution?.Trim() ?? string.Empty,
                Specialty = e.Specialty?.Trim() ?? string.Empty,
                Location = e.Location?.Trim() ?? string.Empty,
                Period = e.Period?.Trim() ?? string.Empty,
                StartDate = CleanDate(e.StartDate),
                EndDate = CleanDate(e.EndDate),
                Description = e.Description?.Trim() ?? string.Empty,
            }).ToList();
        }

        if (request.Certifications is not null)
        {
            user.Certifications = request.Certifications.Select(c => new CvCertification
            {
                Id = string.IsNullOrWhiteSpace(c.Id) ? Guid.NewGuid().ToString("N") : c.Id.Trim(),
                Name = c.Name?.Trim() ?? string.Empty,
                Issuer = c.Issuer?.Trim() ?? string.Empty,
                Year = c.Year?.Trim() ?? string.Empty,
            }).Where(c => c.Name.Length > 0).ToList();
        }

        if (request.Languages is not null)
        {
            user.Languages = request.Languages.Select(l => new CvLanguage
            {
                Id = string.IsNullOrWhiteSpace(l.Id) ? Guid.NewGuid().ToString("N") : l.Id.Trim(),
                Name = l.Name?.Trim() ?? string.Empty,
                Level = CanonicalizeLanguageLevel(l.Level),
            }).Where(l => l.Name.Length > 0).ToList();
        }

        if (request.WorkPreferences is not null)
        {
            user.WorkPreferences = new CvWorkPreferences
            {
                ProjectTypes = request.WorkPreferences.ProjectTypes
                    .Select(p => p?.Trim() ?? string.Empty)
                    .Where(p => p.Length > 0)
                    .Distinct()
                    .ToList(),
                WorkPreference = request.WorkPreferences.WorkPreference?.Trim() ?? string.Empty,
                MinimumBudget = request.WorkPreferences.MinimumBudget?.Trim() ?? string.Empty,
            };
        }

        user.UpdatedAt = DateTime.UtcNow;

        await Users.ReplaceOneAsync(u => u.Id == userId, user, cancellationToken: cancellationToken);
        return ToResponse(user);
    }

    /// <summary>
    /// Crée ou met à jour le compte d'un membre d'équipe invité, sans jamais
    /// exposer de mot de passe en clair. Le mot de passe est hashé immédiatement.
    /// </summary>
    public async Task<User> CreateOrActivateTeamMemberAsync(string email, string password, CancellationToken cancellationToken)
    {
        var normalized = NormalizeEmail(email);
        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
        {
            throw new BadRequestException("Le mot de passe doit contenir au moins 8 caractères.");
        }

        var user = await Users.Find(u => u.EmailNormalized == normalized).FirstOrDefaultAsync(cancellationToken);
        var now = DateTime.UtcNow;
        if (user is null)
        {
            user = new User
            {
                Email = email.Trim(),
                EmailNormalized = normalized,
                Role = UserRole.Client,
                EmailVerified = true,
                FirstName = string.Empty,
                LastName = string.Empty,
                CreatedAt = now,
                UpdatedAt = now,
            };
            user.PasswordHash = _passwordHasher.HashPassword(user, password);
            await Users.InsertOneAsync(user, cancellationToken: cancellationToken);
        }
        else
        {
            user.PasswordHash = _passwordHasher.HashPassword(user, password);
            user.EmailVerified = true;
            user.RequirePasswordChange = false;
            user.UpdatedAt = now;
            await Users.ReplaceOneAsync(u => u.Id == user.Id, user, cancellationToken: cancellationToken);
        }

        return user;
    }

    /// <summary>
    /// Normalise le niveau de langue vers Basic / Intermediate / Advanced / Native.
    /// Une valeur vide reste vide : aucun niveau n'est inventé à l'enregistrement.
    /// </summary>
    internal static string CanonicalizeLanguageLevel(string? value)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (trimmed.Length == 0) return string.Empty;

        var key = trimmed.ToLowerInvariant()
            .Replace('é', 'e')
            .Replace('è', 'e')
            .Replace('ê', 'e');

        return key switch
        {
            "basic" or "beginner" or "debutant" or "notions" or "a1" => "Basic",
            "intermediate" or "intermediaire" or "moyen" or "a2" or "b1" => "Intermediate",
            "advanced" or "avance" or "courant" or "fluent" or "b2" or "c1" => "Advanced",
            "native" or "natif" or "maternelle" or "bilingue" or "bilingual" or "c2" => "Native",
            _ => trimmed,
        };
    }

    /// <summary>Normalise une date « AAAA-MM » ou « AAAA ». Une valeur libre courte reste acceptée.</summary>
    private static string CleanDate(string? value)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (trimmed.Length > 20) trimmed = trimmed[..20];
        return trimmed;
    }

    private static List<string> CleanList(IEnumerable<string>? values, int maxLength) =>
        (values ?? [])
            .Select(value => (value ?? string.Empty).Trim())
            .Where(value => value.Length > 0 && value.Length <= maxLength)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(50)
            .ToList();

    public string CreateSessionToken(User user) =>
        CreateSessionToken(user, null, DateTime.UtcNow.AddMinutes(_jwt.ExpiryMinutes));

    public string CreateSessionToken(User user, string? sessionKey, DateTime expiresAt)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(ClaimTypes.Role, user.Role),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        if (!string.IsNullOrWhiteSpace(sessionKey))
        {
            claims.Add(new Claim("sid", sessionKey));
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.Key));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public static UserResponse ToResponse(User user) => new()
    {
        Id = user.Id,
        Email = user.Email,
        EmailVerified = user.EmailVerified != false,
        HasPassword = !string.IsNullOrWhiteSpace(user.PasswordHash),
        RequirePasswordChange = user.RequirePasswordChange,
        Role = user.Role,
        FirstName = user.FirstName,
        LastName = user.LastName,
        Title = user.Title,
        Location = user.Location,
        Phone = user.Phone ?? string.Empty,
        LinkedIn = user.LinkedIn ?? string.Empty,
        GitHub = user.GitHub ?? string.Empty,
        Website = user.Website ?? string.Empty,
        Bio = user.Bio,
        Avatar = user.Avatar,
        AvatarSource = user.AvatarSource,
        AvatarPreset = user.AvatarPreset,
        AvatarColor = user.AvatarColor,
        AvatarConfig = user.AvatarConfig,
        CompanyName = user.CompanyName,
        CompanyLogo = user.CompanyLogo,
        CoverImage = user.CoverImage,
        Industry = user.Industry,
        Position = user.Position,
        CompanyWebsite = user.CompanyWebsite,
        CompanySize = user.CompanySize,
        CompanyDescription = user.CompanyDescription,
        Country = user.Country,
        Governorate = user.Governorate,
        City = user.City,
        BusinessAddress = user.BusinessAddress,
        PersonalPresentation = user.PersonalPresentation,
        ProfessionalEmail = user.ProfessionalEmail,
        ProfessionalPhone = user.ProfessionalPhone,
        Skills = user.Skills,
        HourlyRate = user.HourlyRate,
        Experiences = user.Experiences.Select(e => new CvExperienceDto
        {
            Id = e.Id,
            Role = e.Role,
            Company = e.Company,
            Location = e.Location,
            Period = e.Period,
            StartDate = e.StartDate,
            EndDate = e.EndDate,
            IsCurrent = e.IsCurrent,
            Technologies = e.Technologies,
            Description = e.Description,
        }).ToList(),
        Education = user.Education.Select(e => new CvEducationDto
        {
            Id = e.Id,
            Degree = e.Degree,
            Institution = e.Institution,
            Specialty = e.Specialty,
            Location = e.Location,
            Period = e.Period,
            StartDate = e.StartDate,
            EndDate = e.EndDate,
            Description = e.Description,
        }).ToList(),
        Languages = user.Languages.Select(l => new CvLanguageDto
        {
            Id = l.Id,
            Name = l.Name,
            Level = l.Level,
        }).ToList(),
        Certifications = user.Certifications.Select(c => new CvCertificationDto
        {
            Id = c.Id,
            Name = c.Name,
            Issuer = c.Issuer,
            Year = c.Year,
        }).ToList(),
        WorkPreferences = new CvWorkPreferencesDto
        {
            ProjectTypes = user.WorkPreferences.ProjectTypes,
            WorkPreference = user.WorkPreferences.WorkPreference,
            MinimumBudget = user.WorkPreferences.MinimumBudget,
        },
        CreatedAt = user.CreatedAt,
        UpdatedAt = user.UpdatedAt,
    };

    private string TransportName() => _email.Transport switch
    {
        EmailTransport.Smtp => "smtp",
        EmailTransport.DevOutbox => "dev-outbox",
        _ => "none",
    };

    private static string CreateOpaqueToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static string HashToken(string token)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    }
}

public record GoogleUserInfo(
    string Subject,
    string Email,
    bool EmailVerified,
    string FirstName,
    string LastName,
    string Picture);

/// <summary>Résultat d'une connexion réussie : jeton, persistance et expiration.</summary>
public record LoginResult(User User, string Token, bool Persistent, DateTime ExpiresAt, bool RequiresTwoFactor = false, string? PreAuthToken = null);
