using System.Text.Json.Serialization;

namespace FreelanceTn.Api.Dtos.Account;

// ---------------------------------------------------------------- Profil client

public class ClientProfileResponse
{
    public string Id { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public bool EmailVerified { get; set; }
    public bool HasPassword { get; set; }
    public string Role { get; set; } = string.Empty;

    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Avatar { get; set; } = string.Empty;
    public string AvatarSource { get; set; } = "initials";
    public string AvatarPreset { get; set; } = string.Empty;
    public string AvatarColor { get; set; } = string.Empty;
    public string? AvatarConfig { get; set; }

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
    public string Website { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;

    /// <summary>Complétion du profil (0-100), calculée côté serveur.</summary>
    public int ProfileCompletion { get; set; }

    /// <summary>Champs encore manquants pour un profil professionnel complet.</summary>
    public List<string> MissingFields { get; set; } = [];

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class UpdateClientProfileRequest
{
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? Phone { get; set; }
    public string? AvatarSource { get; set; }
    public string? AvatarPreset { get; set; }
    public string? AvatarColor { get; set; }
    public string? AvatarConfig { get; set; }

    public string? CompanyName { get; set; }
    public string? CompanyLogo { get; set; }
    public string? CoverImage { get; set; }
    public string? Industry { get; set; }
    public string? Position { get; set; }
    public string? CompanyWebsite { get; set; }
    public string? CompanySize { get; set; }
    public string? CompanyDescription { get; set; }

    public string? Country { get; set; }
    public string? Governorate { get; set; }
    public string? City { get; set; }
    public string? BusinessAddress { get; set; }

    public string? PersonalPresentation { get; set; }
    public string? ProfessionalEmail { get; set; }
    public string? ProfessionalPhone { get; set; }
    public string? Website { get; set; }
}

public class AvatarStyleRequest
{
    /// <summary>"initials", "preset" ou "upload".</summary>
    public string? Source { get; set; }
    public string? Preset { get; set; }
    public string? Color { get; set; }
    public string? Config { get; set; }
}

// ---------------------------------------------------------------- Équipe

public class TeamInviteRequest
{
    public string Email { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
}

public class TeamRoleRequest
{
    public string Role { get; set; } = string.Empty;
}

public class TeamInvitationTokenRequest
{
    public string Token { get; set; } = string.Empty;
}

public class TwoFactorCodeRequest
{
    public string Code { get; set; } = string.Empty;
}

public class TwoFactorPasswordRequest
{
    public string Password { get; set; } = string.Empty;
}

public class TeamActivateRequest
{
    public string Token { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class TeamMemberResponse
{
    public string Id { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public bool IsOwner { get; set; }
    public bool CanManage { get; set; }
    public DateTime InvitedAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

public class TeamInviteResponse
{
    public TeamMemberResponse Member { get; set; } = new();
    public bool Sent { get; set; }
    public string Transport { get; set; } = "none";
    public string Message { get; set; } = string.Empty;
    public string? DevInviteUrl { get; set; }
    public int? CooldownSeconds { get; set; }
}

// ---------------------------------------------------------------- Facturation

public class BillingHistoryEntryResponse
{
    public DateTime ChangedAt { get; set; }
    public List<string> Fields { get; set; } = [];
}

public class BillingProfileResponse
{
    public string LegalName { get; set; } = string.Empty;
    public string BillingAddress { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;
    public string Governorate { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string TaxId { get; set; } = string.Empty;
    public string ContactName { get; set; } = string.Empty;
    public string ContactEmail { get; set; } = string.Empty;
    public string ContactPhone { get; set; } = string.Empty;
    public List<BillingHistoryEntryResponse> History { get; set; } = [];
    public DateTime? UpdatedAt { get; set; }
}

public class UpdateBillingRequest
{
    public string? LegalName { get; set; }
    public string? BillingAddress { get; set; }
    public string? Country { get; set; }
    public string? Governorate { get; set; }
    public string? City { get; set; }
    public string? TaxId { get; set; }
    public string? ContactName { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
}

// ---------------------------------------------------------------- Sécurité

public class ChangePasswordRequest
{
    public string CurrentPassword { get; set; } = string.Empty;
    public string NewPassword { get; set; } = string.Empty;
}

public class SessionResponse
{
    public string Id { get; set; } = string.Empty;
    public bool Current { get; set; }
    public bool RememberMe { get; set; }
    public string UserAgent { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public DateTime ExpiresAt { get; set; }
}

public class SecurityOverviewResponse
{
    public string Email { get; set; } = string.Empty;
    public bool EmailVerified { get; set; }
    public bool HasPassword { get; set; }

    /// <summary>2FA n'est pas encore branché à un fournisseur : jamais annoncé actif.</summary>
    public bool TwoFactorEnabled { get; set; }
    public DateTime? TwoFactorEnabledAt { get; set; }
    public int RecoveryCodesRemaining { get; set; }
    public bool TwoFactorAvailable { get; set; } = true;
    public string TwoFactorMessage { get; set; } =
        "La double authentification sera disponible lorsqu'un fournisseur TOTP sera configuré.";

    public List<SessionResponse> Sessions { get; set; } = [];
}

// ---------------------------------------------------------------- Notifications

public class NotificationPreferencesDto
{
    public bool EmailEnabled { get; set; } = true;
    public bool InAppEnabled { get; set; } = true;
    public bool InvitationsEnabled { get; set; } = true;
    public bool ProjectActivityEnabled { get; set; } = true;
    public bool MessagesEnabled { get; set; } = true;
    public bool BillingEnabled { get; set; } = true;
}

// ---------------------------------------------------------------- Préférences

public class UserPreferencesDto
{
    public string Language { get; set; } = "fr";
    public string Currency { get; set; } = "TND";
    public string Theme { get; set; } = "light";
    public string Timezone { get; set; } = "Africa/Tunis";
    public string DateFormat { get; set; } = "DD/MM/YYYY";
    public bool ThousandsSeparator { get; set; } = true;
}

// ---------------------------------------------------------------- Historique

public class AccountChangeResponse
{
    public string Area { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

// ---------------------------------------------------------------- Profil public

public class PublicClientProfileResponse
{
    public string DisplayName { get; set; } = string.Empty;
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
    public string PersonalPresentation { get; set; } = string.Empty;
    public string Avatar { get; set; } = string.Empty;
    public string AvatarSource { get; set; } = "initials";
    public string? AvatarConfig { get; set; }
    public bool Verified { get; set; }
    public DateTime CreatedAt { get; set; }
}

// ---------------------------------------------------------------- Export / suppression

public class AccountExportResponse
{
    public string GeneratedAt { get; set; } = string.Empty;
    public ClientProfileResponse Profile { get; set; } = new();
    public BillingProfileResponse Billing { get; set; } = new();
    public UserPreferencesDto Preferences { get; set; } = new();
    public NotificationPreferencesDto Notifications { get; set; } = new();
    public List<TeamMemberResponse> Team { get; set; } = [];
}

public class DeleteAccountRequest
{
    /// <summary>L'utilisateur doit retaper son adresse e-mail pour confirmer.</summary>
    public string EmailConfirmation { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}
