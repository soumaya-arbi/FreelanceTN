using FluentValidation;
using FreelanceTn.Api.Dtos.Auth;
using FreelanceTn.Api.Models;
using FreelanceTn.Api.Services;

namespace FreelanceTn.Api.Validators;

public class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("L'email est obligatoire.")
            .EmailAddress().WithMessage("L'email n'est pas valide.")
            .MaximumLength(254);

        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("Le mot de passe est obligatoire.")
            .MinimumLength(8).WithMessage("Le mot de passe doit contenir au moins 8 caractères.")
            .MaximumLength(128);

        RuleFor(x => x.FirstName)
            .NotEmpty().WithMessage("Le prénom est obligatoire.")
            .MaximumLength(80);

        RuleFor(x => x.LastName)
            .NotEmpty().WithMessage("Le nom est obligatoire.")
            .MaximumLength(80);

        // Le rôle est choisi à l'inscription : seules les deux valeurs gérées sont acceptées.
        RuleFor(x => x.Role)
            .NotEmpty().WithMessage("Le rôle est obligatoire (freelancer ou client).")
            .Must(role => UserRole.IsValid(role))
            .WithMessage("Le rôle doit être 'freelancer' ou 'client'.");

        RuleFor(x => x.Title).MaximumLength(160);
        RuleFor(x => x.Location).MaximumLength(160);
        RuleFor(x => x.Bio).MaximumLength(2000);
        RuleFor(x => x.Skills).Must(s => s.Count <= 60).WithMessage("Trop de compétences (60 maximum).");
        RuleForEach(x => x.Skills).MaximumLength(60);
        RuleFor(x => x.HourlyRate).GreaterThanOrEqualTo(0);
    }
}

public class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.Password).NotEmpty();
    }
}

public class UpdateProfileRequestValidator : AbstractValidator<UpdateProfileRequest>
{
    public UpdateProfileRequestValidator()
    {
        RuleFor(x => x.FirstName).MaximumLength(80);
        RuleFor(x => x.LastName).MaximumLength(80);
        RuleFor(x => x.Title).MaximumLength(160);
        RuleFor(x => x.Location).MaximumLength(160);
        RuleFor(x => x.Phone).MaximumLength(40);
        RuleFor(x => x.LinkedIn).MaximumLength(500);
        RuleFor(x => x.GitHub).MaximumLength(500);
        RuleFor(x => x.Website).MaximumLength(500);
        RuleFor(x => x.Bio).MaximumLength(2000);
        RuleFor(x => x.Avatar).MaximumLength(500);
        RuleFor(x => x.Skills).Must(s => s is null || s.Count <= 60).WithMessage("Trop de compétences (60 maximum).");
        RuleForEach(x => x.Skills).MaximumLength(60);
        RuleFor(x => x.HourlyRate).GreaterThanOrEqualTo(0).When(x => x.HourlyRate.HasValue);

        // Données CV : listes remplacées intégralement quand fournies.
        RuleFor(x => x.Experiences).Must(v => v is null || v.Count <= 30)
            .WithMessage("Trop d'expériences (30 maximum).");
        RuleForEach(x => x.Experiences).SetValidator(new CvExperienceDtoValidator());

        RuleFor(x => x.Education).Must(v => v is null || v.Count <= 30)
            .WithMessage("Trop de formations (30 maximum).");
        RuleForEach(x => x.Education).SetValidator(new CvEducationDtoValidator());

        RuleFor(x => x.Languages).Must(v => v is null || v.Count <= 20)
            .WithMessage("Trop de langues (20 maximum).");
        RuleForEach(x => x.Languages).SetValidator(new CvLanguageDtoValidator());

        RuleFor(x => x.Certifications).Must(v => v is null || v.Count <= 30)
            .WithMessage("Trop de certifications (30 maximum).");
        RuleForEach(x => x.Certifications).SetValidator(new CvCertificationDtoValidator());

        RuleFor(x => x.WorkPreferences).SetValidator(new CvWorkPreferencesDtoValidator()!).When(x => x.WorkPreferences is not null);
    }
}

