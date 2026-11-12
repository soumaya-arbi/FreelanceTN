using FluentValidation;
using FreelanceTn.Api.Dtos.Proposals;
using FreelanceTn.Api.Models;

namespace FreelanceTn.Api.Validators;

public class CreateProposalRequestValidator : AbstractValidator<CreateProposalRequest>
{
    public CreateProposalRequestValidator()
    {
        RuleFor(x => x.ProjectId)
            .NotEmpty().WithMessage("Le projet est obligatoire.")
            .MaximumLength(64);

        RuleFor(x => x.CoverLetter)
            .NotEmpty().WithMessage("La lettre de motivation est obligatoire.")
            .MinimumLength(20).WithMessage("La lettre de motivation doit faire au moins 20 caractères.")
            .MaximumLength(5000);

        RuleFor(x => x.Price)
            .NotEmpty().WithMessage("Le montant proposé est obligatoire.")
            .MaximumLength(60);

        RuleFor(x => x.Delivery)
            .NotEmpty().WithMessage("Le délai de livraison est obligatoire.")
            .MaximumLength(60);

        RuleFor(x => x.PortfolioId)
            .MaximumLength(64).When(x => x.PortfolioId is not null);
    }
}

public class UpdateProposalStatusRequestValidator : AbstractValidator<UpdateProposalStatusRequest>
{
    public UpdateProposalStatusRequestValidator()
    {
        // Le client ne peut que trancher : accepter ou refuser. Les autres
        // statuts (Pending, Withdrawn) sont imposés par le serveur.
        RuleFor(x => x.Status)
            .NotEmpty().WithMessage("Le statut est obligatoire.")
            .Must(status => status is not null && ProposalStatus.IsValid(status))
            .WithMessage("Le statut est invalide.")
            .Must(status => status is not null &&
                (string.Equals(status.Trim(), ProposalStatus.Accepted, StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(status.Trim(), ProposalStatus.Refused, StringComparison.OrdinalIgnoreCase)))
            .WithMessage("Seules les décisions « Accepted » et « Refused » sont autorisées.");
    }
}
