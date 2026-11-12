using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// Service (offre) publié par un freelance. Le champ <see cref="OwnerId"/> est
/// l'identifiant du freelance authentifié : il n'est jamais fourni par le client
/// et garantit qu'un utilisateur ne peut gérer que ses propres services.
/// </summary>
public class Service
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    [BsonElement("ownerId")]
    public string OwnerId { get; set; } = string.Empty;

    [BsonElement("title")]
    public string Title { get; set; } = string.Empty;

    [BsonElement("category")]
    public string Category { get; set; } = string.Empty;

    [BsonElement("subcategory")]
    public string? Subcategory { get; set; }

    [BsonElement("description")]
    public string Description { get; set; } = string.Empty;

    [BsonElement("packages")]
    public List<ServicePackage> Packages { get; set; } = [];

    [BsonElement("requirements")]
    public string? Requirements { get; set; }

    [BsonElement("tags")]
    public List<string> Tags { get; set; } = [];

    /// <summary>Statut du service : seuls les services "Published" apparaissent au catalogue.</summary>
    [BsonElement("status")]
    public string Status { get; set; } = ServiceStatus.Draft;

    /// <summary>Prix du package le moins cher, dénormalisé pour trier le catalogue.</summary>
    [BsonElement("minPrice")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal MinPrice { get; set; }

    [BsonElement("coverImage")]
    public string? CoverImage { get; set; }

    /// <summary>Note moyenne des avis du service (0 tant qu'aucun avis n'est publié).</summary>
    [BsonElement("rating")]
    public double Rating { get; set; }

    [BsonElement("reviewsCount")]
    public int ReviewsCount { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Package tarifaire proposé pour un service (Basic, Standard, Premium…).</summary>
public class ServicePackage
{
    [BsonElement("name")]
    public string Name { get; set; } = string.Empty;

    [BsonElement("price")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal Price { get; set; }

    [BsonElement("deliveryDays")]
    public int DeliveryDays { get; set; }

    [BsonElement("revisions")]
    public int Revisions { get; set; }

    [BsonElement("description")]
    public string? Description { get; set; }
}

/// <summary>
/// Cycle de vie d'un service. Un service créé est publié : il devient visible
/// au catalogue. Les transitions autorisées sont explicites et vérifiées par
/// le service métier (une transition non autorisée renvoie HTTP 409).
/// </summary>
public static class ServiceStatus
{
    public const string Draft = "Draft";
    public const string Published = "Published";
    public const string Archived = "Archived";

    public static readonly string[] All = [Draft, Published, Archived];

    /// <summary>Transitions autorisées depuis chaque statut.</summary>
    private static readonly Dictionary<string, string[]> Allowed = new()
    {
        [Draft] = [Published],
        [Published] = [Draft, Archived],
        [Archived] = [Published, Draft],
    };

    public static bool IsValid(string? status) =>
        !string.IsNullOrWhiteSpace(status) && All.Contains(status.Trim(), StringComparer.OrdinalIgnoreCase);

    /// <summary>Normalise un statut reçu vers une valeur stockée connue.</summary>
    public static string Normalize(string? status) =>
        All.FirstOrDefault(known => string.Equals(known, status?.Trim(), StringComparison.OrdinalIgnoreCase)) ?? Draft;

    /// <summary>Indique si un service peut passer d'un statut à un autre.</summary>
    public static bool CanTransition(string? from, string? to)
    {
        if (!IsValid(from) || !IsValid(to)) return false;
        if (string.Equals(from?.Trim(), to?.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
        return Allowed.TryGetValue(from!.Trim(), out var targets)
            && targets.Contains(to!.Trim(), StringComparer.OrdinalIgnoreCase);
    }
}
