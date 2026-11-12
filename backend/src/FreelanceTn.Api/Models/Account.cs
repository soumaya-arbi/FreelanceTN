using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// Membre d'équipe d'un compte client. Le collaborateur est identifié par son
/// e-mail ; l'invitation reste en attente jusqu'à acceptation via le jeton
/// envoyé par e-mail. Les droits sont portés par le rôle, contrôlé côté serveur.
/// </summary>
[BsonIgnoreExtraElements]
public class TeamMember
{
    public static class Roles
    {
        public const string Owner = "Owner";
        public const string Admin = "Admin";
        public const string Manager = "Manager";
        public const string Member = "Member";
        public const string Viewer = "Viewer";

        public static readonly string[] Invitable = [Admin, Manager, Member, Viewer];

        public static bool IsInvitable(string? role) =>
            !string.IsNullOrWhiteSpace(role) &&
            Invitable.Contains(role.Trim(), StringComparer.OrdinalIgnoreCase);

        public static string Normalize(string? role) =>
            Invitable.FirstOrDefault(r => string.Equals(r, role?.Trim(), StringComparison.OrdinalIgnoreCase)) ?? Member;
    }

    public static class Statuses
    {
        public const string Pending = "Pending";
        public const string Active = "Active";
        public const string Revoked = "Revoked";
        public const string Declined = "Declined";
    }

    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    /// <summary>Compte client propriétaire de l'équipe.</summary>
    [BsonElement("ownerId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string OwnerId { get; set; } = null!;

    [BsonElement("email")]
    public string Email { get; set; } = string.Empty;

    [BsonElement("emailNormalized")]
    public string EmailNormalized { get; set; } = string.Empty;

    [BsonElement("name")]
    public string Name { get; set; } = string.Empty;

    [BsonElement("role")]
    public string Role { get; set; } = TeamMember.Roles.Member;

    [BsonElement("status")]
    public string Status { get; set; } = TeamMember.Statuses.Pending;

    /// <summary>Jeton d'invitation stocké sous forme hashée (jamais en clair).</summary>
    [BsonElement("inviteTokenHash")]
    public string? InviteTokenHash { get; set; }

    [BsonElement("inviteExpiresAt")]
    public DateTime? InviteExpiresAt { get; set; }

    [BsonElement("invitedAt")]
    public DateTime InvitedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("acceptedAt")]
    public DateTime? AcceptedAt { get; set; }

    [BsonElement("revokedAt")]
    public DateTime? RevokedAt { get; set; }

    /// <summary>Compte utilisateur créé/associé lors de l'acceptation (facultatif).</summary>
    [BsonElement("userId")]
    public string? UserId { get; set; }

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Informations de facturation du compte client. Aucun paiement ni transaction
/// n'est géré ici : uniquement les coordonnées légales demandées.
/// </summary>
[BsonIgnoreExtraElements]
public class BillingProfile
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonElement("userId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string UserId { get; set; } = null!;

    [BsonElement("legalName")]
    public string LegalName { get; set; } = string.Empty;

    [BsonElement("billingAddress")]
    public string BillingAddress { get; set; } = string.Empty;

    [BsonElement("country")]
    public string Country { get; set; } = string.Empty;

    [BsonElement("governorate")]
    public string Governorate { get; set; } = string.Empty;

    [BsonElement("city")]
    public string City { get; set; } = string.Empty;

    [BsonElement("taxId")]
    public string TaxId { get; set; } = string.Empty;

    [BsonElement("contactName")]
    public string ContactName { get; set; } = string.Empty;

    [BsonElement("contactEmail")]
    public string ContactEmail { get; set; } = string.Empty;

    [BsonElement("contactPhone")]
    public string ContactPhone { get; set; } = string.Empty;

    /// <summary>Historique des modifications de facturation (date + champs modifiés).</summary>
    [BsonElement("history")]
    public List<BillingHistoryEntry> History { get; set; } = [];

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class BillingHistoryEntry
{
    [BsonElement("changedAt")]
    public DateTime ChangedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("changedByUserId")]
    public string ChangedByUserId { get; set; } = string.Empty;

    [BsonElement("fields")]
    public List<string> Fields { get; set; } = [];
}

/// <summary>Préférences d'affichage et de notification, un document par compte.</summary>
[BsonIgnoreExtraElements]
public class UserPreference
{
    public static class Languages
    {
        public const string French = "fr";
        public const string English = "en";

        public static bool IsValid(string? value) =>
            value is French or English;
    }

    public static class Themes
    {
        public const string Light = "light";
        public const string Dark = "dark";

        public static bool IsValid(string? value) => value is Light or Dark;
    }

    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonElement("userId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string UserId { get; set; } = null!;

    [BsonElement("language")]
    public string Language { get; set; } = Languages.French;

    /// <summary>Devise par défaut. TND est la devise de référence de la plateforme.</summary>
    [BsonElement("currency")]
    public string Currency { get; set; } = "TND";

    [BsonElement("theme")]
    public string Theme { get; set; } = Themes.Light;

    [BsonElement("timezone")]
    public string Timezone { get; set; } = "Africa/Tunis";

    /// <summary>Format d'affichage des dates : "DD/MM/YYYY" ou "YYYY-MM-DD".</summary>
    [BsonElement("dateFormat")]
    public string DateFormat { get; set; } = "DD/MM/YYYY";

    /// <summary>Afficher les montants avec séparateur de milliers.</summary>
    [BsonElement("thousandsSeparator")]
    public bool ThousandsSeparator { get; set; } = true;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Préférences de notification. Chaque canal est enregistré et réellement
/// appliqué à la liste des notifications in-app ; le canal e-mail est conservé
/// pour le jour où un fournisseur transactionnel sera configuré.
/// </summary>
[BsonIgnoreExtraElements]
public class NotificationPreference
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonElement("userId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string UserId { get; set; } = null!;

    [BsonElement("emailEnabled")]
    public bool EmailEnabled { get; set; } = true;

    [BsonElement("inAppEnabled")]
    public bool InAppEnabled { get; set; } = true;

    [BsonElement("invitationsEnabled")]
    public bool InvitationsEnabled { get; set; } = true;

    [BsonElement("projectActivityEnabled")]
    public bool ProjectActivityEnabled { get; set; } = true;

    [BsonElement("messagesEnabled")]
    public bool MessagesEnabled { get; set; } = true;

    [BsonElement("billingEnabled")]
    public bool BillingEnabled { get; set; } = true;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Session authentifiée. Le jeton JWT porte un claim "sid" ; sa révocation est
/// vérifiée à chaque requête, ce qui permet la déconnexion à distance et
/// l'invalidation de toutes les sessions après réinitialisation du mot de passe.
/// Seul le hash du jeton d'identification est conservé.
/// </summary>
[BsonIgnoreExtraElements]
public class AuthSession
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonElement("userId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string UserId { get; set; } = null!;

    [BsonElement("tokenHash")]
    public string TokenHash { get; set; } = string.Empty;

    [BsonElement("rememberMe")]
    public bool RememberMe { get; set; }

    [BsonElement("userAgent")]
    public string UserAgent { get; set; } = string.Empty;

    [BsonElement("ipHash")]
    public string IpHash { get; set; } = string.Empty;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("lastSeenAt")]
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;

    [BsonElement("expiresAt")]
    public DateTime ExpiresAt { get; set; }

    [BsonElement("revokedAt")]
    public DateTime? RevokedAt { get; set; }
}

/// <summary>Entrée d'historique des changements importants du compte.</summary>
[BsonIgnoreExtraElements]
public class AccountChange
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonElement("userId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string UserId { get; set; } = null!;

    [BsonElement("area")]
    public string Area { get; set; } = string.Empty;

    [BsonElement("summary")]
    public string Summary { get; set; } = string.Empty;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
