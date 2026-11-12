using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

public static class InvoiceStatus
{
    public const string Draft = "draft";
    public const string Emise = "emise";
    public const string Unpaid = "unpaid";
    public const string PartiallyPaid = "partially_paid";
    public const string Paid = "paid";
    public const string Overdue = "overdue";

    public static readonly string[] All = [Draft, Emise, Unpaid, PartiallyPaid, Paid, Overdue];

    public static bool IsValid(string? status) =>
        !string.IsNullOrWhiteSpace(status) && All.Contains(status.Trim().ToLowerInvariant());

    public static string Normalize(string? status)
    {
        var value = status?.Trim().ToLowerInvariant() ?? Draft;
        if (value == "issued") value = Emise;
        if (value == "sent") value = Emise;
        return All.Contains(value) ? value : Draft;
    }
}

public static class InvoicePaymentStatus
{
    public const string Completed = "completed";
    public const string Failed = "failed";

    public static string Normalize(string? status) =>
        string.Equals(status?.Trim(), Failed, StringComparison.OrdinalIgnoreCase) ? Failed : Completed;
}

public class InvoicePayment
{
    [BsonElement("amount")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal Amount { get; set; }

    [BsonElement("date")]
    public string Date { get; set; } = string.Empty;

    [BsonElement("note")]
    public string? Note { get; set; }

    [BsonElement("reference")]
    public string? Reference { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = InvoicePaymentStatus.Completed;

    [BsonElement("method")]
    public string? Method { get; set; }

    [BsonElement("transactionId")]
    public string? TransactionId { get; set; }

    [BsonElement("idempotencyKey")]
    public string? IdempotencyKey { get; set; }

    [BsonElement("createdAt")]
    public DateTime? CreatedAt { get; set; }
}

public class Invoice
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

    [BsonElement("quoteId")]
    public string? QuoteId { get; set; }

    [BsonElement("issueDate")]
    public string IssueDate { get; set; } = string.Empty;

    [BsonElement("dueDate")]
    public string DueDate { get; set; } = string.Empty;

    [BsonElement("status")]
    public string Status { get; set; } = InvoiceStatus.Draft;

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

    [BsonElement("amountPaid")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal AmountPaid { get; set; }

    [BsonElement("balanceDue")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal BalanceDue { get; set; }

    [BsonElement("payments")]
    public List<InvoicePayment> Payments { get; set; } = [];

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
