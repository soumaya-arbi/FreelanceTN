using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// Avis d'un participant sur un projet terminé.
///
/// Le module est bidirectionnel : le client évalue le freelancer et le
/// freelancer évalue le client. Chaque participant possède au plus un document
/// par projet (index unique projectId + authorId). Les documents créés par
/// l'ancien module (client -> freelancer uniquement) restent lisibles : les
/// champs ajoutés sont renseignés par une migration non destructive et les
/// anciens avis sont considérés comme publiés.
/// </summary>
[BsonIgnoreExtraElements]
public class Feedback
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    [BsonElement("projectId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string ProjectId { get; set; } = string.Empty;

    [BsonElement("projectTitle")]
    public string ProjectTitle { get; set; } = string.Empty;

    // Champs historiques conservés pour la compatibilité des avis existants.
    [BsonElement("clientId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string ClientId { get; set; } = string.Empty;

    [BsonElement("clientName")]
    public string ClientName { get; set; } = string.Empty;

    [BsonElement("freelancerId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string FreelancerId { get; set; } = string.Empty;

    [BsonElement("freelancerName")]
    public string FreelancerName { get; set; } = string.Empty;

    /// <summary>Auteur réel de l'avis (client ou freelancer).</summary>
    [BsonElement("authorId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string AuthorId { get; set; } = string.Empty;

    [BsonElement("authorName")]
    public string AuthorName { get; set; } = string.Empty;

    /// <summary>"client" ou "freelancer".</summary>
    [BsonElement("authorRole")]
    public string AuthorRole { get; set; } = string.Empty;

    /// <summary>Destinataire réel de l'avis.</summary>
    [BsonElement("recipientId")]
    [BsonRepresentation(BsonType.ObjectId)]
    public string RecipientId { get; set; } = string.Empty;

    [BsonElement("recipientName")]
    public string RecipientName { get; set; } = string.Empty;

    [BsonElement("recipientRole")]
    public string RecipientRole { get; set; } = string.Empty;

    /// <summary>"client_to_freelancer" ou "freelancer_to_client".</summary>
    [BsonElement("direction")]
    public string Direction { get; set; } = string.Empty;

    /// <summary>Voir <see cref="FeedbackStatus"/>. Vide sur les documents historiques.</summary>
    [BsonElement("status")]
    public string Status { get; set; } = string.Empty;

    /// <summary>Note globale entière (compatibilité et répartition par étoiles).</summary>
    [BsonElement("rating")]
    public int Rating { get; set; }

    /// <summary>Moyenne réelle des cinq critères (plus précise que <see cref="Rating"/>).</summary>
    [BsonElement("averageRating")]
    public double AverageRating { get; set; }

    /// <summary>Notes par critère (clés stables, voir <see cref="FeedbackCriteria"/>).</summary>
    [BsonElement("criteria")]
    public Dictionary<string, int> Criteria { get; set; } = new();

    [BsonElement("comment")]
    public string Comment { get; set; } = string.Empty;

    [BsonElement("strengths")]
    public string Strengths { get; set; } = string.Empty;

    [BsonElement("improvements")]
    public string Improvements { get; set; } = string.Empty;

    /// <summary>Recommandation (client -> freelancer). Null pour l'ancien module et pour le freelancer.</summary>
    [BsonElement("recommend")]
    [BsonIgnoreIfNull]
    public bool? Recommend { get; set; }

    [BsonElement("submittedAt")]
    [BsonIgnoreIfNull]
    public DateTime? SubmittedAt { get; set; }

    [BsonElement("publishedAt")]
    [BsonIgnoreIfNull]
    public DateTime? PublishedAt { get; set; }

    /// <summary>Date limite de soumission (clôture + 14 jours).</summary>
    [BsonElement("dueAt")]
    [BsonIgnoreIfNull]
    public DateTime? DueAt { get; set; }

    /// <summary>Date de clôture retenue pour le calcul de <see cref="DueAt"/>.</summary>
    [BsonElement("completedAt")]
    [BsonIgnoreIfNull]
    public DateTime? CompletedAt { get; set; }

    // Marqueurs d'idempotence : une notification n'est créée qu'une seule fois.
    [BsonElement("requestNotifiedAt")]
    [BsonIgnoreIfNull]
    public DateTime? RequestNotifiedAt { get; set; }

    [BsonElement("reminderNotifiedAt")]
    [BsonIgnoreIfNull]
    public DateTime? ReminderNotifiedAt { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class FeedbackStatus
{
    /// <summary>Demande créée, aucune évaluation soumise.</summary>
    public const string AwaitingReview = "awaiting_review";

    /// <summary>Évaluation soumise mais invisible pour l'autre participant.</summary>
    public const string SubmittedHidden = "submitted_hidden";

    /// <summary>Évaluation visible publiquement.</summary>
    public const string Published = "published";

    /// <summary>Délai dépassé sans évaluation soumise (aucun avis fictif).</summary>
    public const string Expired = "expired";

    public static readonly string[] All = [AwaitingReview, SubmittedHidden, Published, Expired];
}

public static class FeedbackDirection
{
    public const string ClientToFreelancer = "client_to_freelancer";
    public const string FreelancerToClient = "freelancer_to_client";
}

/// <summary>
/// Clés stables des critères. Les libellés sont gérés par le frontend pour
/// rester localisés et adaptés à chaque rôle.
/// </summary>
public static class FeedbackCriteria
{
    public static readonly string[] ClientToFreelancer =
    [
        "quality",
        "deadlines",
        "communication",
        "professionalism",
        "specifications",
    ];

    public static readonly string[] FreelancerToClient =
    [
        "requirementsClarity",
        "communication",
        "validationSpeed",
        "professionalism",
        "collaboration",
    ];

    public static string[] ForDirection(string direction) =>
        direction == FeedbackDirection.FreelancerToClient
            ? FreelancerToClient
            : ClientToFreelancer;
}
