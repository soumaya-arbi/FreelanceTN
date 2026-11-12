using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// Projet publié par un compte client et proposé aux freelances. Le champ
/// <see cref="OwnerId"/> est l'identifiant du propriétaire authentifié : il n'est
/// jamais fourni par le client et sert à garantir qu'un utilisateur ne peut
/// gérer que ses propres projets. Un projet approuvé par le client est
/// également référencé par <see cref="AssignedTo"/> (identifiant du freelance
/// retenu) : il apparaît alors dans le tableau de bord de ce freelance.
/// </summary>
[BsonIgnoreExtraElements]
public class Project
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    [BsonElement("ownerId")]
    public string OwnerId { get; set; } = string.Empty;

    [BsonElement("title")]
    public string Title { get; set; } = string.Empty;

    [BsonElement("description")]
    public string Description { get; set; } = string.Empty;

    [BsonElement("budget")]
    public string Budget { get; set; } = string.Empty;

    // Nouveaux champs budgétaires personnalisés. Le type de contrat détermine
    // l'interprétation (Fixed price vs Hourly). Les anciens projets conservent
    // leur champ "budget" textuel ; ces champs sont optionnels pour la compatibilité.
    [BsonElement("budgetMin")]
    public decimal? BudgetMin { get; set; }

    [BsonElement("budgetMax")]
    public decimal? BudgetMax { get; set; }

    [BsonElement("type")]
    public string Type { get; set; } = string.Empty;

    // Durée attendue structurée (facultative). Exemple : 3 Weeks.
    [BsonElement("durationValue")]
    public int? DurationValue { get; set; }

    [BsonElement("durationUnit")]
    public string? DurationUnit { get; set; }

    [BsonElement("proposals")]
    public int Proposals { get; set; }

    [BsonElement("skills")]
    public List<string> Skills { get; set; } = [];

    [BsonElement("client")]
    public string Client { get; set; } = string.Empty;

    [BsonElement("status")]
    public string Status { get; set; } = ProjectStatus.Open;

    [BsonElement("category")]
    public string? Category { get; set; }

    [BsonElement("deadline")]
    public string? Deadline { get; set; }

    /// <summary>Identifiant du freelance approuvé par le client (vide si le projet n'est pas encore attribué).</summary>
    [BsonElement("assignedTo")]
    public string? AssignedTo { get; set; }

    /// <summary>Nom du freelance approuvé, dénormalisé pour l'affichage.</summary>
    [BsonElement("assignedToName")]
    public string? AssignedToName { get; set; }

    /// <summary>Date d'approbation du freelance par le client.</summary>
    [BsonElement("assignedAt")]
    public DateTime? AssignedAt { get; set; }

    /// <summary>
    /// Historique des affectations_libérées. Chaque entrée conserve les
    /// informations du freelance retenu (identité, nom, date d'approbation)
    /// ainsi que la date et le motif de sa libération. L'historique n'est
    /// jamais purgé : il documente les annulations d'acceptation et les
    /// réouvertures de projet, même après remise à zéro de l'affectation
    /// active.
    /// </summary>
    [BsonElement("assignmentHistory")]
    public List<AssignmentHistoryEntry> AssignmentHistory { get; set; } = [];

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("attachments")]
    public List<ProjectAttachment> Attachments { get; set; } = [];

    /// <summary>
    /// Étapes du projet (Project Milestones). Les étapes standard sont
    /// synchronisées avec le statut du projet ; les étapes personnalisées
    /// existantes sont conservées.
    /// </summary>
    [BsonElement("milestones")]
    public List<ProjectMilestone> Milestones { get; set; } = [];

    /// <summary>
    /// Historique chronologique et append-only des changements de statut,
    /// validations, demandes de modification et messages liés aux milestones.
    /// </summary>
    [BsonElement("milestoneHistory")]
    public List<MilestoneHistoryEntry> MilestoneHistory { get; set; } = [];
}

