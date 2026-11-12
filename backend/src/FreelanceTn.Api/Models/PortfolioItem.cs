using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// Réalisation du portfolio d'un freelance. Le propriétaire
/// (<see cref="OwnerId"/>) est toujours déduit de la session authentifiée :
/// il n'est jamais fourni par le client.
/// </summary>
public class PortfolioItem
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    [BsonElement("ownerId")]
    public string OwnerId { get; set; } = string.Empty;

    [BsonElement("title")]
    public string Title { get; set; } = string.Empty;

    [BsonElement("summary")]
    public string Summary { get; set; } = string.Empty;

    [BsonElement("category")]
    public string Category { get; set; } = string.Empty;

    [BsonElement("role")]
    public string? Role { get; set; }

    [BsonElement("duration")]
    public string? Duration { get; set; }

    [BsonElement("challenge")]
    public string? Challenge { get; set; }

    [BsonElement("solution")]
    public string? Solution { get; set; }

    [BsonElement("outcome")]
    public string? Outcome { get; set; }

    [BsonElement("skills")]
    public List<string> Skills { get; set; } = [];

    [BsonElement("link")]
    public string? Link { get; set; }

    [BsonElement("image")]
    public string? Image { get; set; }

    [BsonElement("visibility")]
    public string Visibility { get; set; } = PortfolioVisibility.Public;

    [BsonElement("published")]
    public bool Published { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Niveaux de visibilité d'une réalisation.</summary>
public static class PortfolioVisibility
{
    public const string Public = "Public";
    public const string RegisteredClientsOnly = "Registered clients only";
    public const string Private = "Private";

    public static readonly string[] All = [Public, RegisteredClientsOnly, Private];

    public static bool IsValid(string? visibility) =>
        !string.IsNullOrWhiteSpace(visibility)
        && All.Contains(visibility.Trim(), StringComparer.OrdinalIgnoreCase);

    public static string Normalize(string? visibility) =>
        All.FirstOrDefault(known => string.Equals(known, visibility?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? Public;
}
