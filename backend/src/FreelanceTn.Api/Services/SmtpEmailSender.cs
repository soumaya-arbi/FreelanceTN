using System.Net;
using System.Net.Mail;
using FreelanceTn.Api.Configuration;
using FreelanceTn.Api.Exceptions;
using Microsoft.Extensions.Options;

namespace FreelanceTn.Api.Services;

public class SmtpEmailSender : IEmailSender
{
    private readonly EmailSettings _settings;
    private readonly ILogger<SmtpEmailSender> _logger;

    public EmailTransport Transport => EmailTransport.Smtp;

    public SmtpEmailSender(IOptions<AuthSettings> authSettings, ILogger<SmtpEmailSender> logger)
    {
        _settings = authSettings.Value.Email;
        _logger = logger;
    }

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        // Jamais l'adresse complète ni un identifiant dans les journaux.
        var recipient = AuthService.MaskEmail(message.To);
        var timeout = TimeSpan.FromSeconds(Math.Max(1, _settings.TimeoutSeconds));

        try
        {
            using var mail = new MailMessage
            {
                From = new MailAddress(_settings.FromAddress, _settings.FromName),
                Subject = message.Subject,
                Body = message.Body,
                IsBodyHtml = message.IsHtml,
            };
            mail.To.Add(message.To);

            using var client = new SmtpClient(_settings.Host, _settings.Port)
            {
                // EnableSsl = STARTTLS (port 587), pas de TLS implicite.
                EnableSsl = _settings.UseStartTls,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false,
                Timeout = (int)timeout.TotalMilliseconds,
            };

            if (!string.IsNullOrWhiteSpace(_settings.Username))
            {
                client.Credentials = new NetworkCredential(_settings.Username, _settings.Password);
            }

            // SmtpClient.Timeout ne s'applique qu'aux appels synchrones : on borne
            // aussi explicitement l'attente asynchrone.
            await client.SendMailAsync(mail, cancellationToken).WaitAsync(timeout, cancellationToken);

            _logger.LogInformation(
                "E-mail envoyé via SMTP {Host}:{Port} à {Recipient} (expéditeur {FromAddress}).",
                _settings.Host,
                _settings.Port,
                recipient,
                AuthService.MaskEmail(_settings.FromAddress));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Le détail (code SMTP, réponse du serveur) reste côté serveur ; le
            // message remonté au client ne contient aucun identifiant.
            _logger.LogError(
                exception,
                "Échec de l'envoi SMTP à {Recipient} via {Host}:{Port}. Aucun e-mail n'a été remis.",
                recipient,
                _settings.Host,
                _settings.Port);

            throw new EmailDeliveryException(
                "L'e-mail n'a pas pu être envoyé. Vérifiez la configuration e-mail du serveur.",
                exception);
        }
    }
}
