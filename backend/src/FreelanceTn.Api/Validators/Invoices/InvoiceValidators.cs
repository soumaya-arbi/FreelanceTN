using FluentValidation;
using FreelanceTn.Api.Dtos.Invoices;

namespace FreelanceTn.Api.Validators.Invoices;

public class InvoiceLineRequestValidator : AbstractValidator<InvoiceLineRequest>
{
    public InvoiceLineRequestValidator()
    {
        RuleFor(x => x.Description).NotEmpty().WithMessage("La description de la ligne est obligatoire.");
        RuleFor(x => x.Quantity).GreaterThan(0).WithMessage("La quantit� doit �tre sup�rieure � 0.");
        RuleFor(x => x.UnitPrice).GreaterThanOrEqualTo(0).WithMessage("Le prix unitaire ne peut pas �tre n�gatif.");
        RuleFor(x => x.TaxRate).GreaterThanOrEqualTo(0).WithMessage("Le taux de TVA ne peut pas �tre n�gatif.");
        RuleFor(x => x.Discount).GreaterThanOrEqualTo(0).LessThanOrEqualTo(100).WithMessage("La remise doit �tre comprise entre 0 et 100.");
    }
}

public class CreateInvoiceRequestValidator : AbstractValidator<CreateInvoiceRequest>
{
    public CreateInvoiceRequestValidator()
    {
        RuleFor(x => x.Client).NotEmpty().WithMessage("Le client est obligatoire.");
        RuleFor(x => x.ProjectId).NotEmpty().WithMessage("Le projet est obligatoire.");
        RuleFor(x => x.IssueDate).NotEmpty().WithMessage("La date d'�mission est obligatoire.");
        RuleFor(x => x.DueDate).NotEmpty().WithMessage("La date d'�ch�ance est obligatoire.");
        RuleFor(x => x.Lines).NotEmpty().WithMessage("Au moins une ligne est obligatoire.");
        RuleForEach(x => x.Lines).SetValidator(new InvoiceLineRequestValidator());
    }
}

public class UpdateInvoiceRequestValidator : AbstractValidator<UpdateInvoiceRequest>
{
    public UpdateInvoiceRequestValidator()
    {
        RuleFor(x => x.Status)
            .Must(s => s == null || new[] { "draft", "emise", "unpaid", "partially_paid", "paid", "overdue" }.Contains(s.Trim().ToLowerInvariant()))
            .WithMessage("Statut de facture invalide.");
        RuleFor(x => x.Lines)
            .Must(lines => lines == null || lines.Count > 0)
            .WithMessage("Au moins une ligne est obligatoire.");
        RuleForEach(x => x.Lines).SetValidator(new InvoiceLineRequestValidator()!)
            .When(x => x.Lines != null);
    }
}

public class RecordPaymentRequestValidator : AbstractValidator<RecordPaymentRequest>
{
    public RecordPaymentRequestValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0).WithMessage("Le montant du paiement doit �tre sup�rieur � 0.");
    }
}
