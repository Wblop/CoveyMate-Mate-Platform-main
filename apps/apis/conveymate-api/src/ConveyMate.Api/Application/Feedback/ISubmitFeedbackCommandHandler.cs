using System.Security.Claims;

namespace ConveyMate.Api.Application.Feedback;

public interface ISubmitFeedbackCommandHandler
{
    Task HandleAsync(ClaimsPrincipal principal, SubmitFeedbackRequest request, string? userAgent, CancellationToken cancellationToken);
}
