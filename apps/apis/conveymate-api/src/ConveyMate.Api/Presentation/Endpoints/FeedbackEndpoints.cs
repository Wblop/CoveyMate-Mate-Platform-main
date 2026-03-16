using System.Security.Claims;
using Carter;
using MediatR;
using ConveyMate.Api.Application.Feedback;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

public sealed class FeedbackEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/feedback", async (
                ClaimsPrincipal principal,
                SubmitFeedbackRequest request,
                HttpContext httpContext,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var userAgent = httpContext.Request.Headers.UserAgent.ToString();
                var result = await sender.Send(
                    new SubmitFeedbackCommand(
                        principal,
                        request,
                        string.IsNullOrWhiteSpace(userAgent) ? null : userAgent),
                    cancellationToken);

                return result.Match(
                    _ => Results.Ok(),
                    errors => errors.ToHttpResult(validationTitle: "Invalid feedback submission."));
            })
            .RequireAuthorization()
            .WithName("SubmitFeedback");
    }
}
