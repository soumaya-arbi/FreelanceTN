using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

/// <summary>
/// Statuts d'une étape (milestone) d'un projet. Les statuts sont indépendants
/// du statut global du projet : une étape peut être « Changes requested » alors
/// que le projet est revenu « In progress ».
/// </summary>
public static class MilestoneStatus
{
    public const string Pending = "Pending";
    public const string InProgress = "In progress";
    public const string Submitted = "Submitted";
    public const string ChangesRequested = "Changes requested";
    public const string Approved = "Approved";
    public const string Completed = "Completed";

    public static readonly string[] All =
        [Pending, InProgress, Submitted, ChangesRequested, Approved, Completed];
}

/// <summary>
/// Clés des étapes générées automatiquement à partir du statut du projet. Ces
/// clés permettent de mettre à jour une étape existante sans jamais en créer
/// une seconde (synchronisation idempotente). Les étapes personnalisées n'ont
/// pas de clé de synchronisation et ne sont jamais modifiées automatiquement.
/// </summary>
public static class MilestoneKey
{
    public const string Kickoff = "kickoff";
    public const string Work = "work";
    public const string Review = "review";
    public const string Completion = "completion";
}

/// <summary>
/// Étape du projet (Project Milestones). Les étapes standard sont créées et
/// synchronisées automatiquement avec le statut du projet ; les étapes
/// personnalisées déjà présentes sont conservées telles quelles.
/// </summary>
public class ProjectMilestone
{
    [BsonElement("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    /// <summary>Clé de synchronisation (vide pour une étape personnalisée).</summary>
    [BsonElement("key")]
    public string Key { get; set; } = string.Empty;

    [BsonElement("title")]
    public string Title { get; set; } = string.Empty;

    [BsonElement("status")]
    public string Status { get; set; } = MilestoneStatus.Pending;

    /// <summary>Progression de l'étape, de 0 à 100.</summary>
    [BsonElement("progress")]
    public int Progress { get; set; }

    /// <summary>Date cible ou date de réalisation de l'étape (facultative).</summary>
    [BsonElement("date")]
    [BsonIgnoreIfNull]
    public DateTime? Date { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Entrée chronologique de l'historique des milestones : changement de statut
/// du projet, mise à jour d'une étape, validation, demande de modification ou
/// simple message. L'historique est append-only : aucune entrée n'est modifiée
/// ni supprimée, y compris lors d'une réouverture du projet.
/// </summary>
public class MilestoneHistoryEntry
{
    [BsonElement("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    /// <summary>Étape concernée (null pour un événement au niveau du projet).</summary>
    [BsonElement("milestoneId")]
    [BsonIgnoreIfNull]
    public string? MilestoneId { get; set; }

    [BsonElement("milestoneTitle")]
    public string MilestoneTitle { get; set; } = string.Empty;

    /// <summary>
    /// Nature de l'événement : project-status, milestone-status, comment,
    /// approved, changes-requested, submitted, project-reopened.
    /// </summary>
    [BsonElement("type")]
    public string Type { get; set; } = string.Empty;

    [BsonElement("message")]
    public string Message { get; set; } = string.Empty;

    [BsonElement("authorId")]
    public string AuthorId { get; set; } = string.Empty;

    [BsonElement("authorName")]
    public string AuthorName { get; set; } = string.Empty;

    [BsonElement("authorRole")]
    public string AuthorRole { get; set; } = string.Empty;

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Synchronisation des étapes standard avec le statut du projet. La logique est
/// volontairement pure (aucun accès base) afin d'être réutilisée par
/// <c>ProjectService</c> et <c>ProposalService</c> et testée directement.
/// </summary>
public static class ProjectMilestoneWorkflow
{
    /// <summary>
    /// Crée les étapes standard si elles n'existent pas encore, puis met à jour
    /// leur statut et leur progression selon le statut du projet. Une étape
    /// existante est identifiée par sa clé : aucun doublon n'est créé lors des
    /// changements de statut successifs. Les étapes personnalisées (clé vide ou
    /// clé inconnue) ne sont jamais modifiées.
    /// </summary>
    public static void Sync(Project project, string? previousStatus, string nextStatus, DateTime now)
    {
        project.Milestones ??= [];

        var template = BuildTemplate(nextStatus);
        foreach (var item in template)
        {
            var existing = project.Milestones.FirstOrDefault(milestone =>
                string.Equals(milestone.Key, item.Key, StringComparison.Ordinal));

            if (existing is null)
            {
                project.Milestones.Add(new ProjectMilestone
                {
                    Key = item.Key,
                    Title = item.Title,
                    Status = item.Status,
                    Progress = item.Progress,
                    Date = item.Date,
                    CreatedAt = now,
                    UpdatedAt = now,
                });
                continue;
            }

            // Une étape personnalisée ne peut pas porter une clé standard : la
            // clé est réservée à la synchronisation automatique.
            existing.Title = item.Title;
            existing.Status = item.Status;
            existing.Progress = item.Progress;
            existing.Date = item.Date;
            existing.UpdatedAt = now;
        }

        // Le modèle ci-dessus réinitialise déjà les étapes non terminées lors
        // d'une réouverture (Completed → In progress) : l'historique reste
        // intact, seules les étapes actives reprennent leur progression.
        _ = previousStatus;
    }

    /// <summary>Ajoute une entrée à l'historique des milestones (append-only).</summary>
    public static MilestoneHistoryEntry AppendHistory(
        Project project,
        string type,
        string message,
        string authorId,
        string authorName,
        string authorRole,
        DateTime now,
        ProjectMilestone? milestone = null)
    {
        project.MilestoneHistory ??= [];

        var entry = new MilestoneHistoryEntry
        {
            MilestoneId = milestone?.Id,
            MilestoneTitle = milestone?.Title ?? string.Empty,
            Type = type,
            Message = message ?? string.Empty,
            AuthorId = authorId,
            AuthorName = authorName,
            AuthorRole = authorRole,
            CreatedAt = now,
        };

        project.MilestoneHistory.Add(entry);
        return entry;
    }

    private static List<(string Key, string Title, string Status, int Progress, DateTime? Date)> BuildTemplate(string status)
    {
        var normalized = status?.Trim() ?? ProjectStatus.Open;
        var completed = string.Equals(normalized, ProjectStatus.Completed, StringComparison.OrdinalIgnoreCase);
        var inProgress = string.Equals(normalized, ProjectStatus.InProgress, StringComparison.OrdinalIgnoreCase);
        var inReview = string.Equals(normalized, ProjectStatus.ClientReview, StringComparison.OrdinalIgnoreCase);

        var kickoff = completed || inProgress || inReview
            ? (MilestoneStatus.Completed, 100)
            : (MilestoneStatus.Pending, 0);

        var work = completed
            ? (MilestoneStatus.Completed, 100)
            : inReview
                ? (MilestoneStatus.Completed, 100)
                : inProgress
                    ? (MilestoneStatus.InProgress, 60)
                    : (MilestoneStatus.Pending, 0);

        var review = completed
            ? (MilestoneStatus.Completed, 100)
            : inReview
                ? (MilestoneStatus.Submitted, 75)
                : (MilestoneStatus.Pending, 0);

        var completion = completed
            ? (MilestoneStatus.Completed, 100)
            : (MilestoneStatus.Pending, 0);

        return
        [
            (MilestoneKey.Kickoff, "Project kickoff", kickoff.Item1, kickoff.Item2, null),
            (MilestoneKey.Work, "Work in progress", work.Item1, work.Item2, null),
            (MilestoneKey.Review, "Client review & approval", review.Item1, review.Item2, null),
            (MilestoneKey.Completion, "Project completion", completion.Item1, completion.Item2, null),
        ];
    }
}
