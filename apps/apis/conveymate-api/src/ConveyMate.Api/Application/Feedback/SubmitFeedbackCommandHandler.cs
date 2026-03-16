using System.Security.Claims;
using ErrorOr;
using MediatR;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Users.Abstractions;

namespace ConveyMate.Api.Application.Feedback;

public sealed class SubmitFeedbackCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IFeedbackRepository feedbackRepository)
    : ISubmitFeedbackCommandHandler,
      IRequestHandler<SubmitFeedbackCommand, ErrorOr<Success>>
{
    private static readonly HashSet<string> AllowedTypes =
        new(["bug", "suggestion", "general"], StringComparer.OrdinalIgnoreCase);

    public async Task HandleAsync(
        ClaimsPrincipal principal,
        SubmitFeedbackRequest request,
        string? userAgent,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Type) || !AllowedTypes.Contains(request.Type))
        {
            throw new ArgumentException("Feedback type must be one of: bug, suggestion, general.");
        }

        if (string.IsNullOrWhiteSpace(request.Message))
        {
            throw new ArgumentException("Feedback message is required.");
        }

        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        await feedbackRepository.InsertAsync(user.Id, request, userAgent, cancellationToken);
    }

    public Task<ErrorOr<Success>> Handle(SubmitFeedbackCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(
            request.Principal,
            request.Request,
            request.UserAgent,
            cancellationToken));
    }
}
