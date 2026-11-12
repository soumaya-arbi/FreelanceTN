namespace FreelanceTn.Api.Dtos.Feedbacks;

/// <summary>
/// Soumission d'une évaluation structurée. Le projet et l'auteur sont déduits
/// du chemin et de la session : aucun identifiant de droit n'est accepté dans
/// le corps de la requête.
/// </summary>
public class SubmitFeedbackRequest
{
    public Dictionary<string, int> Criteria { get; set; } = new();
    public string? Comment { get; set; }
    public string? Strengths { get; set; }
    public string? Improvements { get; set; }

    /// <summary>Obligatoire pour le client (recommander le freelancer).</summary>
    public bool? Recommend { get; set; }
}

public class FeedbackResponse
{
    public string Id { get; set; } = string.Empty;
    public string ProjectId { get; set; } = string.Empty;
    public string ProjectTitle { get; set; } = string.Empty;

    // Champs historiques (compatibilité).
    public string ClientId { get; set; } = string.Empty;
    public string ClientName { get; set; } = string.Empty;
    public string FreelancerId { get; set; } = string.Empty;
    public string FreelancerName { get; set; } = string.Empty;

    public string AuthorId { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public string AuthorRole { get; set; } = string.Empty;
    public string RecipientId { get; set; } = string.Empty;
    public string RecipientName { get; set; } = string.Empty;
    public string RecipientRole { get; set; } = string.Empty;
    public string Direction { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;

    public int Rating { get; set; }
    public double AverageRating { get; set; }
    public Dictionary<string, int> Criteria { get; set; } = new();
    public string Comment { get; set; } = string.Empty;
    public string Strengths { get; set; } = string.Empty;
    public string Improvements { get; set; } = string.Empty;
    public bool? Recommend { get; set; }

    /// <summary>Renseigné uniquement pour l'auteur ou après publication.</summary>
    public DateTime? SubmittedAt { get; set; }

    public DateTime? PublishedAt { get; set; }
    public DateTime? DueAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class FeedbackDistributionItem
{
    public int Stars { get; set; }
    public int Count { get; set; }
}

/// <summary>
/// Réputation publique d'un utilisateur, calculée uniquement à partir des avis
/// publiés dont il est le destinataire.
/// </summary>
public class FeedbackSummaryResponse
{
    public string UserId { get; set; } = string.Empty;
    public int Count { get; set; }
    public double AverageRating { get; set; }
    public List<FeedbackDistributionItem> Distribution { get; set; } = new();
    public Dictionary<string, double> CriteriaAverages { get; set; } = new();
    public int CriteriaReviewCount { get; set; }

    /// <summary>Pourcentage de recommandations positives, null si aucun avis ne contient la réponse.</summary>
    public double? RecommendationRate { get; set; }

    public List<FeedbackResponse> Reviews { get; set; } = new();
}
