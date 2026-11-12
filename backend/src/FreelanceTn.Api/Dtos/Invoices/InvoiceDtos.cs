using FreelanceTn.Api.Dtos.Payments;

namespace FreelanceTn.Api.Dtos.Invoices;

public class InvoiceLineRequest
{
    public string? Id { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; } = 1;
    public decimal UnitPrice { get; set; }
    public decimal TaxRate { get; set; }
    public decimal Discount { get; set; }
}

public class CreateInvoiceRequest
{
    public string? ClientId { get; set; }
    public string Client { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string Project { get; set; } = string.Empty;
    public string? QuoteId { get; set; }
    public string IssueDate { get; set; } = string.Empty;
    public string DueDate { get; set; } = string.Empty;
    public string? Status { get; set; }
    public List<InvoiceLineRequest> Lines { get; set; } = [];
    public string Notes { get; set; } = string.Empty;
}

public class CreateInvoiceFromQuoteRequest
{
    public string? DueDate { get; set; }
    public string? Notes { get; set; }
}

public class UpdateInvoiceRequest
{
    public string? ClientId { get; set; }
    public string? Client { get; set; }
    public string? ProjectId { get; set; }
    public string? Project { get; set; }
    public string? IssueDate { get; set; }
    public string? DueDate { get; set; }
    public string? Status { get; set; }
    public List<InvoiceLineRequest>? Lines { get; set; }
    public string? Notes { get; set; }
}

public class RecordPaymentRequest
{
    public decimal Amount { get; set; }
    public string? Date { get; set; }
    public string? Note { get; set; }
    public string? Reference { get; set; }
    public string? Method { get; set; }
    public string? SimulateOutcome { get; set; }
    public string? IdempotencyKey { get; set; }
}

public class InvoiceLineResponse
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

public class InvoicePaymentResponse
{
    public string Id { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Date { get; set; } = string.Empty;
    public string? Note { get; set; }
    public string? Reference { get; set; }
    public string Status { get; set; } = "completed";
    public string? Method { get; set; }
    public string? TransactionId { get; set; }
    public string? IdempotencyKey { get; set; }
    public string? ReceiptNumber { get; set; }
    public bool ReceiptAvailable { get; set; }
    public bool Legacy { get; set; }
    public List<PaymentAttemptResponse> Attempts { get; set; } = [];
    public DateTime? CreatedAt { get; set; }
}

public class InvoiceResponse
{
    public string Id { get; set; } = string.Empty;
    public string Number { get; set; } = string.Empty;
    public string OwnerId { get; set; } = string.Empty;
    public string? ClientId { get; set; }
    public string Client { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string Project { get; set; } = string.Empty;
    public string? QuoteId { get; set; }
    public string IssueDate { get; set; } = string.Empty;
    public string DueDate { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public List<InvoiceLineResponse> Lines { get; set; } = [];
    public string Notes { get; set; } = string.Empty;
    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal TaxTotal { get; set; }
    public decimal Total { get; set; }
    public decimal AmountPaid { get; set; }
    public decimal BalanceDue { get; set; }
    public List<InvoicePaymentResponse> Payments { get; set; } = [];
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