/// <summary>
/// Trace d'une affectation de freelance libérée. L'entrée est écrite quand
/// l'affectation active est retirée du projet (annulation d'acceptation,
/// réouverture du projet ou changement de freelancer retenu) : elle conserve
/// les informations du freelance concerné et la raison de sa libération.
/// </summary>
public class AssignmentHistoryEntry
{
    /// <summary>Identifiant du freelance retenu (identifiant de compte).</summary>
    [BsonElement("freelancerId")]
    public string FreelancerId { get; set; } = string.Empty;

    /// <summary>Nom du freelance retenu, dénormalisé pour l'affichage.</summary>
    [BsonElement("freelancerName")]
    public string FreelancerName { get; set; } = string.Empty;

    /// <summary>Date à laquelle le freelance avait été approuvé.</summary>
    [BsonElement("assignedAt")]
    public DateTime? AssignedAt { get; set; }

    /// <summary>Date à laquelle l'affectation a été libérée.</summary>
    [BsonElement("releasedAt")]
    public DateTime? ReleasedAt { get; set; }

    /// <summary>
    /// Motif de la libération : « acceptance-cancelled », « project-reopened »
    /// ou « reassigned ».
    /// </summary>
    [BsonElement("reason")]
    public string Reason { get; set; } = string.Empty;
}

/// <summary>Motifs de libération d'une affectation de freelance.</summary>
public static class AssignmentReleaseReason
{
    /// <summary>Le client annule l'acceptation : le projet redevient ouvert.</summary>
    public const string AcceptanceCancelled = "acceptance-cancelled";

    /// <summary>Le client rouvre un projet terminé : l'affectation active est retirée.</summary>
    public const string ProjectReopened = "project-reopened";

    /// <summary>Un autre freelance est retenu à la place du précédent.</summary>
    public const string Reassigned = "reassigned";

    /// <summary>Retrait manuel de l'approbation par le client.</summary>
    public const string AssignmentRemoved = "assignment-removed";
}

public static class ProjectStatus
{
    public const string Open = "Open";
    public const string InProgress = "In progress";
    public const string ClientReview = "Client review";
    public const string Completed = "Completed";
    public const string Draft = "Draft";
    public const string Cancelled = "Cancelled";

    public static readonly string[] All = [Open, InProgress, ClientReview, Completed, Draft, Cancelled];

    public static bool IsValid(string status) => All.Contains(status);

    /// <summary>
    /// Un projet est publié (donc visible dans le catalogue des opportunités)
    /// lorsqu'il est au statut <see cref="Open"/>. Un brouillon reste privé.
    /// </summary>
    public static bool IsPublished(string status) => status == Open;

    /// <summary>
    /// Transitions autorisées entre statuts. Un projet suit le cycle
    /// Draft → Open → In progress → Client review → Completed. Un client peut
    /// dépublier un projet (retour à Draft) ou le clôturer directement.
    /// </summary>
    public static bool CanTransition(string from, string to) => (from, to) switch
    {
        (Draft, Draft) => true,
        (Draft, Open) => true,
        (Open, Open) => true,
        (Open, Draft) => true,
        (Open, InProgress) => true,
        (Open, Completed) => true,
        (InProgress, InProgress) => true,
        (InProgress, Open) => true,
        (InProgress, Draft) => true,
        (InProgress, ClientReview) => true,
        (InProgress, Completed) => true,
        (ClientReview, ClientReview) => true,
        (ClientReview, InProgress) => true,
        (ClientReview, Draft) => true,
        (ClientReview, Completed) => true,
        (Completed, Completed) => true,
        // Réouverture en cours d'exécution : le freelance assigné reprend le
        // projet sans perdre l'historique ni son affectation.
        (Completed, InProgress) => true,
        (Completed, Open) => true,
        (Completed, Draft) => true,
        _ => false,
    };
}

public class ProjectAttachment
{
    [BsonElement("fileName")]
    public string FileName { get; set; } = string.Empty;

    [BsonElement("url")]
    public string Url { get; set; } = string.Empty;

    [BsonElement("size")]
    public long Size { get; set; }

    [BsonElement("uploadedAt")]
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}
