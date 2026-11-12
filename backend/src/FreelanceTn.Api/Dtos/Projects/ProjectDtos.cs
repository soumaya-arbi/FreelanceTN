namespace FreelanceTn.Api.Dtos.Projects;

public class CreateProjectRequest
{
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Budget { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public List<string> Skills { get; set; } = [];
    public string Client { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? Deadline { get; set; }

    // Nouveaux champs budgétaires personnalisés (Fixed Price ou Hourly).
    public decimal? BudgetMin { get; set; }
    public decimal? BudgetMax { get; set; }

    // Durée attendue structurée (facultative).
    public int? DurationValue { get; set; }
    public string? DurationUnit { get; set; }

    public List<ProjectAttachmentRequest>? Attachments { get; set; }
}

public class UpdateProjectRequest
{
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? Budget { get; set; }
    public string? Type { get; set; }
    public List<string>? Skills { get; set; }
    public string? Client { get; set; }
    public string? Status { get; set; }
    public string? Category { get; set; }
    public string? Deadline { get; set; }

    /// <summary>
    /// Freelance approuvé par le client (identifiant de compte). Une chaîne vide
    /// retire l'approbation. Absent (null), l'approbation est inchangée.
    /// </summary>
    public string? AssignedTo { get; set; }

    // Nouveaux champs budgétaires personnalisés.
    public decimal? BudgetMin { get; set; }
    public decimal? BudgetMax { get; set; }

    // Durée attendue structurée (facultative).
    public int? DurationValue { get; set; }
    public string? DurationUnit { get; set; }

    public List<ProjectAttachmentRequest>? Attachments { get; set; }

    /// <summary>
    /// Message optionnel associé à un changement de statut (avancement du
    /// freelance, demande de correction du client, réouverture). Il est
    /// enregistré dans l'historique chronologique des milestones.
    /// </summary>
    public string? Message { get; set; }
}

public class ReopenProjectRequest
{
    /// <summary>Message optionnel expliquant la réouverture du projet.</summary>
    public string? Message { get; set; }
}

public class MilestoneActionRequest
{
    /// <summary>
    /// Action demandée : progress, submit, approve, request-changes ou comment.
    /// </summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>Progression de l'étape (0 à 100) pour les actions du freelance.</summary>
    public int? Progress { get; set; }

    /// <summary>Message expliquant l'action ; obligatoire pour une demande de modification.</summary>
    public string? Message { get; set; }
}

public class CreateMilestoneRequest
{
    public string Title { get; set; } = string.Empty;
    public DateTime? Date { get; set; }
}

public class SubmitForReviewRequest
{
    public string? Message { get; set; }
}

public class ProjectAttachmentRequest
{
    public string FileName { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime? UploadedAt { get; set; }
}

public class UploadProjectAttachmentResponse
{
    public string FileName { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime UploadedAt { get; set; }
}

public class ProjectResponse
{
    public string Id { get; set; } = string.Empty;
    public string OwnerId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Budget { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public int Proposals { get; set; }
    public List<string> Skills { get; set; } = [];
    public string Client { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? Deadline { get; set; }
    public string? AssignedTo { get; set; }

    // Nouveaux champs budgétaires personnalisés.
    public decimal? BudgetMin { get; set; }
    public decimal? BudgetMax { get; set; }

    // Durée attendue structurée (facultative).
    public int? DurationValue { get; set; }
    public string? DurationUnit { get; set; }
    public string? AssignedToName { get; set; }
    public DateTime? AssignedAt { get; set; }

    /// <summary>
    /// Historique des affectations libérées (annulation d'acceptation,
    /// réouverture du projet). Conservé en permanence : le projet peut être
    /// réattribué sans perdre la trace des freelances précédents.
    /// </summary>
    public List<AssignmentHistoryEntryResponse> AssignmentHistory { get; set; } = [];

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<ProjectAttachmentResponse> Attachments { get; set; } = [];

    /// <summary>Étapes du projet, standard et personnalisées.</summary>
    public List<ProjectMilestoneResponse> Milestones { get; set; } = [];

    /// <summary>Historique chronologique (ordre d'ajout) des événements milestones.</summary>
    public List<MilestoneHistoryEntryResponse> MilestoneHistory { get; set; } = [];
}

public class ProjectMilestoneResponse
{
    public string Id { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public int Progress { get; set; }
    public DateTime? Date { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class MilestoneHistoryEntryResponse
{
    public string Id { get; set; } = string.Empty;
    public string? MilestoneId { get; set; }
    public string MilestoneTitle { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string AuthorId { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public string AuthorRole { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class ProjectAttachmentResponse
{
    public string FileName { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime UploadedAt { get; set; }
}

/// <summary>
/// Trace d'une affectation de freelance libérée : identité du freelance,
/// date d'approbation, date de libération et motif.
/// </summary>
public class AssignmentHistoryEntryResponse
{
    public string FreelancerId { get; set; } = string.Empty;
    public string FreelancerName { get; set; } = string.Empty;
    public DateTime? AssignedAt { get; set; }
    public DateTime? ReleasedAt { get; set; }
    public string Reason { get; set; } = string.Empty;
}

/// <summary>
/// Freelance selectable par un client pour approuver un projet.
/// Seules les informations publiques sont exposées (ni email, ni jeton).
/// </summary>
public class FreelancerSummaryResponse
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Avatar { get; set; } = string.Empty;
}
