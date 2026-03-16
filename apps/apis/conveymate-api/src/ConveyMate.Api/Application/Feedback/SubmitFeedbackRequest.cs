namespace ConveyMate.Api.Application.Feedback;

public sealed record SubmitFeedbackRequest(
    string Type,
    string Message,
    string PageUrl);
