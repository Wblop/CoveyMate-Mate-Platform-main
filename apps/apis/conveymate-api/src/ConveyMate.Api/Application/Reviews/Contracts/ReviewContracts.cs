namespace ConveyMate.Api.Application.Reviews.Contracts;

/// <summary>
/// Create-review request contract for initializing a review job and upload targets.
/// </summary>
public sealed record CreateReviewRequest(
    string PropertyAddress,
    string BuyerType,
    ReviewBuyerContextDto? BuyerContext,
    string StateOrTerritory,
    string? LocalGovernmentArea,
    string PropertyTenureType,
    string PackType,
    IReadOnlyList<CreateReviewFileRequest> Files);

/// <summary>
/// Buyer-provided context captured during wizard setup to refine pipeline behavior.
/// </summary>
public sealed record ReviewBuyerContextDto(
    bool? IsFirstHomeBuyer,
    string ConcessionIntent,
    bool? ContractExchanged,
    decimal? AgreedPriceAud,
    decimal? EstimatedPriceAud);

/// <summary>
/// Input metadata for each file that will be uploaded by the client.
/// </summary>
public sealed record CreateReviewFileRequest(
    string FileName,
    string ContentType,
    long SizeBytes);

/// <summary>
/// Presigned upload URL result for a single review document.
/// </summary>
public sealed record ReviewUploadTargetDto(
    Guid DocumentId,
    string FileName,
    string ContentType,
    string S3KeyRaw,
    string UploadUrl,
    DateTimeOffset ExpiresAtUtc);

/// <summary>
/// Create-review response containing job identifiers and upload targets.
/// </summary>
public sealed record CreateReviewResponse(
    Guid JobId,
    string Status,
    string PaymentStatus,
    IReadOnlyList<ReviewUploadTargetDto> Uploads);

/// <summary>
/// Finalize-upload request payload after direct-to-S3 uploads complete.
/// </summary>
public sealed record FinalizeReviewUploadsRequest(IReadOnlyList<FinalizeReviewDocumentRequest> Documents);

/// <summary>
/// Persisted document metadata submitted after file uploads complete.
/// </summary>
public sealed record FinalizeReviewDocumentRequest(
    Guid DocumentId,
    string FileName,
    string ContentType,
    string S3KeyRaw);

/// <summary>
/// Request payload for recording disclaimer acknowledgement prior to payment.
/// </summary>
public sealed record AcknowledgeReviewDisclaimerRequest(string? DisclaimerVersion);

/// <summary>
/// Response payload confirming disclaimer acceptance has been recorded.
/// </summary>
public sealed record ReviewDisclaimerAcknowledgementDto(
    Guid JobId,
    string DisclaimerVersion,
    DateTimeOffset AcceptedAtUtc);

/// <summary>
/// Payment-intent response returned to the frontend for Stripe confirmation.
/// </summary>
public sealed record CreateReviewPaymentResponse(
    string PaymentIntentId,
    string ClientSecret,
    int AmountAudCents,
    string Currency);

/// <summary>
/// Lightweight summary row for review list/dashboard views.
/// </summary>
public sealed record ReviewSummaryDto(
    Guid Id,
    string PropertyAddress,
    string BuyerType,
    string StateOrTerritory,
    string Status,
    string PaymentStatus,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int PercentComplete,
    string CurrentStep,
    string CurrentSubStep,
    DateTimeOffset LastUpdatedUtc,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Detailed job state payload used for live progress screens.
/// </summary>
public sealed record ReviewDetailDto(
    Guid Id,
    string PropertyAddress,
    string BuyerType,
    ReviewBuyerContextDto? BuyerContext,
    string StateOrTerritory,
    string? LocalGovernmentArea,
    string PropertyTenureType,
    string PackType,
    string Status,
    string PaymentStatus,
    int PercentComplete,
    string CurrentStep,
    string CurrentSubStep,
    DateTimeOffset LastUpdatedUtc,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    string? ErrorMessage,
    string? ReportS3Key,
    string? DisclaimerVersion,
    DateTimeOffset? DisclaimerAcceptedAtUtc,
    object? Summary,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Request payload for archiving or restoring a user-owned review job.
/// </summary>
public sealed record SetReviewArchiveStatusRequest(bool Archived);

/// <summary>
/// Archive-state response for a user-owned review job.
/// </summary>
public sealed record ReviewArchiveStatusDto(
    Guid JobId,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Response returned after permanently deleting a user-owned review job.
/// </summary>
public sealed record DeleteReviewJobResponse(
    Guid JobId,
    bool Deleted,
    int DeletedStorageObjectCount);

/// <summary>
/// Real-time progress event for the report pipeline activity feed.
/// </summary>
public sealed record ReviewProgressEventDto(
    long Id,
    DateTimeOffset TimestampUtc,
    string StageId,
    string StageState,
    string Severity,
    string Message,
    int? PercentComplete,
    string? DetailCode,
    int? Attempt,
    int? MaxAttempts);

/// <summary>
/// Source-of-truth step model exposed by backend for frontend pipeline rendering.
/// </summary>
public sealed record ReviewPipelineModelDto(
    IReadOnlyList<ReviewPipelineStepDto> Steps,
    int TypicalDurationMinutes,
    string DisclaimerVersion);

/// <summary>
/// Pipeline step descriptor including ordering and expected progress range.
/// </summary>
public sealed record ReviewPipelineStepDto(
    string Id,
    string Label,
    string Description,
    string Phase,
    int Order,
    int ProgressStartPercent,
    int ProgressEndPercent);

/// <summary>
/// Download-url contract for completed PDF reports.
/// </summary>
public sealed record ReviewDownloadUrlResponse(
    string DownloadUrl,
    DateTimeOffset ExpiresAtUtc);
