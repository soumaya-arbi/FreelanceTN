using System.Security.Cryptography;
using System.Text;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Dtos.Account;
using FreelanceTn.Api.Models;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Gestion des sessions authentifiées. Le JWT ne contient qu'un identifiant de
/// session opaque (claim "sid") ; le document Mongo conserve uniquement le hash
/// de cet identifiant. La révocation est donc immédiate et vérifiable à chaque
/// requête, sans stocker de jeton en clair.
/// </summary>
public class SessionService
{
    private readonly IMongoCollection<AuthSession> _sessions;

    public SessionService(MongoContext mongo)
    {
        _sessions = mongo.GetCollection<AuthSession>(mongo.Settings.AuthSessionsCollection);
    }

    public static string HashSessionKey(string key) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    /// <summary>Crée la session et renvoie la clé opaque à placer dans le claim "sid".</summary>
    public async Task<(string SessionId, string SessionKey)> CreateAsync(
        string userId,
        bool rememberMe,
        string userAgent,
        string ip,
        DateTime expiresAt,
        CancellationToken cancellationToken)
    {
        var key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

        var session = new AuthSession
        {
            UserId = userId,
            TokenHash = HashSessionKey(key),
            RememberMe = rememberMe,
            UserAgent = Truncate(userAgent, 400),
            IpHash = string.IsNullOrWhiteSpace(ip) ? string.Empty : HashSessionKey(ip),
            CreatedAt = DateTime.UtcNow,
            LastSeenAt = DateTime.UtcNow,
            ExpiresAt = expiresAt,
        };

        await _sessions.InsertOneAsync(session, cancellationToken: cancellationToken);
        return (session.Id, key);
    }

    /// <summary>Vérifie qu'une session est encore active (non révoquée, non expirée).</summary>
    public async Task<bool> IsActiveAsync(string sessionKey, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(sessionKey)) return false;

        var hash = HashSessionKey(sessionKey);
        var session = await _sessions
            .Find(s => s.TokenHash == hash)
            .FirstOrDefaultAsync(cancellationToken);

        if (session is null) return false;
        if (session.RevokedAt is not null) return false;
        if (session.ExpiresAt <= DateTime.UtcNow) return false;

        // Mise à jour opportuniste de la dernière activité (sans bloquer la requête).
        await _sessions.UpdateOneAsync(
            s => s.Id == session.Id,
            Builders<AuthSession>.Update.Set(s => s.LastSeenAt, DateTime.UtcNow),
            cancellationToken: cancellationToken);

        return true;
    }

    public async Task<List<SessionResponse>> ListAsync(
        string userId,
        string? currentSessionKey,
        CancellationToken cancellationToken)
    {
        var currentHash = string.IsNullOrWhiteSpace(currentSessionKey)
            ? string.Empty
            : HashSessionKey(currentSessionKey);

        var sessions = await _sessions
            .Find(s => s.UserId == userId && s.RevokedAt == null && s.ExpiresAt > DateTime.UtcNow)
            .SortByDescending(s => s.LastSeenAt)
            .ToListAsync(cancellationToken);

        return sessions.Select(s => new SessionResponse
        {
            Id = s.Id,
            Current = currentHash.Length > 0 && s.TokenHash == currentHash,
            RememberMe = s.RememberMe,
            UserAgent = s.UserAgent,
            CreatedAt = s.CreatedAt,
            LastSeenAt = s.LastSeenAt,
            ExpiresAt = s.ExpiresAt,
        }).ToList();
    }

    public async Task<bool> RevokeAsync(string userId, string sessionId, CancellationToken cancellationToken)
    {
        var result = await _sessions.UpdateOneAsync(
            s => s.Id == sessionId && s.UserId == userId && s.RevokedAt == null,
            Builders<AuthSession>.Update.Set(s => s.RevokedAt, DateTime.UtcNow),
            cancellationToken: cancellationToken);

        return result.ModifiedCount > 0;
    }

    public async Task<long> RevokeOthersAsync(
        string userId,
        string? currentSessionKey,
        CancellationToken cancellationToken)
    {
        var currentHash = string.IsNullOrWhiteSpace(currentSessionKey)
            ? string.Empty
            : HashSessionKey(currentSessionKey);

        var result = await _sessions.UpdateManyAsync(
            s => s.UserId == userId
                 && s.RevokedAt == null
                 && (currentHash.Length == 0 || s.TokenHash != currentHash),
            Builders<AuthSession>.Update.Set(s => s.RevokedAt, DateTime.UtcNow),
            cancellationToken: cancellationToken);

        return result.ModifiedCount;
    }

    public async Task<long> RevokeAllAsync(string userId, CancellationToken cancellationToken)
    {
        var result = await _sessions.UpdateManyAsync(
            s => s.UserId == userId && s.RevokedAt == null,
            Builders<AuthSession>.Update.Set(s => s.RevokedAt, DateTime.UtcNow),
            cancellationToken: cancellationToken);

        return result.ModifiedCount;
    }

    private static string Truncate(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim()[..Math.Min(value.Trim().Length, max)];
}
