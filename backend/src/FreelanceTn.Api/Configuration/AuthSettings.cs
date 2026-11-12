namespace FreelanceTn.Api.Configuration;

public class AuthSettings
{
    public const string SectionName = "Auth";

    /// <summary>
    /// Ancienne clé conservée pour compatibilité. Utiliser <see cref="FrontendBaseUrl"/>
    /// en priorité (variable d'environnement FRONTEND_BASE_URL / Auth__FrontendBaseUrl).
    /// </summary>
    public string FrontendUrl { get; set; } = "http://localhost:8443";

    /// <summary>
    /// URL publique du frontend utilisée pour construire les liens des e-mails
    /// (vérification, réinitialisation). En production : https://votre-domaine.
    /// Si vide, <see cref="FrontendUrl"/> sert de repli.
    /// </summary>
    public string FrontendBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// URL publique du backend (documentation, callbacks). Aucune valeur de
    /// production n'est inventée : elle doit être fournie au déploiement.
    /// </summary>
    public string AppBaseUrl { get; set; } = string.Empty;

    public int VerificationTokenHours { get; set; } = 24;
    public int ResetTokenMinutes { get; set; } = 60;
    public int ResendCooldownSeconds { get; set; } = 60;

    /// <summary>Délai anti-abus entre deux demandes de réinitialisation (secondes).</summary>
    public int ForgotPasswordCooldownSeconds { get; set; } = 60;

    /// <summary>Durée de validité d'une session « Remember me » (jours).</summary>
    public int RememberMeDays { get; set; } = 30;

    /// <summary>Durée de validité d'une invitation d'équipe (heures).</summary>
    public int TeamInviteTokenHours { get; set; } = 168;

    /// <summary>Taille maximale des images téléversées (avatars, logos, couvertures), en Mo.</summary>
    public int MaxImageUploadMb { get; set; } = 5;

    /// <summary>URL publique du frontend, avec repli sur l'ancienne clé.</summary>
    public string EffectiveFrontendBaseUrl =>
        !string.IsNullOrWhiteSpace(FrontendBaseUrl) ? FrontendBaseUrl.Trim() : FrontendUrl.Trim();

    /// <summary>
    /// Expose le lien de vérification dans la réponse API quand l'e-mail est
    /// seulement écrit dans le dossier de développement (aucun SMTP). Désactivé
    /// par défaut : activé uniquement en Development. Ne jamais activer en production.
    /// </summary>
    public bool ExposeDevEmailLinks { get; set; }

    public GoogleSettings Google { get; set; } = new();
    public EmailSettings Email { get; set; } = new();
}

public class GoogleSettings
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;

    /// <summary>
    /// URL de callback enregistrée dans Google Cloud Console. Elle doit passer par
    /// l'origine du frontend (proxy Next "/api/*" -> backend) pour que le cookie
    /// d'état OAuth soit posé et relu sur la même origine.
    /// </summary>
    public string RedirectUri { get; set; } = "http://localhost:8443/api/auth/google/callback";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}

public class EmailSettings
{
    public const string ModeAuto = "auto";
    public const string ModeSmtp = "smtp";
    public const string ModeDevOutbox = "dev-outbox";
    public const string ModeNone = "none";

    /// <summary>
    /// Transport à utiliser : auto (SMTP si Host renseigné, sinon dev-outbox en
    /// Development), smtp, dev-outbox ou none. Permet de garder le dossier de
    /// développement même quand les identifiants SMTP existent.
    /// </summary>
    public string Mode { get; set; } = ModeAuto;

    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public bool UseStartTls { get; set; } = true;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string FromAddress { get; set; } = "no-reply@freelancetn.local";
    public string FromName { get; set; } = "FreelanceTN";
    public string DevOutboxPath { get; set; } = "App_Data/dev-emails";

    /// <summary>Délai maximal d'une remise SMTP (secondes).</summary>
    public int TimeoutSeconds { get; set; } = 15;
}
