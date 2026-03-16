using System.Security.Claims;
using ErrorOr;
using MediatR;

namespace ConveyMate.Api.Application.Feedback;

/// <summary>
/// CQRS command for persisting authenticated user feedback.
/// </summary>
public sealed record SubmitFeedbackCommand(
    ClaimsPrincipal Principal,
    SubmitFeedbackRequest Request,
    string? UserAgent) : IRequest<ErrorOr<Success>>;
