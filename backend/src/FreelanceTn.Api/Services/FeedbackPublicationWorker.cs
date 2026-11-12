using FreelanceTn.Api.Configuration;
using Microsoft.Extensions.Options;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Service d'arrière-plan qui publie automatiquement les évaluations arrivées à
/// échéance, sans dépendre d'une consultation de la page Feedback.
///
/// - S'exécute dans le processus de l'API, donc sans navigateur et sans script
///   local : compatible avec un conteneur, un App Service ou une machine
///   virtuelle.
/// - Un premier cycle a lieu peu après le démarrage, puis à intervalle régulier :
///   les échéances dépassées pendant un redémarrage sont reprises.
/// - Chaque cycle est idempotent (mises à jour conditionnelles, identifiants de
///   notification déterministes) : plusieurs instances de l'API peuvent tourner
///   en parallèle sans double publication ni notification dupliquée.
/// - Une erreur de cycle est journalisée puis retentée au cycle suivant.
/// </summary>
public sealed class FeedbackPublicationWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptions<FeedbackWorkerSettings> _settings;
    private readonly ILogger<FeedbackPublicationWorker> _logger;

    public FeedbackPublicationWorker(
        IServiceScopeFactory scopeFactory,
        IOptions<FeedbackWorkerSettings> settings,
        ILogger<FeedbackPublicationWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(Math.Max(5, _settings.Value.IntervalSeconds));
        var startupDelay = TimeSpan.FromSeconds(Math.Max(0, _settings.Value.StartupDelaySeconds));

        _logger.LogInformation(
            "Feedback publication worker started: first cycle in {StartupDelay}s, then every {Interval}s.",
            startupDelay.TotalSeconds,
            interval.TotalSeconds);

        try
        {
            if (startupDelay > TimeSpan.Zero)
            {
                await Task.Delay(startupDelay, stoppingToken);
            }

            using var timer = new PeriodicTimer(interval);
            do
            {
                await RunCycleAsync(stoppingToken);
            }
            while (await WaitForNextTickAsync(timer, stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Feedback publication worker stopped.");
        }
    }

    /// <summary>
    /// Exécute un cycle complet. Public pour être testé sans attendre
    /// l'intervalle réel ; le service planifié appelle exactement cette méthode.
    /// </summary>
    public async Task RunCycleAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var feedbackService = scope.ServiceProvider.GetRequiredService<FeedbackService>();

            _logger.LogInformation("Feedback publication cycle started.");
            var result = await feedbackService.ProcessPendingAsync(cancellationToken);
            _logger.LogInformation(
                "Feedback publication cycle finished: {Published} review(s) published, {Expired} request(s) expired, {Reminders} reminder(s) sent.",
                result.Published,
                result.Expired,
                result.Reminders);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Aucun contenu d'avis ni secret n'est journalisé.
            _logger.LogError(
                exception,
                "Feedback publication cycle failed; it will run again at the next interval.");
        }
    }

    private static async Task<bool> WaitForNextTickAsync(PeriodicTimer timer, CancellationToken cancellationToken)
    {
        try
        {
            return await timer.WaitForNextTickAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
