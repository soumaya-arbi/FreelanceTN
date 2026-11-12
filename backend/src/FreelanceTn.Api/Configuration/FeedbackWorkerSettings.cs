namespace FreelanceTn.Api.Configuration;

/// <summary>
/// Réglages du traitement périodique des évaluations. Valeurs surchargées par
/// les variables d'environnement standard (<c>Feedback__IntervalSeconds</c>).
/// </summary>
public class FeedbackWorkerSettings
{
    public const string SectionName = "Feedback";

    /// <summary>Intervalle entre deux cycles, en secondes (minimum appliqué : 5 s).</summary>
    public int IntervalSeconds { get; set; } = 300;

    /// <summary>Délai avant le premier cycle après le démarrage, en secondes.</summary>
    public int StartupDelaySeconds { get; set; } = 15;
}
