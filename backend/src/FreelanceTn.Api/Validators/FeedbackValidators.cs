using FluentValidation;
using FreelanceTn.Api.Dtos.Feedbacks;

namespace FreelanceTn.Api.Validators;

/// <summary>
/// Validation de forme d'une soumission. Les règles dépendantes du rôle
/// (clés exactes des critères, commentaire obligatoire, recommandation) sont
/// vérifiées dans <c>FeedbackService</c>, qui connaît le projet et l'auteur.
/// </summary>
public class SubmitFeedbackRequestValidator : AbstractValidator<SubmitFeedbackRequest>
{
    public SubmitFeedbackRequestValidator()
    {
        RuleFor(x => x.Criteria)
            .NotNull().WithMessage("Les cinq critères sont obligatoires.")
            .Must(criteria => criteria.Count == 5)
            .WithMessage("Les cinq critères doivent être renseignés.")
            .Must(criteria => criteria.Values.All(value => value is >= 1 and <= 5))
            .WithMessage("Chaque critère doit être noté entre 1 et 5.");

        RuleFor(x => x.Comment)
            .NotEmpty().WithMessage("Le commentaire général est obligatoire.")
            .MaximumLength(1000).WithMessage("Le commentaire ne peut pas dépasser 1000 caractères.");

        RuleFor(x => x.Strengths)
            .MaximumLength(1000).WithMessage("Les points forts ne peuvent pas dépasser 1000 caractères.")
            .When(x => x.Strengths is not null);

        RuleFor(x => x.Improvements)
            .MaximumLength(1000).WithMessage("Les points à améliorer ne peuvent pas dépasser 1000 caractères.")
            .When(x => x.Improvements is not null);
    }
}
