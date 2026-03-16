using FluentValidation;

namespace ConveyMate.Api.Application.Feedback;

/// <summary>
/// Validates feedback command payloads before execution.
/// </summary>
public sealed class SubmitFeedbackCommandValidator : AbstractValidator<SubmitFeedbackCommand>
{
    private static readonly HashSet<string> AllowedTypes =
        new(["bug", "suggestion", "general"], StringComparer.OrdinalIgnoreCase);

    public SubmitFeedbackCommandValidator()
    {
        RuleFor(command => command.Request.Type)
            .Must(type => !string.IsNullOrWhiteSpace(type) && AllowedTypes.Contains(type))
            .WithMessage("Feedback type must be one of: bug, suggestion, general.");

        RuleFor(command => command.Request.Message)
            .Must(message => !string.IsNullOrWhiteSpace(message))
            .WithMessage("Feedback message is required.")
            .MaximumLength(5000)
            .WithMessage("Feedback message must be 5000 characters or fewer.");

        RuleFor(command => command.Request.PageUrl)
            .Must(url => IsRelativePath(url))
            .WithMessage("Page URL must be a relative path (2000 characters max).");
    }

    private static bool IsRelativePath(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return true;
        }

        if (url.Length > 2000)
        {
            return false;
        }

        // Must start with / but not // (protocol-relative = open redirect vector)
        return url.StartsWith('/') && !url.StartsWith("//", StringComparison.Ordinal);
    }
}
