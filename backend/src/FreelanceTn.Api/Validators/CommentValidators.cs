using FluentValidation;
using FreelanceTn.Api.Dtos.Comments;

namespace FreelanceTn.Api.Validators;

public class CreateCommentRequestValidator : AbstractValidator<CreateCommentRequest>
{
    public CreateCommentRequestValidator()
    {
        RuleFor(x => x.ProjectId)
            .NotEmpty().WithMessage("Le projet est obligatoire.")
            .MaximumLength(64);

        RuleFor(x => x.Content)
            .NotEmpty().WithMessage("Le commentaire est obligatoire.")
            .MaximumLength(2000).WithMessage("Le commentaire ne peut pas dépasser 2000 caractères.");
    }
}

public class UpdateCommentRequestValidator : AbstractValidator<UpdateCommentRequest>
{
    public UpdateCommentRequestValidator()
    {
        RuleFor(x => x.Content)
            .NotEmpty().WithMessage("Le commentaire est obligatoire.")
            .MaximumLength(2000).WithMessage("Le commentaire ne peut pas dépasser 2000 caractères.");
    }
}
