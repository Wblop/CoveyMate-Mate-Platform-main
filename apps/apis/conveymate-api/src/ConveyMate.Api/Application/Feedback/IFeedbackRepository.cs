namespace ConveyMate.Api.Application.Feedback;

public interface IFeedbackRepository
{
    Task InsertAsync(Guid userId, SubmitFeedbackRequest request, string? userAgent, CancellationToken cancellationToken);
}
