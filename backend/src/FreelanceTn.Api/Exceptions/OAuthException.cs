namespace FreelanceTn.Api.Exceptions;

public class OAuthException : Exception
{
    public OAuthException(string code, string message) : base(message)
    {
        Code = code;
    }

    /// <summary>
    /// Variante utilisée pour le cas « compte local non vérifié » : l'interface a
    /// besoin d'indiquer l'adresse concernée (masquée) et si un e-mail de
    /// vérification vient d'être envoyé, sans jamais exposer l'adresse complète
    /// ni de jeton dans l'URL.
    /// </summary>
    public OAuthException(
        string code,
        string message,
        string? emailHint,
        bool verificationSent,
        int? cooldownSeconds) : base(message)
    {
        Code = code;
        EmailHint = emailHint;
        VerificationSent = verificationSent;
        CooldownSeconds = cooldownSeconds;
    }

    public string Code { get; }

    /// <summary>Adresse masquée (ex. « so***@esprit.tn »), jamais l'adresse complète.</summary>
    public string? EmailHint { get; }

    /// <summary>Vrai si un nouvel e-mail de vérification a réellement été remis au transport.</summary>
    public bool VerificationSent { get; }

    /// <summary>Secondes restantes avant un nouvel envoi autorisé, le cas échéant.</summary>
    public int? CooldownSeconds { get; }
}
