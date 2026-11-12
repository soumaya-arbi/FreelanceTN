using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace FreelanceTn.Api.Models;

public static class UserRole
{
    public const string Freelancer = "freelancer";
    public const string Client = "client";

    /// <summary>Rôles acceptés à l'inscription.</summary>
    public static readonly string[] All = [Freelancer, Client];

    /// <summary>Indique si la valeur reçue correspond à un rôle connu.</summary>
    public static bool IsValid(string? role) =>
        !string.IsNullOrWhiteSpace(role) && All.Contains(role.Trim(), StringComparer.OrdinalIgnoreCase);

    /// <summary>Normalise un rôle reçu vers une valeur stockée connue.</summary>
    public static string Normalize(string? role) =>
        string.Equals(role?.Trim(), Client, StringComparison.OrdinalIgnoreCase) ? Client : Freelancer;
}

/// <summary>
/// Compte utilisateur. Le rôle (<see cref="UserRole.Freelancer"/> ou <see cref="UserRole.Client"/>)
/// est choisi à l'inscription, validé par le backend puis stocké en base : il ne provient jamais
/// d'une valeur envoyée par le client et n'est pas modifiable après la création du compte.
/// Les comptes créés avant l'introduction du rôle client conservent la valeur par défaut
/// <see cref="UserRole.Freelancer"/>.
/// </summary>
[BsonIgnoreExtraElements]
public class User
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    [BsonElement("email")]
    public string Email { get; set; } = string.Empty;

    [BsonElement("emailNormalized")]
    public string EmailNormalized { get; set; } = string.Empty;

    [BsonElement("passwordHash")]
    public string PasswordHash { get; set; } = string.Empty;

    [BsonElement("emailVerified")]
    [BsonIgnoreIfNull]
    public bool? EmailVerified { get; set; }

    [BsonElement("emailVerificationTokenHash")]
    [BsonIgnoreIfNull]
    public string? EmailVerificationTokenHash { get; set; }

    [BsonElement("emailVerificationExpiresAt")]
    [BsonIgnoreIfNull]
    public DateTime? EmailVerificationExpiresAt { get; set; }

    [BsonElement("emailVerificationSentAt")]
    [BsonIgnoreIfNull]
    public DateTime? EmailVerificationSentAt { get; set; }

    [BsonElement("passwordResetTokenHash")]
    [BsonIgnoreIfNull]
    public string? PasswordResetTokenHash { get; set; }

    [BsonElement("passwordResetExpiresAt")]
    [BsonIgnoreIfNull]
    public DateTime? PasswordResetExpiresAt { get; set; }

    /// <summary>Dernière demande de réinitialisation (protection anti-abus).</summary>
    [BsonElement("passwordResetSentAt")]
    [BsonIgnoreIfNull]
    public DateTime? PasswordResetSentAt { get; set; }

    /// <summary>Date du dernier changement de mot de passe (historique de sécurité).</summary>
    [BsonElement("passwordChangedAt")]
    [BsonIgnoreIfNull]
    public DateTime? PasswordChangedAt { get; set; }

    /// <summary>Impose le changement de mot de passe à la première connexion (invitations d'équipe).</summary>
    [BsonElement("requirePasswordChange")]
    public bool RequirePasswordChange { get; set; }

    /// <summary>Réservé à une future double authentification TOTP (désactivé par défaut).</summary>
    [BsonElement("twoFactorEnabled")]
    public bool TwoFactorEnabled { get; set; }

    [BsonElement("twoFactorEnabledAt")]
    [BsonIgnoreIfNull]
    public DateTime? TwoFactorEnabledAt { get; set; }

    /// <summary>Secret TOTP chiffré (Base32 en clair côté serveur uniquement lors du setup).</summary>
    [BsonElement("twoFactorSecret")]
    [BsonIgnoreIfNull]
    public string? TwoFactorSecret { get; set; }

    /// <summary>Hashes SHA-256 des codes de récupération (usage unique).</summary>
    [BsonElement("recoveryCodeHashes")]
    public List<string> RecoveryCodeHashes { get; set; } = [];

    [BsonElement("twoFactorFailedAttempts")]
    public int TwoFactorFailedAttempts { get; set; }

    [BsonElement("twoFactorLockoutUntil")]
    [BsonIgnoreIfNull]
    public DateTime? TwoFactorLockoutUntil { get; set; }

    [BsonElement("googleId")]
    [BsonIgnoreIfNull]
    public string? GoogleId { get; set; }

    [BsonElement("role")]
    public string Role { get; set; } = UserRole.Freelancer;

    [BsonElement("firstName")]
    public string FirstName { get; set; } = string.Empty;

    [BsonElement("lastName")]
    public string LastName { get; set; } = string.Empty;

    [BsonElement("title")]
    public string Title { get; set; } = string.Empty;

    [BsonElement("location")]
    public string Location { get; set; } = string.Empty;

    /// <summary>Téléphone professionnel affiché dans le CV (facultatif).</summary>
    [BsonElement("phone")]
    [BsonIgnoreIfNull]
    public string? Phone { get; set; }

    [BsonElement("linkedin")]
    [BsonIgnoreIfNull]
    public string? LinkedIn { get; set; }

    [BsonElement("github")]
    [BsonIgnoreIfNull]
    public string? GitHub { get; set; }

    [BsonElement("website")]
    [BsonIgnoreIfNull]
    public string? Website { get; set; }

    [BsonElement("bio")]
    public string Bio { get; set; } = string.Empty;

    [BsonElement("avatar")]
    public string Avatar { get; set; } = string.Empty;

    [BsonElement("skills")]
    public List<string> Skills { get; set; } = [];

    [BsonElement("hourlyRate")]
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal HourlyRate { get; set; }

    /// <summary>Expériences professionnelles affichées dans le CV du profil.</summary>
    [BsonElement("experiences")]
    public List<CvExperience> Experiences { get; set; } = [];

    /// <summary>Formations et certifications.</summary>
    [BsonElement("education")]
    public List<CvEducation> Education { get; set; } = [];

    /// <summary>Certifications professionnelles distinctes des formations.</summary>
    [BsonElement("certifications")]
    public List<CvCertification> Certifications { get; set; } = [];

    /// <summary>Langues parlées.</summary>
    [BsonElement("languages")]
    public List<CvLanguage> Languages { get; set; } = [];

    /// <summary>Préférences de mission (types de projets, télétravail).</summary>
    [BsonElement("workPreferences")]
    public CvWorkPreferences WorkPreferences { get; set; } = new();

    // --- Profil client (entreprise, localisation, présentation) -------------
    // Ces champs étendent le compte existant : aucun profil parallèle n'est créé.
    // Les comptes freelance existants conservent des valeurs vides, sans impact.

    [BsonElement("companyName")]
    public string CompanyName { get; set; } = string.Empty;

    [BsonElement("companyLogo")]
    public string CompanyLogo { get; set; } = string.Empty;

    [BsonElement("coverImage")]
    public string CoverImage { get; set; } = string.Empty;

    [BsonElement("industry")]
    public string Industry { get; set; } = string.Empty;

    [BsonElement("position")]
    public string Position { get; set; } = string.Empty;

    [BsonElement("companyWebsite")]
    public string CompanyWebsite { get; set; } = string.Empty;

    [BsonElement("companySize")]
    public string CompanySize { get; set; } = string.Empty;

    [BsonElement("companyDescription")]
    public string CompanyDescription { get; set; } = string.Empty;

    [BsonElement("country")]
    public string Country { get; set; } = string.Empty;

    [BsonElement("governorate")]
    public string Governorate { get; set; } = string.Empty;

    [BsonElement("city")]
    public string City { get; set; } = string.Empty;

    [BsonElement("businessAddress")]
    public string BusinessAddress { get; set; } = string.Empty;

    /// <summary>Présentation personnelle libre (distincte de la description entreprise).</summary>
    [BsonElement("personalPresentation")]
    public string PersonalPresentation { get; set; } = string.Empty;

    /// <summary>Coordonnées professionnelles affichées (facultatives).</summary>
    [BsonElement("professionalEmail")]
    public string ProfessionalEmail { get; set; } = string.Empty;

    [BsonElement("professionalPhone")]
    public string ProfessionalPhone { get; set; } = string.Empty;

    // --- Personnalisation de l'avatar ---------------------------------------
    // "initials" (initiales + couleur), "preset" (galerie locale) ou "upload".
    // La valeur "ai" est réservée à un futur fournisseur réel : aucun service
    // d'IA n'est simulé aujourd'hui.
    [BsonElement("avatarSource")]
    public string AvatarSource { get; set; } = "initials";

    /// <summary>Identifiant d'un preset local (ex. "gradient-violet").</summary>
    [BsonElement("avatarPreset")]
    public string AvatarPreset { get; set; } = string.Empty;

    /// <summary>Couleur d'accent choisie pour les initiales (hexadécimal).</summary>
    [BsonElement("avatarColor")]
    public string AvatarColor { get; set; } = string.Empty;

    /// <summary>Configuration JSON de l'avatar généré (style DiceBear + options).</summary>
    [BsonElement("avatarConfig")]
    [BsonIgnoreIfNull]
    public string? AvatarConfig { get; set; }

    /// <summary>
    /// Adresse MetaMask liée au compte lors du premier paiement blockchain vérifié.
    /// Utilisée pour refuser un transfert provenant d'un autre portefeuille.
    /// </summary>
    [BsonElement("walletAddress")]
    [BsonIgnoreIfNull]
    public string? WalletAddress { get; set; }

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [BsonElement("updatedAt")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Poste occupé par le freelance (section Experience du CV).</summary>
public class CvExperience
{
    [BsonElement("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [BsonElement("role")]
    public string Role { get; set; } = string.Empty;

    [BsonElement("company")]
    public string Company { get; set; } = string.Empty;

    [BsonElement("location")]
    public string Location { get; set; } = string.Empty;

    /// <summary>Période sous forme libre (ex. « 2021 — 2023 »). Conservée pour les données existantes.</summary>
    [BsonElement("period")]
    public string Period { get; set; } = string.Empty;

    /// <summary>Date de début normalisée « AAAA-MM » (facultative).</summary>
    [BsonElement("startDate")]
    public string StartDate { get; set; } = string.Empty;

    /// <summary>Date de fin normalisée « AAAA-MM ». Ignorée si <see cref="IsCurrent"/> est vrai.</summary>
    [BsonElement("endDate")]
    public string EndDate { get; set; } = string.Empty;

    [BsonElement("isCurrent")]
    public bool IsCurrent { get; set; }

    [BsonElement("technologies")]
    public List<string> Technologies { get; set; } = [];

    [BsonElement("description")]
    public string Description { get; set; } = string.Empty;
}

/// <summary>Formation ou certification (section Education du CV).</summary>
public class CvEducation
{
    [BsonElement("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [BsonElement("degree")]
    public string Degree { get; set; } = string.Empty;

    [BsonElement("institution")]
    public string Institution { get; set; } = string.Empty;

    [BsonElement("specialty")]
    public string Specialty { get; set; } = string.Empty;

    [BsonElement("location")]
    public string Location { get; set; } = string.Empty;

    [BsonElement("period")]
    public string Period { get; set; } = string.Empty;

    [BsonElement("startDate")]
    public string StartDate { get; set; } = string.Empty;

    [BsonElement("endDate")]
    public string EndDate { get; set; } = string.Empty;

    [BsonElement("description")]
    public string Description { get; set; } = string.Empty;
}

/// <summary>Certification professionnelle (distincte d'un diplôme).</summary>
public class CvCertification
{
    [BsonElement("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [BsonElement("name")]
    public string Name { get; set; } = string.Empty;

    [BsonElement("issuer")]
    public string Issuer { get; set; } = string.Empty;

    /// <summary>Année ou période libre (ex. « 2023 »).</summary>
    [BsonElement("year")]
    public string Year { get; set; } = string.Empty;
}

/// <summary>Langue parlée et niveau de maîtrise.</summary>
public class CvLanguage
{
    [BsonElement("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [BsonElement("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>Niveau : "Basic", "Intermediate", "Advanced", "Native".</summary>
    [BsonElement("level")]
    public string Level { get; set; } = string.Empty;
}

/// <summary>Préférences de travail affichées dans le CV.</summary>
public class CvWorkPreferences
{
    [BsonElement("projectTypes")]
    public List<string> ProjectTypes { get; set; } = [];

    /// <summary>Modalité : "Remote only", "Remote and on-site" ou vide.</summary>
    [BsonElement("workPreference")]
    public string WorkPreference { get; set; } = string.Empty;

    /// <summary>Budget minimum indicatif sous forme libre (ex. « 2,500 TND+ »).</summary>
    [BsonElement("minimumBudget")]
    public string MinimumBudget { get; set; } = string.Empty;
}
