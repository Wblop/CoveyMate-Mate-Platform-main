namespace ConveyMate.Api.Application.Reviews.Abstractions;

/// <summary>
/// Persistence abstraction for review job orchestration state and metadata.
/// </summary>
public interface IReviewJobRepository
{
    Task<ReviewJobRecord> CreateJobAsync(
        Guid jobId,
        Guid userId,
        string propertyAddress,
        string buyerType,
        string? buyerContextJson,
        string stateOrTerritory,
        string? localGovernmentArea,
        string propertyTenureType,
        string packType,
        string status,
        string paymentStatus,
        string progressJson,
        CancellationToken cancellationToken);

    Task<ReviewJobRecord?> GetJobForUserAsync(Guid jobId, Guid userId, CancellationToken cancellationToken);

    Task<IReadOnlyList<ReviewJobRecord>> ListJobsForUserAsync(Guid userId, bool includeArchived, CancellationToken cancellationToken);

    Task<ReviewJobArchiveRecord?> SetArchivedAsync(Guid jobId, Guid userId, bool archived, CancellationToken cancellationToken);

    Task<ReviewJobDeleteCandidateRecord?> GetDeleteCandidateForUserAsync(Guid jobId, Guid userId, CancellationToken cancellationToken);

    Task<bool> DeleteJobForUserAsync(Guid jobId, Guid userId, CancellationToken cancellationToken);

    Task<int> CountDocumentsAsync(Guid jobId, Guid userId, CancellationToken cancellationToken);

    Task SaveUploadedDocumentsAsync(
        Guid jobId,
        Guid userId,
        IReadOnlyList<ReviewDocumentRecord> documents,
        CancellationToken cancellationToken);

    Task<bool> TransitionToAwaitingPaymentAsync(Guid jobId, Guid userId, CancellationToken cancellationToken);

    Task<ReviewJobRecord?> SetPaymentIntentAsync(
        Guid jobId,
        Guid userId,
        string paymentIntentId,
        int amountAudCents,
        CancellationToken cancellationToken);

    Task<ReviewJobPaymentTransition?> MarkPaidAndQueuedAsync(
        string paymentIntentId,
        CancellationToken cancellationToken);

    Task<ReviewDisclaimerAcceptanceRecord?> RecordDisclaimerAcceptanceAsync(
        Guid jobId,
        Guid userId,
        string disclaimerVersion,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ReviewProgressEventRecord>> ListProgressEventsForUserAsync(
        Guid jobId,
        Guid userId,
        DateTimeOffset? sinceUtc,
        int limit,
        CancellationToken cancellationToken);

    Task<bool> RegisterWebhookEventAsync(
        string eventId,
        string paymentIntentId,
        string eventType,
        CancellationToken cancellationToken);
}

/// <summary>
/// Review job persistence record.
/// </summary>
public sealed record ReviewJobRecord(
    Guid Id,
    Guid UserId,
    string PropertyAddress,
    string BuyerType,
    string? BuyerContextJson,
    string StateOrTerritory,
    string? LocalGovernmentArea,
    string PropertyTenureType,
    string PackType,
    string Status,
    string PaymentStatus,
    string? StripePaymentIntentId,
    int AmountAudCents,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    string? ErrorMessage,
    string? ReportS3Key,
    string? DisclaimerVersion,
    DateTimeOffset? DisclaimerAcceptedAtUtc,
    string ProgressJson,
    string? SummaryJson,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Archive-state update result for a user-owned review job.
/// </summary>
public sealed record ReviewJobArchiveRecord(
    Guid JobId,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Storage metadata required before permanently deleting a user-owned review job.
/// </summary>
public sealed record ReviewJobDeleteCandidateRecord(
    Guid JobId,
    string? ReportPdfS3Key,
    string ReportJsonS3Key,
    IReadOnlyList<string> UploadedDocumentS3Keys);

/// <summary>
/// Review document metadata persisted after upload finalization.
/// </summary>
public sealed record ReviewDocumentRecord(
    Guid Id,
    Guid JobId,
    Guid UserId,
    string S3KeyRaw,
    string FileName,
    string ContentType,
    string DocType,
    DateTimeOffset UploadedAt);

/// <summary>
/// Payment transition result used to decide whether queued-side effects should occur.
/// </summary>
public sealed record ReviewJobPaymentTransition(
    Guid JobId,
    Guid UserId,
    bool WasQueued);

/// <summary>
/// Disclaimer acceptance audit record.
/// </summary>
public sealed record ReviewDisclaimerAcceptanceRecord(
    Guid JobId,
    string DisclaimerVersion,
    DateTimeOffset AcceptedAtUtc);

/// <summary>
/// Persisted progress event used for user-facing live activity feeds.
/// </summary>
public sealed record ReviewProgressEventRecord(
    long Id,
    Guid JobId,
    DateTimeOffset TimestampUtc,
    string StageId,
    string StageState,
    string Severity,
    string Message,
    int? PercentComplete,
    string? DetailCode,
    int? Attempt,
    int? MaxAttempts);
