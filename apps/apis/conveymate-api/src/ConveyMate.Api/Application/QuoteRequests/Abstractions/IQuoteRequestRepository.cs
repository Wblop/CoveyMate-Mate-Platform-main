using ConveyMate.Api.Application.QuoteRequests.Contracts;

namespace ConveyMate.Api.Application.QuoteRequests.Abstractions;

/// <summary>
/// Persistence abstraction for quote-request workflows and public response tokens.
/// </summary>
public interface IQuoteRequestRepository
{
    Task CreateAsync(
        QuoteRequestCreateRecord request,
        IReadOnlyList<QuoteRequestTargetCreateRecord> targets,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<QuoteRequestSummaryRecord>> ListForUserAsync(Guid userId, bool includeArchived, CancellationToken cancellationToken);

    Task<QuoteRequestSummaryRecord?> GetSummaryForUserByReviewJobAsync(
        Guid userId,
        Guid reviewJobId,
        CancellationToken cancellationToken);

    Task<QuoteRequestDetailRecord?> GetForUserAsync(Guid requestId, Guid userId, CancellationToken cancellationToken);

    Task<QuoteRequestArchiveRecord?> SetArchivedAsync(Guid requestId, Guid userId, bool archived, CancellationToken cancellationToken);

    Task<bool> DeleteForUserAsync(Guid requestId, Guid userId, CancellationToken cancellationToken);

    Task ApplyDeliveryUpdatesAsync(
        Guid quoteRequestId,
        IReadOnlyList<QuoteRequestTargetDeliveryUpdate> updates,
        CancellationToken cancellationToken);

    Task<QuoteRequestPublicTargetRecord?> GetPublicTargetByTokenHashAsync(string tokenHash, CancellationToken cancellationToken);

    Task MarkTargetOpenedAsync(Guid targetId, CancellationToken cancellationToken);

    Task UpdateDocumentAccessOtpAsync(
        Guid targetId,
        string otpHash,
        DateTimeOffset requestedAtUtc,
        DateTimeOffset expiresAtUtc,
        CancellationToken cancellationToken);

    Task MarkDocumentAccessVerifiedAsync(Guid targetId, DateTimeOffset verifiedAtUtc, CancellationToken cancellationToken);

    Task CreateDocumentAccessSessionAsync(
        QuoteRequestDocumentAccessSessionCreateRecord session,
        CancellationToken cancellationToken);

    Task<QuoteRequestDocumentAccessSessionRecord?> GetActiveDocumentAccessSessionAsync(
        Guid targetId,
        string accessTokenHash,
        CancellationToken cancellationToken);

    Task RecordDocumentDownloadAsync(
        QuoteRequestDocumentDownloadUpsertRecord record,
        CancellationToken cancellationToken);

    Task<QuoteRequestPublicTargetRecord?> SubmitResponseAsync(
        Guid targetId,
        QuoteRequestResponseCreateRecord response,
        CancellationToken cancellationToken);
}

/// <summary>
/// Request aggregate persisted before outbound delivery.
/// </summary>
public sealed record QuoteRequestCreateRecord(
    Guid Id,
    Guid UserId,
    Guid ReviewJobId,
    string PropertyAddress,
    string StateOrTerritory,
    string ServiceNeed,
    string? Message,
    bool ShareReportPdf,
    string BriefJson,
    string Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc);

/// <summary>
/// Snapshot of a selected conveyancer at send time.
/// </summary>
public sealed record QuoteRequestTargetCreateRecord(
    Guid Id,
    Guid QuoteRequestId,
    string Jurisdiction,
    string RegulatorType,
    string SourceIdentifier,
    string Name,
    string? ContactName,
    string? OrganizationName,
    string Email,
    string? Phone,
    string? Website,
    string SourceUrl,
    string ResponseTokenHash,
    string Status,
    DateTimeOffset CreatedAtUtc);

/// <summary>
/// Delivery result persisted after email send attempts complete.
/// </summary>
public sealed record QuoteRequestTargetDeliveryUpdate(
    Guid TargetId,
    string Status,
    DateTimeOffset? SentAtUtc,
    string? DeliveryError);

/// <summary>
/// Lightweight list row for authenticated quote-request views.
/// </summary>
public sealed record QuoteRequestSummaryRecord(
    Guid Id,
    Guid ReviewJobId,
    string PropertyAddress,
    string StateOrTerritory,
    string ServiceNeed,
    string Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? SentAtUtc,
    DateTimeOffset ExpiresAtUtc,
    int TargetCount,
    int ResponseCount,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Detailed request aggregate for authenticated users.
/// </summary>
public sealed record QuoteRequestDetailRecord(
    QuoteRequestRecord Request,
    string? ReportS3Key,
    IReadOnlyList<QuoteRequestSharedDocumentRecord> SharedDocuments,
    IReadOnlyList<QuoteRequestTargetDetailRecord> Targets);

/// <summary>
/// Core quote-request record.
/// </summary>
public sealed record QuoteRequestRecord(
    Guid Id,
    Guid UserId,
    Guid ReviewJobId,
    string PropertyAddress,
    string StateOrTerritory,
    string ServiceNeed,
    string? Message,
    bool ShareReportPdf,
    string BriefJson,
    string Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    DateTimeOffset? SentAtUtc,
    DateTimeOffset ExpiresAtUtc,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Archive-state update result for a user-owned quote workflow.
/// </summary>
public sealed record QuoteRequestArchiveRecord(
    Guid QuoteRequestId,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Detailed target row including an optional submitted response.
/// </summary>
public sealed record QuoteRequestTargetDetailRecord(
    Guid Id,
    Guid QuoteRequestId,
    string Jurisdiction,
    string RegulatorType,
    string SourceIdentifier,
    string Name,
    string? ContactName,
    string? OrganizationName,
    string Email,
    string? Phone,
    string? Website,
    string SourceUrl,
    string Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    DateTimeOffset? SentAtUtc,
    DateTimeOffset? OpenedAtUtc,
    DateTimeOffset? RespondedAtUtc,
    string? DeliveryError,
    QuoteRequestResponseRecord? Response,
    QuoteRequestTargetDocumentAccessRecord DocumentAccess);

/// <summary>
/// Persisted quote response row.
/// </summary>
public sealed record QuoteRequestResponseRecord(
    Guid Id,
    Guid TargetId,
    string ResponderName,
    string ResponderEmail,
    string? ResponderPhone,
    decimal ProfessionalFeeAud,
    bool IncludesGst,
    decimal? DisbursementsEstimateAud,
    int? TurnaroundBusinessDays,
    string ScopeNotes,
    IReadOnlyList<string> ExcludedItems,
    DateTimeOffset? ValidUntilUtc,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

/// <summary>
/// Token-scoped public response context.
/// </summary>
public sealed record QuoteRequestPublicTargetRecord(
    QuoteRequestRecord Request,
    QuoteRequestTargetDetailRecord Target,
    string? ReportS3Key,
    IReadOnlyList<QuoteRequestSharedDocumentRecord> SharedDocuments);

/// <summary>
/// Internal document-access state and audit for a conveyancer target.
/// </summary>
public sealed record QuoteRequestTargetDocumentAccessRecord(
    string? OtpCodeHash,
    DateTimeOffset? OtpRequestedAtUtc,
    DateTimeOffset? OtpExpiresAtUtc,
    int OtpSendCount,
    DateTimeOffset? VerifiedAtUtc,
    bool ReportDownloaded,
    int DownloadedSharedDocumentCount,
    int TotalDocumentCount,
    DateTimeOffset? LastDownloadedAtUtc)
{
    public static QuoteRequestTargetDocumentAccessRecord Empty(int totalDocumentCount)
        => new(null, null, null, 0, null, false, 0, totalDocumentCount, null);
}

/// <summary>
/// Persistent document-access session created after successful OTP verification.
/// </summary>
public sealed record QuoteRequestDocumentAccessSessionCreateRecord(
    Guid Id,
    Guid TargetId,
    string AccessTokenHash,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc);

public sealed record QuoteRequestDocumentAccessSessionRecord(
    Guid Id,
    Guid TargetId,
    string AccessTokenHash,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    DateTimeOffset? RevokedAtUtc);

/// <summary>
/// Download-audit upsert payload for a report or supporting document.
/// </summary>
public sealed record QuoteRequestDocumentDownloadUpsertRecord(
    Guid Id,
    Guid TargetId,
    string DocumentKey,
    string DocumentKind,
    Guid? DocumentId,
    string FileName,
    DateTimeOffset DownloadedAtUtc);

/// <summary>
/// Review document shared with a conveyancer through the secure quote link.
/// </summary>
public sealed record QuoteRequestSharedDocumentRecord(
    Guid Id,
    Guid JobId,
    string S3KeyRaw,
    string FileName,
    string ContentType,
    string DocType,
    DateTimeOffset UploadedAtUtc);

/// <summary>
/// Response payload persisted from a conveyancer secure-link submission.
/// </summary>
public sealed record QuoteRequestResponseCreateRecord(
    Guid Id,
    Guid TargetId,
    string ResponderName,
    string ResponderEmail,
    string? ResponderPhone,
    decimal ProfessionalFeeAud,
    bool IncludesGst,
    decimal? DisbursementsEstimateAud,
    int? TurnaroundBusinessDays,
    string ScopeNotes,
    IReadOnlyList<string> ExcludedItems,
    DateTimeOffset? ValidUntilUtc,
    DateTimeOffset CreatedAtUtc);
