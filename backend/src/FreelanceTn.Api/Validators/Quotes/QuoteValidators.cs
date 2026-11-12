using FluentValidation;
using FreelanceTn.Api.Dtos.Quotes;

namespace FreelanceTn.Api.Validators.Quotes;

public class QuoteLineRequestValidator : AbstractValidator<QuoteLineRequest>
{
    public QuoteLineRequestValidator()
    {
        RuleFor(x => x.Description).NotEmpty().WithMessage("La description de la ligne est obligatoire.");
        RuleFor(x => x.Quantity).GreaterThan(0).WithMessage("La quantit� doit �tre sup�rieure � 0.");
        RuleFor(x => x.UnitPrice).GreaterThanOrEqualTo(0).WithMessage("Le prix unitaire ne peut pas �tre n�gatif.");
        RuleFor(x => x.TaxRate).GreaterThanOrEqualTo(0).WithMessage("Le taux de TVA ne peut pas �tre n�gatif.");
        RuleFor(x => x.Discount).GreaterThanOrEqualTo(0).LessThanOrEqualTo(100).WithMessage("La remise doit �tre comprise entre 0 et 100.");
    }
}

public class CreateQuoteRequestValidator : AbstractValidator<CreateQuoteRequest>
{
    public CreateQuoteRequestValidator()
    {
        RuleFor(x => x.Client).MaximumLength(200).WithMessage("Le nom du client est trop long.");
        RuleFor(x => x.ProjectId).NotEmpty().WithMessage("Le projet est obligatoire.");
        RuleFor(x => x.IssueDate).NotEmpty().WithMessage("La date d'�mission est obligatoire.");
        RuleFor(x => x.ValidUntil).NotEmpty().WithMessage("La date de validit� est obligatoire.");
        RuleFor(x => x.Lines).NotEmpty().WithMessage("Au moins une ligne est obligatoire.");
        RuleForEach(x => x.Lines).SetValidator(new QuoteLineRequestValidator());
    }
}

public class UpdateQuoteRequestValidator : AbstractValidator<UpdateQuoteRequest>
{
    public UpdateQuoteRequestValidator()
    {
        RuleFor(x => x.Status)
            .Must(s => s == null || new[] { "draft", "sent", "accepted", "refused", "expired" }.Contains(s.Trim().ToLowerInvariant()))
            .WithMessage("Statut de devis invalide.");
        RuleFor(x => x.Lines)
            .Must(lines => lines == null || lines.Count > 0)
            .WithMessage("Au moins une ligne est obligatoire.");
        RuleForEach(x => x.Lines).SetValidator(new QuoteLineRequestValidator()!)
            .When(x => x.Lines != null);
    }
}
