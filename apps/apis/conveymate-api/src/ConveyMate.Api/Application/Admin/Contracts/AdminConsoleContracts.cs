namespace ConveyMate.Api.Application.Admin.Contracts;

public sealed record AdminJobsPageDto(
    IReadOnlyList<AdminJobSummaryDto> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages);

public sealed record AdminJobSummaryDto(
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

public sealed record AdminJobDetailDto(
    Guid Id,
    Guid UserId,
    string UserEmail,
    string UserFullName,
    string PropertyAddress,
    string BuyerType,
    object? BuyerContext,
    string StateOrTerritory,
    string? LocalGovernmentArea,
    string PropertyTenureType,
    string PackType,
    string Status,
    string PaymentStatus,
    int AmountAudCents,
    string? StripePaymentIntentId,
    string? ReportPdfS3Key,
    string ReportJsonS3Key,
    string? ErrorMessage,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    int PercentComplete,
    string CurrentStep,
    string CurrentSubStep,
    DateTimeOffset LastUpdatedUtc,
    object? Summary,
    IReadOnlyList<AdminJobDocumentDto> UploadedDocuments,
    bool HasQuoteWorkflow,
    string? QuoteWorkflowStatus,
    int QuoteWorkflowTargetCount,
    int QuoteWorkflowResponseCount);

public sealed record AdminJobDocumentDto(
    Guid Id,
    string FileName,
    string ContentType,
    string DocType,
    string S3KeyRaw,
    DateTimeOffset UploadedAt);

public sealed record AdminStorageDownloadUrlResponse(
    string S3Key,
    string DownloadUrl,
    DateTimeOffset ExpiresAtUtc);

public sealed record AdminDeleteJobResponse(
    Guid JobId,
    bool Deleted,
    int StorageObjectsQueuedForDeletion);

public sealed record AdminDeleteQuoteWorkflowResponse(
    Guid JobId,
    bool Deleted,
    int DeletedWorkflowCount);

public sealed record AdminFeedbackPageDto(
    IReadOnlyList<AdminFeedbackDto> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages);

public sealed record AdminAuditPageDto(
    IReadOnlyList<AdminAuditEventDto> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages,
    AdminAuditSummaryDto Summary);

public sealed record AdminAuditEventDto(
    long Id,
    DateTimeOffset OccurredAt,
    string ActionCode,
    string ActionGroup,
    string ActionLabel,
    string? Description,
    string Source,
    string ActorType,
    Guid? ActorUserId,
    string? ActorEmail,
    string? ActorName,
    Guid? SubjectUserId,
    string? SubjectEmail,
    string? SubjectName,
    string? EntityType,
    string? EntityId,
    string? EntityLabel,
    string? RequestPath,
    string? RequestMethod,
    string? IpAddress);

public sealed record AdminAuditSummaryDto(
    int EventsLast24Hours,
    int EventsLast7Days,
    int UniqueActorsLast7Days,
    int SignInsLast7Days,
    int ReportsStartedLast7Days,
    int QuoteInteractionsLast7Days,
    int DocumentDownloadsLast7Days,
    IReadOnlyList<AdminAuditActionMetricDto> TopActions);

public sealed record AdminAuditActionMetricDto(
    string ActionCode,
    string ActionLabel,
    int Count);

public sealed record AdminFeedbackDto(
    Guid Id,
    Guid UserId,
    string UserEmail,
    string UserFullName,
    string Type,
    string Message,
    string PageUrl,
    string? UserAgent,
    DateTimeOffset CreatedAt);

public sealed record AdminUsersPageDto(
    IReadOnlyList<AdminUserDto> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages);

public sealed record AdminConveyancersPageDto(
    IReadOnlyList<AdminConveyancerDto> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages);

public sealed record AdminUserDto(
    Guid Id,
    string FullName,
    string Email,
    bool IsAdmin,
    bool IsSuspended,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastLoginAtUtc,
    int JobsRunCount,
    long TotalSpentAudCents);

public sealed record AdminConveyancerDto(
    Guid Id,
    string Jurisdiction,
    string RegulatorType,
    string Name,
    string? ContactName,
    string? OrganizationName,
    string? Address,
    string? Phone,
    string? Email,
    string? Website,
    IReadOnlyList<string> AreasOfPractice,
    string SourceUrl,
    string SourceIdentifier,
    bool IsActive,
    bool QuoteRequestsEnabled,
    DateTimeOffset? QuoteRequestsDisabledAtUtc,
    DateTimeOffset LastSeenUtc);

public sealed record SetUserSuspensionRequest(bool IsSuspended);

public sealed record CreateAdminConveyancerRequest(
    string Jurisdiction,
    string OrganizationName,
    string? ContactName,
    string? Address,
    string? Phone,
    string? Email,
    string? Website,
    IReadOnlyList<string>? AreasOfPractice,
    bool QuoteRequestsEnabled);

public sealed record UpdateAdminConveyancerRequest(
    string OrganizationName,
    string? ContactName,
    string? Address,
    string? Phone,
    string? Email,
    string? Website,
    IReadOnlyList<string>? AreasOfPractice,
    bool QuoteRequestsEnabled);

public sealed record SetAdminConveyancerActiveRequest(bool IsActive);

public sealed record SetAdminConveyancerQuoteRequestsEnabledRequest(bool IsEnabled);
