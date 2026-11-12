namespace FreelanceTn.Api.Services;

public record EmailMessage(string To, string Subject, string Body, bool IsHtml = false);

/// <summary>Moyen d'envoi réellement utilisé pour un e-mail transactionnel.</summary>
public enum EmailTransport
{
    /// <summary>Aucun fournisseur : le message n'est pas envoyé (production mal configurée).</summary>
    None = 0,

    /// <summary>SMTP réel (production).</summary>
    Smtp = 1,

    /// <summary>Développement : le message est écrit dans App_Data/dev-emails.</summary>
    DevOutbox = 2,
}

public interface IEmailSender
{
    /// <summary>Transport effectif, exposé à l'API pour ne jamais annoncer un envoi fictif.</summary>
    EmailTransport Transport { get; }

    Task SendAsync(EmailMessage message, CancellationToken cancellationToken);
}
