using System.Text.Json.Serialization;

namespace FreelanceTn.Api.Dtos.Quotes;

public class QuoteLineRequest
{
    public string? Id { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; } = 1;
    public decimal UnitPrice { get; set; }
    public decimal TaxRate { get; set; }
    public decimal Discount { get; set; }
}

public class CreateQuoteRequest
{
    public string? ClientId { get; set; }
    public string Client { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string Project { get; set; } = string.Empty;
    public string IssueDate { get; set; } = string.Empty;
    public string ValidUntil { get; set; } = string.Empty;
    public string? Status { get; set; }
    public List<QuoteLineRequest> Lines { get; set; } = [];
    public string Notes { get; set; } = string.Empty;
}

public class UpdateQuoteRequest
{
    public string? ClientId { get; set; }
    public string? Client { get; set; }
    public string? ProjectId { get; set; }
    public string? Project { get; set; }
    public string? IssueDate { get; set; }
    public string? ValidUntil { get; set; }
    public string? Status { get; set; }
    public List<QuoteLineRequest>? Lines { get; set; }
    public string? Notes { get; set; }
}

public class QuoteLineResponse
{
    public string Id { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal TaxRate { get; set; }
    public decimal Discount { get; set; }
    public decimal LineSubtotal { get; set; }
    public decimal LineDiscount { get; set; }
    public decimal LineTax { get; set; }
    public decimal LineTotal { get; set; }
}

public class QuoteHistoryResponse
{
    public string Id { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string? Note { get; set; }
    public string? ActorId { get; set; }
    public string? ActorRole { get; set; }
    public string? FromStatus { get; set; }
    public string? ToStatus { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class QuoteResponse
{
    public string Id { get; set; } = string.Empty;
    public string Number { get; set; } = string.Empty;
    public string OwnerId { get; set; } = string.Empty;
    public string? ClientId { get; set; }
    public string Client { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string Project { get; set; } = string.Empty;
    public string IssueDate { get; set; } = string.Empty;
    public string ValidUntil { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? ConvertedTo { get; set; }
    public string? CorrectionNote { get; set; }
    public bool CorrectionRequested { get; set; }
    public bool Abandoned { get; set; }
    public List<QuoteHistoryResponse> History { get; set; } = [];
    public List<QuoteLineResponse> Lines { get; set; } = [];
    public string Notes { get; set; } = string.Empty;
    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal TaxTotal { get; set; }
    public decimal Total { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
