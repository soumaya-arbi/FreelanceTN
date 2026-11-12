using FreelanceTn.Api.Exceptions;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Utilisé quand aucun SMTP n'est configuré hors développement. Le message
/// n'est jamais envoyé : l'appelant doit le signaler à l'utilisateur au lieu
/// d'annoncer un envoi réussi.
/// </summary>
public class NullEmailSender : IEmailSender
{
    private readonly ILogger<NullEmailSender> _logger;

    public EmailTransport Transport => EmailTransport.None;

    public NullEmailSender(ILogger<NullEmailSender> logger)
    {
        _logger = logger;
    }

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        _logger.LogWarning(
            "Aucun fournisseur e-mail n'est configuré : le message vers {Recipient} n'a pas été envoyé.",
            message.To);

        throw new EmailDeliveryException(
            "L'envoi d'e-mails n'est pas configuré sur ce serveur. Contactez l'administrateur.");
    }
}
