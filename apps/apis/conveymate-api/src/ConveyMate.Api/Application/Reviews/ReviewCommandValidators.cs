using FluentValidation;

namespace ConveyMate.Api.Application.Reviews;

/// <summary>
/// Validates create-review command input.
/// </summary>
public sealed class CreateReviewCommandValidator : AbstractValidator<CreateReviewCommand>
{
    public CreateReviewCommandValidator()
    {
        RuleFor(command => command.Request.PropertyAddress)
            .Must(address => !string.IsNullOrWhiteSpace(address))
            .WithMessage("Property address is required.");

        RuleFor(command => command.Request.Files)
            .Must(files => files.Count > 0)
            .WithMessage("At least one document must be supplied.");

        RuleFor(command => command.Request.Files)
            .Must(files => files.Count < ReviewUploadLimits.MaxDocumentsPerReview)
            .WithMessage($"A maximum of {ReviewUploadLimits.MaxDocumentsPerReview} PDF files can be uploaded per review.");

        RuleForEach(command => command.Request.Files)
            .Must(file => file.SizeBytes > 0 && file.SizeBytes <= ReviewUploadLimits.MaxDocumentSizeBytes)
            .WithMessage($"Each PDF must be {ReviewUploadLimits.MaxDocumentSizeLabel} or smaller.");
    }
}

/// <summary>
/// Validates finalize-upload command input.
/// </summary>
public sealed class FinalizeReviewUploadsCommandValidator : AbstractValidator<FinalizeReviewUploadsCommand>
{
    public FinalizeReviewUploadsCommandValidator()
    {
        RuleFor(command => command.Request.Documents)
            .Must(documents => documents.Count > 0)
            .WithMessage("No uploaded documents were provided.");

        RuleFor(command => command.Request.Documents)
            .Must(documents => documents.Count <= ReviewUploadLimits.MaxDocumentsPerReview)
            .WithMessage($"A maximum of {ReviewUploadLimits.MaxDocumentsPerReview} PDF files can be uploaded per review.");
    }
}

/// <summary>
/// Validates Stripe webhook command input.
/// </summary>
public sealed class HandleStripeWebhookCommandValidator : AbstractValidator<HandleStripeWebhookCommand>
{
    public HandleStripeWebhookCommandValidator()
    {
        RuleFor(command => command.SignatureHeader)
            .Must(signature => !string.IsNullOrWhiteSpace(signature))
            .WithMessage("Stripe signature header is missing.");
    }
}
