using FluentValidation;
using FreelanceTn.Api.Dtos.Account;
using FreelanceTn.Api.Models;

namespace FreelanceTn.Api.Validators;

public class UpdateClientProfileRequestValidator : AbstractValidator<UpdateClientProfileRequest>
{
    public UpdateClientProfileRequestValidator()
    {
        RuleFor(x => x.FirstName).MaximumLength(80);
        RuleFor(x => x.LastName).MaximumLength(80);
        RuleFor(x => x.Phone).MaximumLength(40);
        RuleFor(x => x.CompanyName).MaximumLength(160);
        RuleFor(x => x.CompanyLogo).MaximumLength(500);
        RuleFor(x => x.CoverImage).MaximumLength(500);
        RuleFor(x => x.Industry).MaximumLength(120);
        RuleFor(x => x.Position).MaximumLength(120);
        RuleFor(x => x.CompanyWebsite).MaximumLength(500)
            .Must(BeAValidUrl).WithMessage("Le site web de l'entreprise n'est pas une URL valide.");
        RuleFor(x => x.CompanySize).MaximumLength(60);
        RuleFor(x => x.CompanyDescription).MaximumLength(2000);
        RuleFor(x => x.Country).MaximumLength(120);
        RuleFor(x => x.Governorate).MaximumLength(120);
        RuleFor(x => x.City).MaximumLength(120);
        RuleFor(x => x.BusinessAddress).MaximumLength(300);
        RuleFor(x => x.PersonalPresentation).MaximumLength(2000);
        RuleFor(x => x.ProfessionalEmail)
            .MaximumLength(254)
            .EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.ProfessionalEmail))
            .WithMessage("L'e-mail professionnel n'est pas valide.");
        RuleFor(x => x.ProfessionalPhone).MaximumLength(40);
        RuleFor(x => x.Website).MaximumLength(500)
            .Must(BeAValidUrl).WithMessage("Le site web personnel n'est pas une URL valide.");
        RuleFor(x => x.AvatarSource)
            .Must(v => v is null || new[] { "initials", "preset", "upload", "generated" }.Contains(v.Trim().ToLowerInvariant()))
            .WithMessage("Source d'avatar invalide.");
        RuleFor(x => x.AvatarPreset).MaximumLength(60);
        RuleFor(x => x.AvatarColor)
            .Must(v => string.IsNullOrWhiteSpace(v) ||
                       (v.Trim().Length == 7 && v.Trim()[0] == '#' && v.Trim()[1..].All(Uri.IsHexDigit)))
            .WithMessage("La couleur doit être au format hexadécimal #RRGGBB.");
    }

    private static bool BeAValidUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        return Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }
}

public class AvatarStyleRequestValidator : AbstractValidator<AvatarStyleRequest>
{
    public AvatarStyleRequestValidator()
    {
        RuleFor(x => x.Source)
            .Must(v => v is null || new[] { "initials", "preset", "upload", "generated" }.Contains(v.Trim().ToLowerInvariant()))
            .WithMessage("Source d'avatar invalide.");
        RuleFor(x => x.Preset).MaximumLength(60);
        RuleFor(x => x.Color)
            .Must(v => string.IsNullOrWhiteSpace(v) ||
                       (v.Trim().Length == 7 && v.Trim()[0] == '#' && v.Trim()[1..].All(Uri.IsHexDigit)))
            .WithMessage("La couleur doit être au format hexadécimal #RRGGBB.");
    }
}

public class TeamInviteRequestValidator : AbstractValidator<TeamInviteRequest>
{
    public TeamInviteRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("L'e-mail est obligatoire.")
            .EmailAddress().WithMessage("L'e-mail n'est pas valide.")
            .MaximumLength(254);
        RuleFor(x => x.Name).MaximumLength(120);
        RuleFor(x => x.Role)
            .NotEmpty().WithMessage("Le rôle est obligatoire.")
            .Must(TeamMember.Roles.IsInvitable)
            .WithMessage("Le rôle doit être Admin, Manager, Member ou Viewer.");
    }
}

public class TeamRoleRequestValidator : AbstractValidator<TeamRoleRequest>
{
    public TeamRoleRequestValidator()
    {
        RuleFor(x => x.Role)
            .NotEmpty()
            .Must(TeamMember.Roles.IsInvitable)
            .WithMessage("Le rôle doit être Admin, Manager, Member ou Viewer.");
    }
}

public class TeamInvitationTokenRequestValidator : AbstractValidator<TeamInvitationTokenRequest>
{
    public TeamInvitationTokenRequestValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(500);
    }
}

public class UpdateBillingRequestValidator : AbstractValidator<UpdateBillingRequest>
{
    public UpdateBillingRequestValidator()
    {
        RuleFor(x => x.LegalName).MaximumLength(200);
        RuleFor(x => x.BillingAddress).MaximumLength(300);
        RuleFor(x => x.Country).MaximumLength(120);
        RuleFor(x => x.Governorate).MaximumLength(120);
        RuleFor(x => x.City).MaximumLength(120);
        RuleFor(x => x.TaxId).MaximumLength(60);
        RuleFor(x => x.ContactName).MaximumLength(160);
        RuleFor(x => x.ContactEmail)
            .MaximumLength(254)
            .EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.ContactEmail))
            .WithMessage("L'e-mail de contact n'est pas valide.");
        RuleFor(x => x.ContactPhone).MaximumLength(40);
    }
}

public class ChangePasswordRequestValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordRequestValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty().WithMessage("Le mot de passe actuel est obligatoire.");
        RuleFor(x => x.NewPassword)
            .NotEmpty().WithMessage("Le nouveau mot de passe est obligatoire.")
            .MinimumLength(8).WithMessage("Le nouveau mot de passe doit contenir au moins 8 caractères.")
            .MaximumLength(128)
            .NotEqual(x => x.CurrentPassword).WithMessage("Le nouveau mot de passe doit être différent de l'ancien.");
    }
}

public class UserPreferencesDtoValidator : AbstractValidator<UserPreferencesDto>
{
    public UserPreferencesDtoValidator()
    {
        RuleFor(x => x.Language)
            .Must(UserPreference.Languages.IsValid)
            .WithMessage("La langue doit être 'fr' ou 'en'.");
        RuleFor(x => x.Theme)
            .Must(UserPreference.Themes.IsValid)
            .WithMessage("Le thème doit être 'light' ou 'dark'.");
        RuleFor(x => x.Currency)
            .Must(v => string.Equals(v?.Trim(), "TND", StringComparison.OrdinalIgnoreCase))
            .WithMessage("La devise par défaut de la plateforme est TND.");
        RuleFor(x => x.Timezone).NotEmpty().MaximumLength(80);
        RuleFor(x => x.DateFormat)
            .Must(v => v is "DD/MM/YYYY" or "YYYY-MM-DD")
            .WithMessage("Le format de date doit être DD/MM/YYYY ou YYYY-MM-DD.");
    }
}
