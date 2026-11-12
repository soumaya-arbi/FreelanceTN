using FreelanceTn.Api.Configuration;
using Microsoft.Extensions.Options;

namespace FreelanceTn.Api.Services;

/// <summary>
/// Construit et envoie les e-mails transactionnels. Les liens utilisent
/// exclusivement l'URL publique configurée (FrontendBaseUrl / FRONTEND_BASE_URL) :
/// aucune URL localhost n'est codée en dur pour la production.
/// </summary>
public class AuthEmailService
{
    private readonly IEmailSender _sender;
    private readonly AuthSettings _settings;

    public AuthEmailService(IEmailSender sender, IOptions<AuthSettings> settings)
    {
        _sender = sender;
        _settings = settings.Value;
    }

    /// <summary>Transport réellement utilisé (SMTP, dossier de développement ou aucun).</summary>
    public EmailTransport Transport => _sender.Transport;

    /// <summary>
    /// Envoie l'e-mail de vérification et renvoie le lien généré. L'exception
    /// éventuelle du transport est propagée : l'appelant ne doit jamais annoncer
    /// un envoi qui n'a pas eu lieu.
    /// </summary>
    public async Task<string> SendVerificationAsync(string email, string token, CancellationToken cancellationToken)
    {
        var link = BuildLink("/verify-email", token);
        var expiresAt = DateTime.UtcNow.AddHours(Math.Max(1, _settings.VerificationTokenHours));
        var title = "Confirmez votre adresse e-mail";
        var intro = "Bienvenue sur FreelanceTN. Confirmez votre adresse e-mail pour activer votre compte.";
        var action = "Vérifier mon adresse e-mail";
        var expiry = $"Ce lien expire le {FormatExpiry(expiresAt)} (heure UTC).";
        var footer = "Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement ce message.";

        var html = BuildHtml(title, intro, action, link, expiry, footer);
        var text = BuildText(title, intro, link, expiry, footer);

        await _sender.SendAsync(
            new EmailMessage(email, "Confirmez votre adresse e-mail - FreelanceTN", html, IsHtml: true),
            cancellationToken);

        return link;
    }

    public Task SendPasswordResetAsync(
        string email,
        string token,
        int expiryMinutes,
        CancellationToken cancellationToken)
    {
        var link = BuildLink("/reset-password", token);
        var expiresAt = DateTime.UtcNow.AddMinutes(Math.Max(1, expiryMinutes));
        var title = "Réinitialisez votre mot de passe";
        var intro = "Vous avez demandé à réinitialiser le mot de passe de votre compte FreelanceTN.";
        var action = "Choisir un nouveau mot de passe";
        var expiry = $"Ce lien expire le {FormatExpiry(expiresAt)} (heure UTC) et ne peut être utilisé qu'une seule fois.";
        var footer = "Si vous n'avez pas demandé cette réinitialisation, ignorez ce message : votre mot de passe reste inchangé.";

        var html = BuildHtml(title, intro, action, link, expiry, footer);
        var text = BuildText(title, intro, link, expiry, footer);

        return _sender.SendAsync(
            new EmailMessage(email, "Réinitialisation de votre mot de passe - FreelanceTN", html, IsHtml: true),
            cancellationToken);
    }

    /// <summary>Invitation d'un collaborateur à rejoindre l'équipe d'un compte client.</summary>
    public Task SendTeamInvitationAsync(
        string email,
        string inviterName,
        string companyName,
        string role,
        string token,
        int expiryHours,
        CancellationToken cancellationToken)
    {
        var link = BuildLink("/team/accept", token);
        var expiresAt = DateTime.UtcNow.AddHours(Math.Max(1, expiryHours));
        var title = "Invitation à rejoindre une équipe";
        var company = string.IsNullOrWhiteSpace(companyName) ? "une entreprise" : companyName;
        var intro = $"{inviterName} vous invite à rejoindre l'équipe de {company} sur FreelanceTN en tant que {role}.";
        var action = "Accepter l'invitation";
        var expiry = $"Cette invitation expire le {FormatExpiry(expiresAt)} (heure UTC).";
        var footer = "Si vous ne connaissez pas cette entreprise, ignorez ce message.";

        var html = BuildHtml(title, intro, action, link, expiry, footer);
        var text = BuildText(title, intro, link, expiry, footer);

        return _sender.SendAsync(
            new EmailMessage(email, $"Invitation à rejoindre {company} - FreelanceTN", html, IsHtml: true),
            cancellationToken);
    }

