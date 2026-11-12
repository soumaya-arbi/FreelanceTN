namespace FreelanceTn.Api.Dtos.Invitations;

public class CreateInvitationRequest
{
    public string ProjectId { get; set; } = string.Empty;
    public string FreelancerId { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? OfferedPrice { get; set; }
    public string? OfferedDelivery { get; set; }
}

public class DeclineInvitationRequest
{
    public string? Reason { get; set; }
}

public class InvitationResponse
{
    public string Id { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string ProjectTitle { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string ClientName { get; set; } = string.Empty;
    public string FreelancerId { get; set; } = string.Empty;
    public string FreelancerName { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? OfferedPrice { get; set; }
    public string? OfferedDelivery { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? DeclineReason { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
}