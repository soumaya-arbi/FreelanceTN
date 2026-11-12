using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using FreelanceTn.Api.Data;
using FreelanceTn.Api.Models;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;

namespace FreelanceTn.Api.Services;

public class NotificationService
{
    private readonly IMongoCollection<Notification> _notifications;
    private readonly ILogger<NotificationService> _logger;

    public NotificationService(MongoContext mongo, ILogger<NotificationService>? logger = null)
    {
        _notifications = mongo.GetCollection<Notification>(mongo.Settings.NotificationsCollection);
        _logger = logger ?? NullLogger<NotificationService>.Instance;
    }

    /// <summary>
    /// Identifiant stable (24 caractères hexadécimaux, compatible ObjectId) dérivé
    /// d'une clé métier. Deux tentatives d'envoi de la même notification
    /// produisent le même identifiant : une seule insertion réussit, l'autre est
    /// reconnue comme déjà livrée. Aucun doublon possible, même en concurrence.
    /// </summary>
    public static string StableId(string key)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(key ?? string.Empty));
        return Convert.ToHexString(hash)[..24].ToLowerInvariant();
    }

    /// <summary>
    /// Insère une notification in-app. Renvoie <c>true</c> uniquement si la
    /// notification est réellement stockée (ou si elle l'était déjà) : l'appelant
    /// ne doit poser son marqueur d'idempotence qu'après un succès.
    /// </summary>
    public async Task<bool> CreateAsync(
        string recipientId,
        string type,
        string title,
        string message,
        string projectId,
        string projectTitle,
        string actorName,
        CancellationToken ct)
        => await CreateCoreAsync(null, recipientId, type, title, message, projectId, projectTitle, actorName, ct);

    /// <summary>
    /// Variante idempotente : la notification porte un identifiant déterministe.
    /// Une insertion en double (autre instance, autre cycle) est traitée comme un
    /// succès, ce qui rend la reprise sûre sans jamais dupliquer l'envoi.
    /// </summary>
    public virtual async Task<bool> CreateOnceAsync(
        string id,
        string recipientId,
        string type,
        string title,
        string message,
        string projectId,
        string projectTitle,
        string actorName,
        CancellationToken ct)
        => await CreateCoreAsync(id, recipientId, type, title, message, projectId, projectTitle, actorName, ct);

    /// <summary>
    /// Indique si une notification de ce type existe déjà pour ce destinataire et
    /// ce projet. Utilisé pour ne pas renvoyer une notification héritée d'une
    /// exécution antérieure (identifiant aléatoire de l'ancien code).
    /// </summary>
    public async Task<bool> ExistsAsync(string recipientId, string type, string projectId, CancellationToken ct)
    {
        if (!ObjectId.TryParse(recipientId, out _))
        {
            return false;
        }

        var filter = Builders<Notification>.Filter.And(
            Builders<Notification>.Filter.Eq(n => n.RecipientId, recipientId),
            Builders<Notification>.Filter.Eq(n => n.Type, type),
            Builders<Notification>.Filter.Eq(n => n.ProjectId, projectId));

        return await _notifications.Find(filter).AnyAsync(ct);
    }

    private async Task<bool> CreateCoreAsync(
        string? id,
        string recipientId,
        string type,
        string title,
        string message,
        string projectId,
        string projectTitle,
        string actorName,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(recipientId) || !ObjectId.TryParse(recipientId, out _))
        {
            // Destinataire invalide : aucun envoi possible, mais l'appelant doit
            // savoir que la livraison n'a pas eu lieu.
            _logger.LogWarning("Notification {Type} ignored: invalid recipient identifier.", type);
            return false;
        }

        var notification = new Notification
        {
            RecipientId = recipientId,
            Type = type,
            Title = title,
            Message = message,
            ProjectId = projectId,
            ProjectTitle = projectTitle,
            ActorName = actorName,
            IsRead = false,
            CreatedAt = DateTime.UtcNow,
        };

        if (!string.IsNullOrWhiteSpace(id))
        {
            notification.Id = id;
        }

        try
        {
            await _notifications.InsertOneAsync(notification, cancellationToken: ct);
            return true;
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Identifiant déterministe déjà présent : la notification a déjà été
            // livrée (exécution concurrente ou reprise). Ce n'est pas un échec.
            return true;
        }
        catch (Exception exception)
        {
            // Le contenu de la notification n'est jamais journalisé.
            _logger.LogError(
                exception,
                "Notification {Type} for project {ProjectId} could not be stored; it will be retried.",
                type,
                projectId);
            return false;
        }
    }

    public async Task<IReadOnlyList<Notification>> ListAsync(
        string recipientId,
        NotificationPreference? preferences,
        CancellationToken ct)
    {
        var items = await _notifications
            .Find(n => n.RecipientId == recipientId)
            .SortByDescending(n => n.CreatedAt)
            .ToListAsync(ct);

        return Filter(items, preferences);
    }

    public async Task<int> UnreadCountAsync(
        string recipientId,
        NotificationPreference? preferences,
        CancellationToken ct)
    {
        var items = await _notifications
            .Find(n => n.RecipientId == recipientId && !n.IsRead)
            .ToListAsync(ct);

        return Filter(items, preferences).Count();
    }

    public async System.Threading.Tasks.Task MarkReadAsync(string recipientId, string id, CancellationToken ct)
    {
        var filter = Builders<Notification>.Filter.And(
            Builders<Notification>.Filter.Eq(n => n.Id, id),
            Builders<Notification>.Filter.Eq(n => n.RecipientId, recipientId));
        var update = Builders<Notification>.Update.Set(n => n.IsRead, true);
        await _notifications.UpdateOneAsync(filter, update, cancellationToken: ct);
    }

    public async System.Threading.Tasks.Task MarkAllReadAsync(string recipientId, CancellationToken ct)
    {
        var filter = Builders<Notification>.Filter.Eq(n => n.RecipientId, recipientId);
        var update = Builders<Notification>.Update.Set(n => n.IsRead, true);
        await _notifications.UpdateManyAsync(filter, update, cancellationToken: ct);
    }

    /// <summary>
    /// Applique réellement les préférences : les catégories désactivées ne sont
    /// pas renvoyées à l'interface (ni comptées comme non lues). Sans document
    /// de préférences, tout est actif par défaut.
    /// </summary>
    private static List<Notification> Filter(IEnumerable<Notification> items, NotificationPreference? preferences)
    {
        if (preferences is null)
        {
            return items.ToList();
        }

        if (!preferences.InAppEnabled)
        {
            return [];
        }

        return items.Where(n =>
        {
            var type = (n.Type ?? string.Empty).ToLowerInvariant();

            if (type.Contains("invit"))
            {
                return preferences.InvitationsEnabled;
            }

            if (type.Contains("invoice") || type.Contains("quote") || type.Contains("billing"))
            {
                return preferences.BillingEnabled;
            }

            if (type.Contains("comment") || type.Contains("message"))
            {
                return preferences.MessagesEnabled;
            }

            // proposal, review, approve, reject, status, assign...
            return preferences.ProjectActivityEnabled;
        }).ToList();
    }
}
