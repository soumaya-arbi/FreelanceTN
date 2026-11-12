namespace FreelanceTn.Api.Configuration;

/// <summary>
/// Paramètres de la passerelle Konnect, volontairement limités au Sandbox.
///
/// La mission impose l'absence de bascule vers la production : quel que soit le
/// contenu de la configuration, <see cref="EnsureSandboxOnly"/> refuse toute
/// autre origine que <c>https://api.sandbox.konnect.network</c>. Les secrets
/// (clé API et identifiant du wallet marchand) ne doivent jamais être écrits
/// dans un fichier versionné : variables d'environnement ou User Secrets.
/// </summary>
public class KonnectSettings
{
    public const string SectionName = "Konnect";

    /// <summary>Hôte officiel du Sandbox Konnect (seule valeur acceptée).</summary>
    public const string SandboxHost = "api.sandbox.konnect.network";

    public const string SandboxBaseUrl = "https://api.sandbox.konnect.network/api/v2/";

    /// <summary>
    /// Active explicitement la passerelle. Sans cette valeur à <c>true</c>,
    /// les paiements carte renvoient une erreur claire (aucun repli silencieux
    /// vers un faux succès).
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>URL de base de l'API Konnect. Doit rester l'URL Sandbox.</summary>
    public string BaseUrl { get; set; } = SandboxBaseUrl;

    /// <summary>Clé API x-api-key du compte marchand Sandbox.</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>Identifiant du wallet marchand qui reçoit les paiements Sandbox.</summary>
    public string ReceiverWalletId { get; set; } = string.Empty;

    /// <summary>Délai maximal des appels HTTP vers Konnect (secondes).</summary>
    public int TimeoutSeconds { get; set; } = 20;

    /// <summary>Durée de validité du lien de paiement (minutes).</summary>
    public int LifespanMinutes { get; set; } = 15;

    /// <summary>Thème de la page hébergée : light ou dark.</summary>
    public string Theme { get; set; } = "light";

    /// <summary>URL publique du frontend pour les retours navigateur (injectée au démarrage).</summary>
    public string FrontendBaseUrl { get; set; } = string.Empty;

    /// <summary>URL publique du backend pour le webhook (injectée au démarrage).</summary>
    public string AppBaseUrl { get; set; } = string.Empty;

    /// <summary>La passerelle est réellement utilisable.</summary>
    public bool IsConfigured =>
        Enabled
        && !string.IsNullOrWhiteSpace(ApiKey)
        && !string.IsNullOrWhiteSpace(ReceiverWalletId);

    /// <summary>L'URL configurée pointe bien vers le Sandbox officiel en HTTPS.</summary>
    public bool IsSandboxUrl =>
        Uri.TryCreate(BaseUrl, UriKind.Absolute, out var uri)
        && string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
        && string.Equals(uri.Host, SandboxHost, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Refuse toute configuration autre que le Sandbox Konnect. Appelée au
    /// démarrage et à la construction du client HTTP : il n'existe aucun
    /// chemin de code permettant de viser l'environnement de production.
    /// </summary>
    public void EnsureSandboxOnly()
    {
        if (!IsSandboxUrl)
        {
            throw new InvalidOperationException(
                $"Konnect:BaseUrl doit pointer exclusivement vers le Sandbox " +
                $"{SandboxBaseUrl} (valeur actuelle refusée : {BaseUrl}). " +
                "La production est volontairement impossible dans ce projet.");
        }
    }
}
