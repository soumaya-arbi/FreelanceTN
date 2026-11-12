using System.Text.Json.Serialization;

namespace FreelanceTn.Api.Dtos.Auth;

public class RegisterRequest
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;

    /// <summary>Rôle choisi à l'inscription : "freelancer" ou "client". Validé côté serveur.</summary>
    public string Role { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;
    public List<string> Skills { get; set; } = [];
    public decimal HourlyRate { get; set; }
}

public class LoginRequest
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;

    /// <summary>
    /// Cookie persistant (durée configurable) quand vrai, cookie de session
    /// (supprimé à la fermeture du navigateur) quand faux.
    /// </summary>
    public bool RememberMe { get; set; }
}

public class RegisterResponse
{
    public string Message { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public bool RequiresEmailVerification { get; set; } = true;

    /// <summary>Résultat réel de l'envoi (transport utilisé et lien en mode développement).</summary>
    public EmailDeliveryResponse EmailDelivery { get; set; } = new();
}

/// <summary>
/// État réel de l'envoi d'un e-mail transactionnel. Permet à l'interface de ne
/// jamais afficher « e-mail envoyé » quand aucun envoi n'a eu lieu
/// (transport "none") ou que l'envoi a échoué ("sent": false).
/// </summary>
public class EmailDeliveryResponse
{
    public bool Sent { get; set; }

    /// <summary>"smtp", "dev-outbox" ou "none".</summary>
    public string Transport { get; set; } = "none";

    /// <summary>
    /// Lien de vérification exposé uniquement en développement quand les e-mails
    /// sont écrits dans App_Data/dev-emails (jamais renseigné en production).
    /// </summary>
    public string? DevVerificationUrl { get; set; }
}

public class MessageResponse
{
    public string Message { get; set; } = string.Empty;
}

public class VerifyEmailRequest
{
    public string Token { get; set; } = string.Empty;
}

public class TwoFactorVerifyRequest
{
    public string PreAuthToken { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
}

public class VerifyEmailResponse
{
    public string Message { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public bool EmailVerified { get; set; } = true;
}

public class ResendVerificationRequest
{
    public string Email { get; set; } = string.Empty;
}

public class ResendVerificationResponse
{
    public string Message { get; set; } = string.Empty;

    /// <summary>Vrai uniquement si un e-mail a réellement été remis au transport.</summary>
    public bool Sent { get; set; }

    /// <summary>Secondes restantes avant un nouvel envoi autorisé.</summary>
    public int? CooldownSeconds { get; set; }

    /// <summary>Lien de vérification en mode développement (jamais en production).</summary>
    public string? DevVerificationUrl { get; set; }
}

public class ForgotPasswordRequest
{
    public string Email { get; set; } = string.Empty;
}

public class ResetPasswordRequest
{
    public string Token { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class AuthProvidersResponse
{
    public bool Google { get; set; }

    /// <summary>"smtp", "dev-outbox" ou "none" : transport e-mail réellement actif.</summary>
    public string EmailTransport { get; set; } = "none";

    /// <summary>Explication destinée à l'interface quand Google n'est pas configuré.</summary>
    public string? GoogleConfigurationHint { get; set; }
}

public class UpdateProfileRequest
{
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? Title { get; set; }
    public string? Location { get; set; }
    public string? Phone { get; set; }

    [JsonPropertyName("linkedin")]
    public string? LinkedIn { get; set; }

    [JsonPropertyName("github")]
    public string? GitHub { get; set; }

    public string? Website { get; set; }
    public string? Bio { get; set; }
    public string? Avatar { get; set; }
    public string? AvatarSource { get; set; }
    public string? AvatarConfig { get; set; }
    public string? CoverImage { get; set; }
    public List<string>? Skills { get; set; }
    public decimal? HourlyRate { get; set; }

    /// <summary>Remplacé intégralement quand fourni (null = ne pas modifier).</summary>
    public List<CvExperienceDto>? Experiences { get; set; }
    public List<CvEducationDto>? Education { get; set; }
    public List<CvLanguageDto>? Languages { get; set; }
    public List<CvCertificationDto>? Certifications { get; set; }
    public CvWorkPreferencesDto? WorkPreferences { get; set; }
}

public class CvExperienceDto
{
    public string? Id { get; set; }
    public string Role { get; set; } = string.Empty;
    public string Company { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Period { get; set; } = string.Empty;
    public string StartDate { get; set; } = string.Empty;
    public string EndDate { get; set; } = string.Empty;
    public bool IsCurrent { get; set; }
    public List<string> Technologies { get; set; } = [];
    public string Description { get; set; } = string.Empty;
}

public class CvEducationDto
{
    public string? Id { get; set; }
    public string Degree { get; set; } = string.Empty;
    public string Institution { get; set; } = string.Empty;
    public string Specialty { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Period { get; set; } = string.Empty;
    public string StartDate { get; set; } = string.Empty;
    public string EndDate { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}

public class CvCertificationDto
{
    public string? Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Issuer { get; set; } = string.Empty;
    public string Year { get; set; } = string.Empty;
}

public class CvLanguageDto
{
    public string? Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Level { get; set; } = string.Empty;
}

public class CvWorkPreferencesDto
{
    public List<string> ProjectTypes { get; set; } = [];
    public string WorkPreference { get; set; } = string.Empty;
    public string MinimumBudget { get; set; } = string.Empty;
}

public class UserResponse
{
    public string Id { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public bool EmailVerified { get; set; }
    public bool HasPassword { get; set; }
    public bool RequirePasswordChange { get; set; }
    public string Role { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;

    [JsonPropertyName("linkedin")]
    public string LinkedIn { get; set; } = string.Empty;

    [JsonPropertyName("github")]
    public string GitHub { get; set; } = string.Empty;

    public string Website { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;
    public string Avatar { get; set; } = string.Empty;
    public string AvatarSource { get; set; } = "initials";
    public string AvatarPreset { get; set; } = string.Empty;
    public string AvatarColor { get; set; } = string.Empty;
    public string? AvatarConfig { get; set; }
    public List<string> Skills { get; set; } = [];
    public decimal HourlyRate { get; set; }
    public List<CvExperienceDto> Experiences { get; set; } = [];
    public List<CvEducationDto> Education { get; set; } = [];
    public List<CvLanguageDto> Languages { get; set; } = [];
    public List<CvCertificationDto> Certifications { get; set; } = [];
    public CvWorkPreferencesDto WorkPreferences { get; set; } = new();

    // Profil client (renseigné pour les comptes client ; vide pour les freelance).
    public string CompanyName { get; set; } = string.Empty;
    public string CompanyLogo { get; set; } = string.Empty;
    public string CoverImage { get; set; } = string.Empty;
    public string Industry { get; set; } = string.Empty;
    public string Position { get; set; } = string.Empty;
    public string CompanyWebsite { get; set; } = string.Empty;
    public string CompanySize { get; set; } = string.Empty;
    public string CompanyDescription { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;
    public string Governorate { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string BusinessAddress { get; set; } = string.Empty;
    public string PersonalPresentation { get; set; } = string.Empty;
    public string ProfessionalEmail { get; set; } = string.Empty;
    public string ProfessionalPhone { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
