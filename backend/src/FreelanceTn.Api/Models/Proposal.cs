using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// Statuts d'une candidature. « Pending » = le client n'a pas encore tranché.
/// « Accepted » = le client a retenu cette candidature et le freelance a été
/// approuvé sur le projet (voir <see cref="Project.AssignedTo"/>). « Refused » =
/// le client a décliné la proposition (ou elle a été évincée par l'acceptation
/// d'une autre). « Withdrawn » = le freelance a retiré sa candidature.
/// </summary>
public static class ProposalStatus
{
    public const string Pending = "Pending";
    public const string Accepted = "Accepted";
    public const string Refused = "Refused";
    public const string Withdrawn = "Withdrawn";
    public const string Cancelled = "Cancelled";

    public static readonly string[] All = [Pending, Accepted, Refused, Withdrawn, Cancelled];

    /// <summary>Indique si la valeur reçue correspond à un statut connu.</summary>
    public static bool IsValid(string? status) =>
        !string.IsNullOrWhiteSpace(status) && All.Contains(status.Trim(), StringComparer.OrdinalIgnoreCase);

    /// <summary>Normalise une valeur reçue vers la casse canonique stockée en base.</summary>
    public static string Normalize(string status) =>
        All.First(item => string.Equals(item, status.Trim(), StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// Candidature déposée par un freelance sur un projet publié. Le freelance
/// (<see cref="FreelancerId"/>) et le propriétaire du projet
/// (<see cref="ProjectOwnerId"/>) sont toujours dérivés de la session
/// authentifiée : ils ne proviennent jamais d'une valeur envoyée par le client.
/// Les trois champs dénormalisés du projet et les deux du freelance servent
/// uniquement à l'affichage, sans relecture jointe en base.
/// </summary>
public class Proposal
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    [BsonElement("projectId")]
    public string ProjectId { get; set; } = string.Empty;

    [BsonElement("projectTitle")]
    public string ProjectTitle { get; set; } = string.Empty;

    [BsonElement("projectBudget")]
    public string ProjectBudget { get; set; } = string.Empty;

    [BsonElement("projectType")]
    public string ProjectType { get; set; } = string.Empty;

    // Statut du projet au moment de la candidature, repris à chaque décision du
    // client : le champ sert à savoir si le projet est toujours disponible.
    [BsonElement("projectStatus")]
    public string ProjectStatus { get; set; } = string.Empty;

    [BsonElement("projectOwnerId")]
    public string ProjectOwnerId { get; set; } = string.Empty;

    [BsonElement("freelancerId")]
    public string FreelancerId { get; set; } = string.Empty;

    [BsonElement("freelancerName")]
    public string FreelancerName { get; set; } = string.Empty;

    [BsonElement("freelancerTitle")]
    public string FreelancerTitle { get; set; } = string.Empty;

    [BsonElement("coverLetter")]
    public string CoverLetter { get; set; } = string.Empty;

    [BsonElement("price")]
    public string Price { get; set; } = string.Empty;

    [BsonElement("delivery")]
    public string Delivery { get; set; } = string.Empty;

    [BsonElement("portfolioId")]
    public string? PortfolioId { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = ProposalStatus.Pending;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
