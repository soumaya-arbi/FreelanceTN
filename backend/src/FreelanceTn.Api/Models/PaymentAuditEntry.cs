using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// Journal d'audit des décisions financières blockchain. Une entrée décrit
/// pourquoi un transfert a été crédité ou refusé (instance de chaîne, hash,
/// paiement antérieur). La collection est append-only : aucune entrée n'est
/// modifiée ni supprimée par le service de paiement.
/// </summary>
public sealed class PaymentAuditEntry
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Clé d'idempotence de l'entrée : <c>action:paiement:règlement</c>. Elle
    /// empêche qu'une reprise après interruption n'écrive deux fois le même
    /// événement.
    /// </summary>
    [BsonElement("dedupeKey")]
    public string DedupeKey { get; set; } = string.Empty;

    [BsonElement("paymentId")]
    public string PaymentId { get; set; } = string.Empty;

    [BsonElement("paymentReference")]
    public string PaymentReference { get; set; } = string.Empty;

    [BsonElement("action")]
    public string Action { get; set; } = string.Empty;

    [BsonElement("reason")]
    public string Reason { get; set; } = string.Empty;

    [BsonElement("previousPaymentId")]
    [BsonIgnoreIfNull]
    public string? PreviousPaymentId { get; set; }

    [BsonElement("previousGenesisHash")]
    [BsonIgnoreIfNull]
    public string? PreviousGenesisHash { get; set; }

    [BsonElement("currentGenesisHash")]
    [BsonIgnoreIfNull]
    public string? CurrentGenesisHash { get; set; }

    [BsonElement("currentGenesisTimestamp")]
    [BsonIgnoreIfNull]
    public long? CurrentGenesisTimestamp { get; set; }

    [BsonElement("txHash")]
    [BsonIgnoreIfNull]
    public string? TxHash { get; set; }

    [BsonElement("settlementId")]
    [BsonIgnoreIfNull]
    public string? SettlementId { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
