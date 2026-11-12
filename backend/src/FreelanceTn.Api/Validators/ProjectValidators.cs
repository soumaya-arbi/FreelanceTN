using FluentValidation;
using FreelanceTn.Api.Dtos.Projects;
using FreelanceTn.Api.Models;

namespace FreelanceTn.Api.Validators;

public class CreateProjectRequestValidator : AbstractValidator<CreateProjectRequest>
{
    public CreateProjectRequestValidator()
    {
        // Un brouillon est par nature incomplet : seuls les brouillons published
        // (statut "Open") doivent fournir un brief complet.
        var isDraft = (CreateProjectRequest request) =>
            string.Equals(request.Status?.Trim(), ProjectStatus.Draft, StringComparison.OrdinalIgnoreCase);

        RuleFor(x => x.Title)
            .NotEmpty().WithMessage("Le titre est obligatoire.")
            .When(x => !isDraft(x))
            .MaximumLength(200);

        RuleFor(x => x.Description)
            .NotEmpty().WithMessage("La description est obligatoire.")
            .When(x => !isDraft(x))
            .MaximumLength(5000);

        RuleFor(x => x.Budget)
            .NotEmpty().WithMessage("Le budget est obligatoire.")
            .When(x => !isDraft(x) && !x.BudgetMin.HasValue && !x.BudgetMax.HasValue)
            .MaximumLength(100);

        RuleFor(x => x.Type)
            .NotEmpty().WithMessage("Le type de contrat est obligatoire.")
            .When(x => !isDraft(x))
            .MaximumLength(60);

        RuleFor(x => x.Client)
            .NotEmpty().WithMessage("Le client est obligatoire.")
            .When(x => !isDraft(x))
            .MaximumLength(160);

        RuleFor(x => x.Category).MaximumLength(120);
        RuleFor(x => x.Deadline).MaximumLength(40);

        RuleFor(x => x.BudgetMin)
            .GreaterThan(0).When(x => x.BudgetMin.HasValue)
            .WithMessage("Le budget minimum doit être positif.");
        RuleFor(x => x.BudgetMax)
            .GreaterThan(0).When(x => x.BudgetMax.HasValue)
            .WithMessage("Le budget maximum doit être positif.");
        RuleFor(x => x)
            .Must(x => !x.BudgetMin.HasValue || !x.BudgetMax.HasValue || x.BudgetMin <= x.BudgetMax)
            .WithMessage("Le budget minimum ne peut pas dépasser le budget maximum.")
            .When(x => x.BudgetMin.HasValue || x.BudgetMax.HasValue);
        RuleFor(x => x.DurationValue)
            .GreaterThan(0).When(x => x.DurationValue.HasValue)
            .WithMessage("La durée doit être positive.");
        RuleFor(x => x.DurationUnit)
            .Must(u => string.IsNullOrWhiteSpace(u) || u == "Days" || u == "Weeks" || u == "Months")
            .WithMessage("L'unité de durée doit être Days, Weeks ou Months.");

        RuleFor(x => x.Skills)
            .Must(s => s.Count <= 50).WithMessage("Trop de compétences (50 maximum).");
        RuleForEach(x => x.Skills).MaximumLength(60);

        RuleFor(x => x.Status)
            .Must(status => string.IsNullOrEmpty(status) || ProjectStatus.IsValid(status))
            .WithMessage("Le statut est invalide.");
    }
}

public class UpdateProjectRequestValidator : AbstractValidator<UpdateProjectRequest>
{
    public UpdateProjectRequestValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty().WithMessage("Le titre est obligatoire.")
            .MaximumLength(200).When(x => x.Title is not null);

        RuleFor(x => x.Description)
            .NotEmpty().WithMessage("La description est obligatoire.")
            .MaximumLength(5000).When(x => x.Description is not null);

        RuleFor(x => x.Budget).MaximumLength(100).When(x => x.Budget is not null);
        RuleFor(x => x.Type).MaximumLength(60).When(x => x.Type is not null);
        RuleFor(x => x.Client).MaximumLength(160).When(x => x.Client is not null);
        RuleFor(x => x.Category).MaximumLength(120).When(x => x.Category is not null);
        RuleFor(x => x.Deadline).MaximumLength(40).When(x => x.Deadline is not null);

        RuleFor(x => x.BudgetMin)
            .GreaterThan(0).When(x => x.BudgetMin.HasValue)
            .WithMessage("Le budget minimum doit être positif.");
        RuleFor(x => x.BudgetMax)
            .GreaterThan(0).When(x => x.BudgetMax.HasValue)
            .WithMessage("Le budget maximum doit être positif.");
        RuleFor(x => x)
            .Must(x => !x.BudgetMin.HasValue || !x.BudgetMax.HasValue || x.BudgetMin <= x.BudgetMax)
            .WithMessage("Le budget minimum ne peut pas dépasser le budget maximum.")
            .When(x => x.BudgetMin.HasValue || x.BudgetMax.HasValue);
        RuleFor(x => x.DurationValue)
            .GreaterThan(0).When(x => x.DurationValue.HasValue)
            .WithMessage("La durée doit être positive.");
        RuleFor(x => x.DurationUnit)
            .Must(u => u is null || string.IsNullOrWhiteSpace(u) || u == "Days" || u == "Weeks" || u == "Months")
            .WithMessage("L'unité de durée doit être Days, Weeks ou Months.")
            .When(x => x.DurationUnit is not null);

        RuleFor(x => x.Skills)
            .Must(s => s is null || s.Count <= 50).WithMessage("Trop de compétences (50 maximum).");
        RuleForEach(x => x.Skills).MaximumLength(60).When(x => x.Skills is not null);

        RuleFor(x => x.AssignedTo)
            .MaximumLength(64).When(x => x.AssignedTo is not null);

        RuleFor(x => x.Status)
            .Must(status => status is null || ProjectStatus.IsValid(status))
            .WithMessage("Le statut est invalide.")
            .When(x => x.Status is not null);
    }
}
