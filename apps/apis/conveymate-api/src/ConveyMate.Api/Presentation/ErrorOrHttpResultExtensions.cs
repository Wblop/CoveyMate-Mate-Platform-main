using ErrorOr;

namespace ConveyMate.Api.Presentation;

internal static class ErrorOrHttpResultExtensions
{
    public static IResult ToHttpResult(
        this IReadOnlyList<Error> errors,
        string? validationTitle = null,
        string? notFoundTitle = null,
        string? unauthorizedTitle = null)
    {
        var statusCode = ResolveStatusCode(errors);
        var title = ResolveTitle(errors, validationTitle, notFoundTitle, unauthorizedTitle);
        var detail = string.Join("; ", errors.Select(error => error.Description).Where(description => !string.IsNullOrWhiteSpace(description)));

        return Results.Problem(
            title: title,
            detail: string.IsNullOrWhiteSpace(detail) ? null : detail,
            statusCode: statusCode);
    }

    private static int ResolveStatusCode(IReadOnlyList<Error> errors)
    {
        if (errors.Any(error => error.Type == ErrorType.Unauthorized))
        {
            return StatusCodes.Status401Unauthorized;
        }

        if (errors.Any(error => error.Type == ErrorType.NotFound))
        {
            return StatusCodes.Status404NotFound;
        }

        if (errors.Any(error => error.Type == ErrorType.Validation))
        {
            return StatusCodes.Status400BadRequest;
        }

        if (errors.Any(error => error.Type == ErrorType.Conflict))
        {
            return StatusCodes.Status409Conflict;
        }

        return StatusCodes.Status500InternalServerError;
    }

    private static string ResolveTitle(
        IReadOnlyList<Error> errors,
        string? validationTitle,
        string? notFoundTitle,
        string? unauthorizedTitle)
    {
        if (errors.Any(error => error.Type == ErrorType.Unauthorized))
        {
            return string.IsNullOrWhiteSpace(unauthorizedTitle) ? "Unauthorized request." : unauthorizedTitle;
        }

        if (errors.Any(error => error.Type == ErrorType.NotFound))
        {
            return string.IsNullOrWhiteSpace(notFoundTitle) ? "Resource not found." : notFoundTitle;
        }

        if (errors.Any(error => error.Type == ErrorType.Validation))
        {
            return string.IsNullOrWhiteSpace(validationTitle) ? "Invalid request." : validationTitle;
        }

        if (errors.Any(error => error.Type == ErrorType.Conflict))
        {
            return "Request conflicts with current state.";
        }

        return "Unexpected server error.";
    }
}
