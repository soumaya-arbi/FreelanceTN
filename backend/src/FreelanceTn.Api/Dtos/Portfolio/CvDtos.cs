using System.Text.Json.Serialization;
using FreelanceTn.Api.Dtos.Auth;

namespace FreelanceTn.Api.Dtos.Portfolio;

/// <summary>
/// Données extraites d'un CV PDF. Seuls les champs réellement modifiables dans
/// le portfolio sont renvoyés ; les informations ambiguës sont listées dans
/// <see cref="Uncertain"/> pour être vérifiées avant sauvegarde.
/// </summary>
public class CvImportResponse
{
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;

    /// <summary>Coordonnées détectées (l'e-mail du compte n'est jamais modifié par l'import).</summary>
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;

    [JsonPropertyName("linkedin")]
    public string LinkedIn { get; set; } = string.Empty;

    [JsonPropertyName("github")]
    public string GitHub { get; set; } = string.Empty;

    public string Website { get; set; } = string.Empty;

    public List<string> Skills { get; set; } = [];
    public List<CvExperienceDto> Experiences { get; set; } = [];
    public List<CvEducationDto> Education { get; set; } = [];
    public List<CvCertificationDto> Certifications { get; set; } = [];
    public List<CvLanguageDto> Languages { get; set; } = [];

    /// <summary>Liens bruts détectés dans le CV (informatif).</summary>
    public List<string> Links { get; set; } = [];

    /// <summary>Éléments ambigus à vérifier manuellement avant sauvegarde.</summary>
    public List<string> Uncertain { get; set; } = [];

    public List<string> Warnings { get; set; } = [];
    public int PageCount { get; set; }
    public int PagesWithText { get; set; }
    public int ExtractedCharacters { get; set; }
}