    private string BuildLink(string path, string token)
    {
        var baseUrl = _settings.EffectiveFrontendBaseUrl.TrimEnd('/');
        return $"{baseUrl}{path}?token={Uri.EscapeDataString(token)}";
    }

    private static string FormatExpiry(DateTime utc) =>
        utc.ToString("dd/MM/yyyy 'à' HH:mm");

    private static string BuildText(string title, string intro, string link, string expiry, string footer) =>
        $"FreelanceTN{Environment.NewLine}{Environment.NewLine}" +
        $"{title}{Environment.NewLine}{Environment.NewLine}" +
        $"{intro}{Environment.NewLine}{Environment.NewLine}" +
        $"{link}{Environment.NewLine}{Environment.NewLine}" +
        $"{expiry}{Environment.NewLine}{Environment.NewLine}" +
        footer;

    private static string BuildHtml(string title, string intro, string action, string link, string expiry, string footer)
    {
        var safeLink = System.Net.WebUtility.HtmlEncode(link);
        var safeTitle = System.Net.WebUtility.HtmlEncode(title);
        var safeIntro = System.Net.WebUtility.HtmlEncode(intro);
        var safeAction = System.Net.WebUtility.HtmlEncode(action);
        var safeExpiry = System.Net.WebUtility.HtmlEncode(expiry);
        var safeFooter = System.Net.WebUtility.HtmlEncode(footer);

        return $@"<!DOCTYPE html>
<html lang=""fr"">
<head><meta charset=""utf-8""/><meta name=""viewport"" content=""width=device-width,initial-scale=1""/></head>
<body style=""margin:0;padding:0;background:#f5f5fa;font-family:Arial,Helvetica,sans-serif;color:#1f2430;"">
  <table role=""presentation"" width=""100%"" cellspacing=""0"" cellpadding=""0"" style=""background:#f5f5fa;padding:32px 12px;"">
    <tr><td align=""center"">
      <table role=""presentation"" width=""100%"" cellspacing=""0"" cellpadding=""0"" style=""max-width:560px;background:#ffffff;border-radius:16px;padding:36px 32px;box-shadow:0 8px 28px rgba(20,18,45,.08);"">
        <tr><td style=""font-size:20px;font-weight:800;color:#5145e5;padding-bottom:24px;"">FreelanceTN</td></tr>
        <tr><td style=""font-size:22px;font-weight:800;padding-bottom:12px;"">{safeTitle}</td></tr>
        <tr><td style=""font-size:15px;line-height:1.6;color:#475467;padding-bottom:24px;"">{safeIntro}</td></tr>
        <tr><td align=""center"" style=""padding-bottom:24px;"">
          <a href=""{safeLink}"" style=""display:inline-block;background:#5145e5;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:10px;"">{safeAction}</a>
        </td></tr>
        <tr><td style=""font-size:13px;line-height:1.6;color:#667085;padding-bottom:20px;"">{safeExpiry}</td></tr>
        <tr><td style=""font-size:12px;line-height:1.6;color:#98a2b3;border-top:1px solid #eaecf0;padding-top:18px;"">{safeFooter}</td></tr>
        <tr><td style=""font-size:11px;line-height:1.6;color:#98a2b3;padding-top:14px;word-break:break-all;"">Si le bouton ne fonctionne pas, copiez ce lien : {safeLink}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>";
    }
}