public class CvExperienceDtoValidator : AbstractValidator<CvExperienceDto>
{
    public CvExperienceDtoValidator()
    {
        RuleFor(x => x.Role).MaximumLength(120);
        RuleFor(x => x.Company).MaximumLength(120);
        RuleFor(x => x.Location).MaximumLength(160);
        RuleFor(x => x.Period).MaximumLength(60);
        RuleFor(x => x.StartDate).MaximumLength(20);
        RuleFor(x => x.EndDate).MaximumLength(20);
        RuleFor(x => x.Technologies).Must(v => v is null || v.Count <= 20)
            .WithMessage("Trop de technologies (20 maximum).");
        RuleForEach(x => x.Technologies).MaximumLength(40);
        RuleFor(x => x.Description).MaximumLength(1000);
    }
}

public class CvEducationDtoValidator : AbstractValidator<CvEducationDto>
{
    public CvEducationDtoValidator()
    {
        RuleFor(x => x.Degree).MaximumLength(120);
        RuleFor(x => x.Institution).MaximumLength(120);
        RuleFor(x => x.Specialty).MaximumLength(160);
        RuleFor(x => x.Location).MaximumLength(160);
        RuleFor(x => x.Period).MaximumLength(60);
        RuleFor(x => x.StartDate).MaximumLength(20);
        RuleFor(x => x.EndDate).MaximumLength(20);
        RuleFor(x => x.Description).MaximumLength(1000);
    }
}

public class CvCertificationDtoValidator : AbstractValidator<CvCertificationDto>
{
    public CvCertificationDtoValidator()
    {
        RuleFor(x => x.Name).MaximumLength(160);
        RuleFor(x => x.Issuer).MaximumLength(160);
        RuleFor(x => x.Year).MaximumLength(20);
    }
}

public class CvLanguageDtoValidator : AbstractValidator<CvLanguageDto>
{
    private static readonly string[] Levels = ["Basic", "Intermediate", "Advanced", "Native"];

    public CvLanguageDtoValidator()
    {
        RuleFor(x => x.Name).MaximumLength(60);
        RuleFor(x => x.Level)
            .Must(IsAllowedLanguageLevel)
            .WithMessage("Le niveau de langue doit être Basic, Intermediate, Advanced ou Native.");
    }

    private static bool IsAllowedLanguageLevel(string? level)
    {
        if (string.IsNullOrWhiteSpace(level)) return true;
        var canonical = AuthService.CanonicalizeLanguageLevel(level);
        return Levels.Contains(canonical);
    }
}

public class CvWorkPreferencesDtoValidator : AbstractValidator<CvWorkPreferencesDto>
{
    public CvWorkPreferencesDtoValidator()
    {
        RuleFor(x => x.ProjectTypes).Must(v => v.Count <= 10).WithMessage("Trop de types de projets (10 maximum).");
        RuleForEach(x => x.ProjectTypes).MaximumLength(80);
        RuleFor(x => x.WorkPreference).MaximumLength(60);
        RuleFor(x => x.MinimumBudget).MaximumLength(60);
    }
}

public class VerifyEmailRequestValidator : AbstractValidator<VerifyEmailRequest>
{
    public VerifyEmailRequestValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(500);
    }
}

public class ResendVerificationRequestValidator : AbstractValidator<ResendVerificationRequest>
{
    public ResendVerificationRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("L'email est obligatoire.")
            .EmailAddress().WithMessage("L'email n'est pas valide.")
            .MaximumLength(254);
    }
}

public class ForgotPasswordRequestValidator : AbstractValidator<ForgotPasswordRequest>
{
    public ForgotPasswordRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("L'email est obligatoire.")
            .EmailAddress().WithMessage("L'email n'est pas valide.")
            .MaximumLength(254);
    }
}

public class ResetPasswordRequestValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(500);
        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("Le mot de passe est obligatoire.")
            .MinimumLength(8).WithMessage("Le mot de passe doit contenir au moins 8 caracteres.")
            .MaximumLength(128);
    }
}
