using FluentValidation;
using FreelanceTn.Api.Dtos.Services;
using FreelanceTn.Api.Models;

namespace FreelanceTn.Api.Validators;

/// <summary>Validation d'un package tarifaire.</summary>
public class ServicePackageRequestValidator : AbstractValidator<ServicePackageRequest>
{
    public ServicePackageRequestValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Le nom du package est obligatoire.")
            .MaximumLength(60);

        RuleFor(x => x.Price)
            .GreaterThan(0).WithMessage("Le prix du package doit être supérieur à 0.")
            .LessThanOrEqualTo(1_000_000).WithMessage("Le prix du package ne peut pas dépasser 1 000 000.");

        RuleFor(x => x.DeliveryDays)
            .InclusiveBetween(1, 365).WithMessage("La durée de livraison doit être comprise entre 1 et 365 jours.");

        RuleFor(x => x.Revisions)
            .InclusiveBetween(0, 50).WithMessage("Le nombre de révisions doit être compris entre 0 et 50.");

        RuleFor(x => x.Description).MaximumLength(1000);
    }
}

/// <summary>Validation de la création d'un service.</summary>
public class CreateServiceRequestValidator : AbstractValidator<CreateServiceRequest>
{
    public CreateServiceRequestValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty().WithMessage("Le titre du service est obligatoire.")
            .MinimumLength(5).WithMessage("Le titre doit contenir au moins 5 caractères.")
            .MaximumLength(160);

        RuleFor(x => x.Category)
            .NotEmpty().WithMessage("La catégorie est obligatoire.")
            .MaximumLength(120);

        RuleFor(x => x.Subcategory).MaximumLength(120);

        RuleFor(x => x.Description)
            .NotEmpty().WithMessage("La description est obligatoire.")
            .MinimumLength(20).WithMessage("La description doit contenir au moins 20 caractères.")
            .MaximumLength(4000);

        RuleFor(x => x.Requirements).MaximumLength(2000);

        RuleFor(x => x.Packages)
            .NotEmpty().WithMessage("Au moins un package tarifaire est obligatoire.")
            .Must(packages => packages is not null && packages.Count <= 10)
            .WithMessage("10 packages maximum.");

        RuleForEach(x => x.Packages)
            .SetValidator(new ServicePackageRequestValidator());

        RuleFor(x => x.Tags)
            .Must(tags => tags is null || tags.Count <= 20)
            .WithMessage("20 tags maximum.");

        RuleForEach(x => x.Tags)
            .MaximumLength(40)
            .Must(tag => !string.IsNullOrWhiteSpace(tag))
            .WithMessage("Un tag ne peut pas être vide.")
            .When(x => x.Tags is not null);

        // Un service est créé visible au catalogue sauf demande explicite de brouillon.
        RuleFor(x => x.Status)
            .Must(status => string.IsNullOrWhiteSpace(status)
                || string.Equals(status.Trim(), ServiceStatus.Draft, StringComparison.OrdinalIgnoreCase)
                || string.Equals(status.Trim(), ServiceStatus.Published, StringComparison.OrdinalIgnoreCase))
            .WithMessage("Un service est créé en 'Published' ou 'Draft'.");
    }
}

/// <summary>Validation de la modification d'un service.</summary>
public class UpdateServiceRequestValidator : AbstractValidator<UpdateServiceRequest>
{
    public UpdateServiceRequestValidator()
    {
        RuleFor(x => x.Title)
            .MinimumLength(5).WithMessage("Le titre doit contenir au moins 5 caractères.")
            .MaximumLength(160)
            .When(x => x.Title is not null);

        RuleFor(x => x.Category)
            .NotEmpty().WithMessage("La catégorie est obligatoire.")
            .MaximumLength(120)
            .When(x => x.Category is not null);

        RuleFor(x => x.Subcategory)
            .MaximumLength(120)
            .When(x => x.Subcategory is not null);

        RuleFor(x => x.Description)
            .MinimumLength(20).WithMessage("La description doit contenir au moins 20 caractères.")
            .MaximumLength(4000)
            .When(x => x.Description is not null);

        RuleFor(x => x.Requirements)
            .MaximumLength(2000)
            .When(x => x.Requirements is not null);

        RuleFor(x => x.Packages)
            .Must(packages => packages is null || (packages.Count >= 1 && packages.Count <= 10))
            .WithMessage("Entre 1 et 10 packages tarifaires sont attendus.")
            .When(x => x.Packages is not null);

        RuleForEach(x => x.Packages)
            .SetValidator(new ServicePackageRequestValidator())
            .When(x => x.Packages is not null);

        RuleFor(x => x.Tags)
            .Must(tags => tags is null || tags.Count <= 20)
            .WithMessage("20 tags maximum.")
            .When(x => x.Tags is not null);

        RuleForEach(x => x.Tags)
            .MaximumLength(40)
            .Must(tag => !string.IsNullOrWhiteSpace(tag))
            .WithMessage("Un tag ne peut pas être vide.")
            .When(x => x.Tags is not null);

        RuleFor(x => x.Status)
            .Must(status => status is null || ServiceStatus.IsValid(status))
            .WithMessage("Le statut est invalide.")
            .When(x => x.Status is not null);
    }
}
