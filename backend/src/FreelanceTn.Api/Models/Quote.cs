using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

public static class QuoteStatus
{
    public const string Draft = "draft";
    public const string Sent = "sent";
    public const string Accepted = "accepted";
    public const string Refused = "refused";
    public const string Expired = "expired";

    public static readonly string[] All = [Draft, Sent, Accepted, Refused, Expired];

    public static bool IsValid(string? status) =>
        !string.IsNullOrWhiteSpace(status) && All.Contains(status.Trim().ToLowerInvariant());

    public static string Normalize(string? status)
    {
        var value = status?.Trim().ToLowerInvariant() ?? Draft;
        return All.Contains(value) ? value : Draft;
    }

    public static bool IsExpired(string validUntil, DateTime utcNow)
    {
        return DateTime.TryParse(validUntil, out var due) && due.Date < utcNow.Date;
    }
}

public static class QuoteCorrectionState
{
    public const string PendingCorrection = "pending_correction";
    public const string Abandoned = "abandoned";
    public const string None = "none";
}

public class QuoteHistoryEntry
{
    [BsonElement("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [BsonElement("action")]
    public string Action { get; set; } = string.Empty;

    [BsonElement("note")]
    public string? Note { get; set; }

    [BsonElement("actorId")]
    public string? ActorId { get; set; }

    [BsonElement("actorRole")]
    public string? ActorRole { get; set; }

    [BsonElement("fromStatus")]
    public string? FromStatus { get; set; }

    [BsonElement("toStatus")]
    public string? ToStatus { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Quote
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    [BsonElement("number")]
    public string Number { get; set; } = string.Empty;

    [BsonElement("ownerId")]
    public string OwnerId { get; set; } = string.Empty;

    [BsonElement("clientId")]
    public string? ClientId { get; set; }

    [BsonElement("client")]
    public string Client { get; set; } = string.Empty;

    [BsonElement("projectId")]
    public string ProjectId { get; set; } = string.Empty;

    [BsonElement("project")]
    public string Project { get; set; } = string.Empty;

    [BsonElement("issueDate")]
    public string IssueDate { get; set; } = string.Empty;

    [BsonElement("validUntil")]
    public string ValidUntil { get; set; } = string.Empty;

    [BsonElement("status")]
    public string Status { get; set; } = QuoteStatus.Draft;

    [BsonElement("convertedTo")]
    public string? ConvertedTo { get; set; }

    [BsonElement("correctionNote")]
    public string? CorrectionNote { get; set; }

    [BsonElement("correctionRequested")]
    public bool CorrectionRequested { get; set; }

    [BsonElement("abandoned")]
    public bool Abandoned { get; set; }

    [BsonElement("history")]
    public List<QuoteHistoryEntry> History { get; set; } = [];

    [BsonElement("lines")]
    public List<DocumentLine> Lines { get; set; } = [];

    [BsonElement("notes")]
    public string Notes { get; set; } = string.Empty;

    [BsonElement("subtotal")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal Subtotal { get; set; }

    [BsonElement("discountTotal")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal DiscountTotal { get; set; }

    [BsonElement("taxTotal")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal TaxTotal { get; set; }

    [BsonElement("total")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal Total { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
