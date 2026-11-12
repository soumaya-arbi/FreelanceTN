namespace FreelanceTn.Api.Dtos.Freelancers;

using FreelanceTn.Api.Dtos.Auth;

/// <summary>
/// Entrée d'annuaire public. Les champs sensibles du compte ne sont jamais
/// projetés ici : seules les informations déjà visibles sur un profil public
/// sont exposées.
/// </summary>
public class PublicFreelancerSummaryResponse
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Avatar { get; set; } = string.Empty;
    public string CoverImage { get; set; } = string.Empty;
    public string AvatarSource { get; set; } = "initials";
    public string? AvatarConfig { get; set; }
    public decimal HourlyRate { get; set; }
    public List<string> Skills { get; set; } = [];
}

/// <summary>
/// Projection publique d'un compte freelance. Aucune donnée de compte
/// (email, identifiant de connexion) n'est exposée.
/// </summary>
public class PublicFreelancerResponse
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;
    public string Avatar { get; set; } = string.Empty;
    public string CoverImage { get; set; } = string.Empty;
    public string AvatarSource { get; set; } = "initials";
    public string? AvatarConfig { get; set; }
    public List<string> Skills { get; set; } = [];
    public decimal HourlyRate { get; set; }
    public List<CvExperienceDto> Experiences { get; set; } = [];
    public List<CvEducationDto> Education { get; set; } = [];
    public List<CvLanguageDto> Languages { get; set; } = [];
    public List<CvCertificationDto> Certifications { get; set; } = [];
    public CvWorkPreferencesDto WorkPreferences { get; set; } = new();
    public DateTime CreatedAt { get; set; }
}
