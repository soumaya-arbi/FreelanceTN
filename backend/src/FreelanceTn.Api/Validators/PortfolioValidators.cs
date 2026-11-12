using FluentValidation;
using FreelanceTn.Api.Dtos.Portfolio;
using FreelanceTn.Api.Models;

namespace FreelanceTn.Api.Validators;

internal static class PortfolioUrlValidation
{
    /// <summary>Une URL absente est autorisée ; une valeur fournie doit être http(s).</summary>
    public static bool IsValidHttpUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;

        return Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }
}

/// <summary>Validation de la création d'une réalisation.</summary>
public class CreatePortfolioItemRequestValidator : AbstractValidator<CreatePortfolioItemRequest>
{
    public CreatePortfolioItemRequestValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty().WithMessage("Le titre est obligatoire.")
            .MinimumLength(5).WithMessage("Le titre doit contenir au moins 5 caractères.")
            .MaximumLength(160);

        RuleFor(x => x.Summary)
            .NotEmpty().WithMessage("Le résumé est obligatoire.")
            .MinimumLength(10).WithMessage("Le résumé doit contenir au moins 10 caractères.")
            .MaximumLength(1000);

        RuleFor(x => x.Category)
            .NotEmpty().WithMessage("La catégorie est obligatoire.")
            .MaximumLength(120);

        RuleFor(x => x.Role).MaximumLength(120);
        RuleFor(x => x.Duration).MaximumLength(60);
        RuleFor(x => x.Challenge).MaximumLength(2000);
        RuleFor(x => x.Solution).MaximumLength(2000);
        RuleFor(x => x.Outcome).MaximumLength(2000);

        RuleFor(x => x.Skills)
            .Must(skills => skills is null || skills.Count <= 20)
            .WithMessage("20 compétences maximum.");

        RuleForEach(x => x.Skills)
            .MaximumLength(40)
            .Must(skill => !string.IsNullOrWhiteSpace(skill))
            .WithMessage("Une compétence ne peut pas être vide.")
            .When(x => x.Skills is not null);

        RuleFor(x => x.Link)
            .MaximumLength(2048)
            .Must(PortfolioUrlValidation.IsValidHttpUrl)
            .WithMessage("L'URL du projet doit être une URL http(s) valide.");

        RuleFor(x => x.Image)
            .MaximumLength(2048)
            .Must(PortfolioUrlValidation.IsValidHttpUrl)
            .WithMessage("L'URL de l'image doit être une URL http(s) valide.");

        RuleFor(x => x.Visibility)
            .Must(visibility => string.IsNullOrWhiteSpace(visibility) || PortfolioVisibility.IsValid(visibility))
            .WithMessage("La visibilité est invalide.");
    }
}

/// <summary>Validation de la modification d'une réalisation.</summary>
public class UpdatePortfolioItemRequestValidator : AbstractValidator<UpdatePortfolioItemRequest>
{
    public UpdatePortfolioItemRequestValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty().WithMessage("Le titre est obligatoire.")
            .MinimumLength(5).WithMessage("Le titre doit contenir au moins 5 caractères.")
            .MaximumLength(160)
            .When(x => x.Title is not null);

        RuleFor(x => x.Summary)
            .NotEmpty().WithMessage("Le résumé est obligatoire.")
            .MinimumLength(10).WithMessage("Le résumé doit contenir au moins 10 caractères.")
            .MaximumLength(1000)
            .When(x => x.Summary is not null);

        RuleFor(x => x.Category)
            .NotEmpty().WithMessage("La catégorie est obligatoire.")
            .MaximumLength(120)
            .When(x => x.Category is not null);

        RuleFor(x => x.Role).MaximumLength(120).When(x => x.Role is not null);
        RuleFor(x => x.Duration).MaximumLength(60).When(x => x.Duration is not null);
        RuleFor(x => x.Challenge).MaximumLength(2000).When(x => x.Challenge is not null);
        RuleFor(x => x.Solution).MaximumLength(2000).When(x => x.Solution is not null);
        RuleFor(x => x.Outcome).MaximumLength(2000).When(x => x.Outcome is not null);

        RuleFor(x => x.Skills)
            .Must(skills => skills is null || skills.Count <= 20)
            .WithMessage("20 compétences maximum.")
            .When(x => x.Skills is not null);

        RuleForEach(x => x.Skills)
            .MaximumLength(40)
            .Must(skill => !string.IsNullOrWhiteSpace(skill))
            .WithMessage("Une compétence ne peut pas être vide.")
            .When(x => x.Skills is not null);

        RuleFor(x => x.Link)
            .MaximumLength(2048)
            .Must(PortfolioUrlValidation.IsValidHttpUrl)
            .WithMessage("L'URL du projet doit être une URL http(s) valide.")
            .When(x => x.Link is not null);

        RuleFor(x => x.Image)
            .MaximumLength(2048)
            .Must(PortfolioUrlValidation.IsValidHttpUrl)
            .WithMessage("L'URL de l'image doit être une URL http(s) valide.")
            .When(x => x.Image is not null);

        RuleFor(x => x.Visibility)
            .Must(visibility => visibility is null || PortfolioVisibility.IsValid(visibility))
            .WithMessage("La visibilité est invalide.")
            .When(x => x.Visibility is not null);
    }
}
