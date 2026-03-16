namespace ConveyMate.Api.Application.QuoteRequests.Contracts;

/// <summary>
/// Payload used by authenticated users to create and send a quote request from a completed report.
/// </summary>
public sealed record CreateQuoteRequestFromReportRequest(
    string ServiceNeed,
    string? Message,
    bool ShareReportPdf,
    IReadOnlyList<string>? TopConcerns,
    IReadOnlyList<string>? ConveyancerQuestions,
    IReadOnlyList<QuoteRequestSelectedConveyancerRequest> SelectedConveyancers);

/// <summary>
/// Normalized conveyancer identifier snapshot selected by the buyer.
/// </summary>
public sealed record QuoteRequestSelectedConveyancerRequest(
    string Jurisdiction,
    string RegulatorType,
    string SourceIdentifier);

/// <summary>
/// Summary row returned to the authenticated app for list views.
/// </summary>
public sealed record QuoteRequestSummaryDto(
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
/// Authenticated detail view for a quote request.
/// </summary>
public sealed record QuoteRequestDetailDto(
    Guid Id,
    Guid ReviewJobId,
    string PropertyAddress,
    string StateOrTerritory,
    string ServiceNeed,
    string? Message,
    bool ShareReportPdf,
    string Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? SentAtUtc,
    DateTimeOffset ExpiresAtUtc,
    DateTimeOffset? ArchivedAtUtc,
    QuoteRequestBriefDto Brief,
    IReadOnlyList<QuoteRequestTargetDto> Targets);

/// <summary>
/// Buyer-facing brief snapshot shared with selected conveyancers.
/// </summary>
public sealed record QuoteRequestBriefDto(
    string Summary,
    IReadOnlyList<string> TopConcerns,
    IReadOnlyList<string> ConveyancerQuestions);

/// <summary>
/// Target conveyancer detail row.
/// </summary>
public sealed record QuoteRequestTargetDto(
    Guid Id,
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
    DateTimeOffset? SentAtUtc,
    DateTimeOffset? OpenedAtUtc,
    DateTimeOffset? RespondedAtUtc,
    string? DeliveryError,
    QuoteRequestResponseDto? Response,
    QuoteRequestTargetDocumentAccessDto DocumentAccess);

/// <summary>
/// Buyer-facing document-access status for a selected conveyancer.
/// </summary>
public sealed record QuoteRequestTargetDocumentAccessDto(
    bool RequiresOtp,
    DateTimeOffset? OtpRequestedAtUtc,
    DateTimeOffset? VerifiedAtUtc,
    bool ReportDownloaded,
    int DownloadedDocumentCount,
    int TotalDocumentCount,
    DateTimeOffset? LastDownloadedAtUtc);

/// <summary>
/// Structured quote reply captured from the conveyancer portal.
/// </summary>
public sealed record QuoteRequestResponseDto(
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
    DateTimeOffset SubmittedAtUtc);

/// <summary>
/// Shared review document visible to a secure-link conveyancer when document access is enabled.
/// </summary>
public sealed record QuoteRequestSharedDocumentDto(
    Guid Id,
    string FileName,
    string ContentType,
    string DocType,
    DateTimeOffset UploadedAtUtc);

/// <summary>
/// Public token-scoped response page payload.
/// </summary>
public sealed record PublicQuoteRequestViewDto(
    string ConveyancerDisplayName,
    string PropertyAddress,
    string StateOrTerritory,
    string ServiceNeed,
    string Summary,
    IReadOnlyList<string> TopConcerns,
    IReadOnlyList<string> ConveyancerQuestions,
    bool ShareReportPdf,
    IReadOnlyList<QuoteRequestSharedDocumentDto> SharedDocuments,
    QuoteRequestPublicDocumentAccessDto DocumentAccess,
    bool CanRespond,
    DateTimeOffset ExpiresAtUtc,
    QuoteRequestResponseDto? ExistingResponse);

/// <summary>
/// Token-scoped document-access state for the conveyancer response portal.
/// </summary>
public sealed record QuoteRequestPublicDocumentAccessDto(
    bool RequiresOtp,
    bool IsUnlocked,
    DateTimeOffset? OtpRequestedAtUtc,
    DateTimeOffset? OtpExpiresAtUtc,
    DateTimeOffset? VerifiedAtUtc,
    DateTimeOffset? SessionExpiresAtUtc,
    bool ReportDownloaded,
    int DownloadedDocumentCount,
    int TotalDocumentCount,
    DateTimeOffset? LastDownloadedAtUtc);

/// <summary>
/// Response returned when an OTP email is sent for secure document access.
/// </summary>
public sealed record RequestPublicQuoteRequestDocumentAccessOtpResponse(
    DateTimeOffset RequestedAtUtc,
    DateTimeOffset ExpiresAtUtc);

/// <summary>
/// Payload used to verify an OTP for secure document access.
/// </summary>
public sealed record VerifyPublicQuoteRequestDocumentAccessOtpRequest(string Code);

/// <summary>
/// Response returned when document access is unlocked after OTP verification.
/// </summary>
public sealed record VerifyPublicQuoteRequestDocumentAccessOtpResponse(
    string DocumentAccessToken,
    DateTimeOffset ExpiresAtUtc);

/// <summary>
/// Response returned after a conveyancer unsubscribes from future quote emails.
/// </summary>
public sealed record UnsubscribePublicQuoteRequestConveyancerResponse(
    string ConveyancerDisplayName,
    bool QuoteRequestsEnabled,
    DateTimeOffset? QuoteRequestsDisabledAtUtc);

/// <summary>
/// Public quote-response submission payload.
/// </summary>
public sealed record SubmitPublicQuoteRequestResponse(
    string ResponderName,
    string ResponderEmail,
    string? ResponderPhone,
    decimal ProfessionalFeeAud,
    bool IncludesGst,
    decimal? DisbursementsEstimateAud,
    int? TurnaroundBusinessDays,
    string ScopeNotes,
    IReadOnlyList<string> ExcludedItems,
    DateTimeOffset? ValidUntilUtc);

/// <summary>
/// Request payload for archiving or restoring a user-owned quote workflow.
/// </summary>
public sealed record SetQuoteRequestArchiveStatusRequest(bool Archived);

/// <summary>
/// Archive-state response for a user-owned quote workflow.
/// </summary>
public sealed record QuoteRequestArchiveStatusDto(
    Guid QuoteRequestId,
    DateTimeOffset? ArchivedAtUtc);

/// <summary>
/// Response returned after permanently deleting a user-owned quote workflow.
/// </summary>
public sealed record DeleteQuoteRequestResponse(
    Guid QuoteRequestId,
    bool Deleted);
