using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

public static class InvitationStatus
{
    public const string Pending = "Pending";
    public const string Accepted = "Accepted";
    public const string Declined = "Declined";
    public const string Expired = "Expired";
    public const string Cancelled = "Cancelled";

    public static readonly string[] All = [Pending, Accepted, Declined, Expired, Cancelled];
    public static bool IsValid(string? s) => !string.IsNullOrWhiteSpace(s) && All.Contains(s.Trim(), StringComparer.OrdinalIgnoreCase);
}

public class Invitation
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    [BsonElement("projectId")]
    public string ProjectId { get; set; } = string.Empty;

    [BsonElement("projectTitle")]
    public string ProjectTitle { get; set; } = string.Empty;

    [BsonElement("clientId")]
    public string ClientId { get; set; } = string.Empty;

    [BsonElement("clientName")]
    public string ClientName { get; set; } = string.Empty;

    [BsonElement("freelancerId")]
    public string FreelancerId { get; set; } = string.Empty;

    [BsonElement("freelancerName")]
    public string FreelancerName { get; set; } = string.Empty;

    [BsonElement("message")]
    public string Message { get; set; } = string.Empty;

    [BsonElement("offeredPrice")]
    [BsonIgnoreIfNull]
    public string? OfferedPrice { get; set; }

    [BsonElement("offeredDelivery")]
    [BsonIgnoreIfNull]
    public string? OfferedDelivery { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = InvitationStatus.Pending;

    [BsonElement("declineReason")]
    [BsonIgnoreIfNull]
    public string? DeclineReason { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("expiresAt")]
    [BsonIgnoreIfNull]
    public DateTime? ExpiresAt { get; set; }
}