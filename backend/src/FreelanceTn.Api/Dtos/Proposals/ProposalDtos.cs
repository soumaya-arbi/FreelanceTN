namespace FreelanceTn.Api.Dtos.Proposals;

/// <summary>
/// Candidature déposée par un freelance sur un projet publié. Seul
/// <see cref="ProjectId"/> est fourni : le freelance, le propriétaire du projet
/// et le statut initial sont dérivés côté serveur de la session authentifiée et
/// du document projet en base.
/// </summary>
public class CreateProposalRequest
{
    public string ProjectId { get; set; } = string.Empty;
    public string CoverLetter { get; set; } = string.Empty;
    public string Price { get; set; } = string.Empty;
    public string Delivery { get; set; } = string.Empty;
    public string? PortfolioId { get; set; }
}

/// <summary>
/// Décision du client sur une candidature. Le statut reçu ne peut être que
/// « Accepted » ou « Refused » : le reste du cycle de vie est imposé par le
/// serveur.
/// </summary>
public class UpdateProposalStatusRequest
{
    public string Status { get; set; } = string.Empty;
}

public class ProposalResponse
{
    public string Id { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string ProjectTitle { get; set; } = string.Empty;
    public string ProjectBudget { get; set; } = string.Empty;
    public string ProjectType { get; set; } = string.Empty;
    public string ProjectStatus { get; set; } = string.Empty;
    public string ProjectOwnerId { get; set; } = string.Empty;
    public string FreelancerId { get; set; } = string.Empty;
    public string FreelancerName { get; set; } = string.Empty;
    public string FreelancerTitle { get; set; } = string.Empty;
    public string CoverLetter { get; set; } = string.Empty;
    public string Price { get; set; } = string.Empty;
    public string Delivery { get; set; } = string.Empty;
    public string? PortfolioId { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
