namespace ConveyMate.Api.Application.Admin.Abstractions;

public interface IAdminConsoleRepository
{
    Task<AdminJobListRecord> ListJobsAsync(
        int page,
        int pageSize,
        string? search,
        string? status,
        CancellationToken cancellationToken);

    Task<AdminJobDetailRecord?> GetJobByIdAsync(Guid jobId, CancellationToken cancellationToken);

    Task<IReadOnlyList<AdminJobDocumentRecord>> ListJobDocumentsAsync(Guid jobId, CancellationToken cancellationToken);

    Task<AdminJobDocumentRecord?> GetJobDocumentAsync(Guid jobId, Guid documentId, CancellationToken cancellationToken);

    Task<AdminDeleteJobCandidateRecord?> GetJobDeleteCandidateAsync(Guid jobId, CancellationToken cancellationToken);

    Task<bool> DeleteJobAsync(Guid jobId, CancellationToken cancellationToken);

    Task<AdminDeleteQuoteWorkflowCandidateRecord?> GetQuoteWorkflowDeleteCandidateAsync(Guid jobId, CancellationToken cancellationToken);

    Task<int> DeleteQuoteWorkflowsAsync(Guid jobId, CancellationToken cancellationToken);

    Task<AdminFeedbackListRecord> ListFeedbackAsync(
        int page,
        int pageSize,
        string? type,
        CancellationToken cancellationToken);

    Task<AdminUserListRecord> ListUsersAsync(
        int page,
        int pageSize,
        string? search,
        CancellationToken cancellationToken);

    Task<AdminUserRecord?> SetUserSuspensionAsync(Guid userId, bool isSuspended, CancellationToken cancellationToken);

    Task<AdminUserRecord?> GetUserByIdAsync(Guid userId, CancellationToken cancellationToken);
}

public sealed record AdminJobListRecord(
    IReadOnlyList<AdminJobSummaryRecord> Jobs,
    int TotalCount);

public sealed record AdminJobSummaryRecord(
    Guid Id,
    Guid UserId,
    string UserEmail,
    string UserFullName,
    string PropertyAddress,
    string Status,
    string PaymentStatus,
    int AmountAudCents,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    string? ErrorMessage,
    bool HasQuoteWorkflow);

public sealed record AdminJobDetailRecord(
    Guid Id,
    Guid UserId,
    string UserEmail,
    string UserFullName,
    string PropertyAddress,
    string BuyerType,
    string? BuyerContextJson,
    string StateOrTerritory,
    string? LocalGovernmentArea,
    string PropertyTenureType,
    string PackType,
    string Status,
    string PaymentStatus,
    int AmountAudCents,
    string? StripePaymentIntentId,
    string? ReportS3Key,
    string? ErrorMessage,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    string ProgressJson,
    string? SummaryJson,
    bool HasQuoteWorkflow,
    string? QuoteWorkflowStatus,
    int QuoteWorkflowTargetCount,
    int QuoteWorkflowResponseCount);

public sealed record AdminJobDocumentRecord(
    Guid Id,
    Guid JobId,
    Guid UserId,
    string S3KeyRaw,
    string FileName,
    string ContentType,
    string DocType,
    DateTimeOffset UploadedAt);

public sealed record AdminDeleteJobCandidateRecord(
    Guid JobId,
    Guid UserId,
    string? ReportPdfS3Key,
    string ReportJsonS3Key,
    IReadOnlyList<string> UploadedDocumentS3Keys);

public sealed record AdminDeleteQuoteWorkflowCandidateRecord(
    Guid JobId,
    Guid UserId,
    int WorkflowCount);

public sealed record AdminFeedbackListRecord(
    IReadOnlyList<AdminFeedbackRecord> Feedback,
    int TotalCount);

public sealed record AdminFeedbackRecord(
    Guid Id,
    Guid UserId,
    string UserEmail,
    string UserFullName,
    string Type,
    string Message,
    string PageUrl,
    string? UserAgent,
    DateTimeOffset CreatedAt);

public sealed record AdminUserListRecord(
    IReadOnlyList<AdminUserRecord> Users,
    int TotalCount);

public sealed record AdminUserRecord(
    Guid Id,
    string FullName,
    string Email,
    bool IsAdmin,
    bool IsSuspended,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastLoginAtUtc,
    int JobsRunCount,
    long TotalSpentAudCents);
