using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using ErrorOr;
using MediatR;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Configuration.EnabledStates;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Application.Reviews.Contracts;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Configuration;
using ConveyMate.Api.Domain.Reviews;
using Stripe;

namespace ConveyMate.Api.Application.Reviews;

public sealed record CreateReviewCommand(ClaimsPrincipal Principal, CreateReviewRequest Request) : IRequest<ErrorOr<CreateReviewResponse>>;
public sealed record FinalizeReviewUploadsCommand(ClaimsPrincipal Principal, Guid JobId, FinalizeReviewUploadsRequest Request) : IRequest<ErrorOr<ReviewDetailDto>>;
public sealed record CreateReviewPaymentCommand(ClaimsPrincipal Principal, Guid JobId) : IRequest<ErrorOr<CreateReviewPaymentResponse>>;
public sealed record AcknowledgeReviewDisclaimerCommand(
    ClaimsPrincipal Principal,
    Guid JobId,
    AcknowledgeReviewDisclaimerRequest Request) : IRequest<ErrorOr<ReviewDisclaimerAcknowledgementDto>>;
public sealed record ConfirmReviewPaymentCommand(ClaimsPrincipal Principal, Guid JobId) : IRequest<ErrorOr<ReviewDetailDto>>;
public sealed record HandleStripeWebhookCommand(string Payload, string SignatureHeader) : IRequest<ErrorOr<StripeWebhookHandleResult>>;
public sealed record ListReviewsQuery(ClaimsPrincipal Principal, bool IncludeArchived) : IRequest<ErrorOr<IReadOnlyList<ReviewSummaryDto>>>;
public sealed record GetReviewQuery(ClaimsPrincipal Principal, Guid JobId) : IRequest<ErrorOr<ReviewDetailDto>>;
public sealed record GetReviewPipelineModelQuery() : IRequest<ErrorOr<ReviewPipelineModelDto>>;
public sealed record ListReviewProgressEventsQuery(
    ClaimsPrincipal Principal,
    Guid JobId,
    DateTimeOffset? SinceUtc,
    int Limit) : IRequest<ErrorOr<IReadOnlyList<ReviewProgressEventDto>>>;
public sealed record GetReviewDownloadQuery(ClaimsPrincipal Principal, Guid JobId) : IRequest<ErrorOr<ReviewDownloadUrlResponse>>;
public sealed record SetReviewArchiveStatusCommand(
    ClaimsPrincipal Principal,
    Guid JobId,
    SetReviewArchiveStatusRequest Request) : IRequest<ErrorOr<ReviewArchiveStatusDto>>;
public sealed record DeleteReviewJobCommand(ClaimsPrincipal Principal, Guid JobId) : IRequest<ErrorOr<DeleteReviewJobResponse>>;

/// <summary>
/// Creates review jobs and issues S3 upload targets.
/// </summary>
public interface ICreateReviewCommandHandler
{
    Task<CreateReviewResponse> HandleAsync(ClaimsPrincipal principal, CreateReviewRequest request, CancellationToken cancellationToken);
}

/// <summary>
/// Persists uploaded file metadata and transitions jobs to payment-ready state.
/// </summary>
public interface IFinalizeReviewUploadsCommandHandler
{
    Task<ReviewDetailDto> HandleAsync(ClaimsPrincipal principal, Guid jobId, FinalizeReviewUploadsRequest request, CancellationToken cancellationToken);
}

/// <summary>
/// Creates Stripe PaymentIntents and binds them to review jobs.
/// </summary>
public interface ICreateReviewPaymentCommandHandler
{
    Task<CreateReviewPaymentResponse> HandleAsync(ClaimsPrincipal principal, Guid jobId, CancellationToken cancellationToken);
}

/// <summary>
/// Records disclaimer acknowledgement before payment setup is allowed.
/// </summary>
public interface IAcknowledgeReviewDisclaimerCommandHandler
{
    Task<ReviewDisclaimerAcknowledgementDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        AcknowledgeReviewDisclaimerRequest request,
        CancellationToken cancellationToken);
}

/// <summary>
/// Confirms Stripe payment status and marks the job queued for processing when paid.
/// </summary>
public interface IConfirmReviewPaymentCommandHandler
{
    Task<ReviewDetailDto> HandleAsync(ClaimsPrincipal principal, Guid jobId, CancellationToken cancellationToken);
}

/// <summary>
/// Processes Stripe webhooks and marks paid jobs queued for background processing.
/// </summary>
public interface IHandleStripeWebhookCommandHandler
{
    Task<StripeWebhookHandleResult> HandleAsync(string payload, string signatureHeader, CancellationToken cancellationToken);
}

/// <summary>
/// Lists review jobs for the authenticated user.
/// </summary>
public interface IListReviewsQueryHandler
{
    Task<IReadOnlyList<ReviewSummaryDto>> HandleAsync(ClaimsPrincipal principal, bool includeArchived, CancellationToken cancellationToken);
}

/// <summary>
/// Returns full review details for a user-owned job.
/// </summary>
public interface IGetReviewQueryHandler
{
    Task<ReviewDetailDto?> HandleAsync(ClaimsPrincipal principal, Guid jobId, CancellationToken cancellationToken);
}

/// <summary>
/// Produces a presigned report download URL for completed reviews.
/// </summary>
public interface IGetReviewDownloadQueryHandler
{
    Task<ReviewDownloadUrlResponse?> HandleAsync(ClaimsPrincipal principal, Guid jobId, CancellationToken cancellationToken);
}

/// <summary>
/// Returns a source-of-truth pipeline step model for frontend rendering.
/// </summary>
public interface IGetReviewPipelineModelQueryHandler
{
    ReviewPipelineModelDto Handle();
}

/// <summary>
/// Lists persisted progress events for live activity feeds.
/// </summary>
public interface IListReviewProgressEventsQueryHandler
{
    Task<IReadOnlyList<ReviewProgressEventDto>> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        DateTimeOffset? sinceUtc,
        int limit,
        CancellationToken cancellationToken);
}

/// <summary>
/// Outcome for Stripe webhook processing.
/// </summary>
public sealed record StripeWebhookHandleResult(bool IsProcessed, string Message);

public sealed class CreateReviewCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository,
    IReviewStorageService reviewStorageService,
    IEnabledStatesProvider enabledStatesProvider,
    IAuditTrail auditTrail)
    : ICreateReviewCommandHandler,
      IRequestHandler<CreateReviewCommand, ErrorOr<CreateReviewResponse>>
{
    private const decimal MaxReasonablePriceAud = 100_000_000m;

    private static readonly HashSet<string> SupportedJurisdictions =
    [
        "ACT", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT"
    ];

    private static readonly HashSet<string> SupportedTenureTypes =
    [
        "Torrens", "Strata", "Community", "Leasehold", "CompanyTitle", "Unknown"
    ];

    private static readonly HashSet<string> SupportedPackTypes =
    [
        "standard", "auction", "strata", "off-the-plan", "rural", "unknown"
    ];

    public async Task<CreateReviewResponse> HandleAsync(
        ClaimsPrincipal principal,
        CreateReviewRequest request,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);

        if (string.IsNullOrWhiteSpace(request.PropertyAddress))
        {
            throw new InvalidOperationException("Property address is required.");
        }

        if (request.Files.Count == 0)
        {
            throw new InvalidOperationException("At least one document must be supplied.");
        }

        if (request.Files.Count > ReviewUploadLimits.MaxDocumentsPerReview)
        {
            throw new InvalidOperationException($"You can upload up to {ReviewUploadLimits.MaxDocumentsPerReview} PDF files per review.");
        }

        var unsupportedFiles = request.Files
            .Where(file => !IsPdfDocument(file.FileName, file.ContentType))
            .Select(file => string.IsNullOrWhiteSpace(file.FileName) ? "<unnamed>" : file.FileName.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (unsupportedFiles.Length > 0)
        {
            throw new InvalidOperationException($"Only PDF files are supported right now. Unsupported files: {string.Join(", ", unsupportedFiles)}.");
        }

        var oversizedFiles = request.Files
            .Where(file => file.SizeBytes <= 0 || file.SizeBytes > ReviewUploadLimits.MaxDocumentSizeBytes)
            .Select(file => string.IsNullOrWhiteSpace(file.FileName) ? "<unnamed>" : file.FileName.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (oversizedFiles.Length > 0)
        {
            throw new InvalidOperationException(
                $"Each PDF must be larger than 0 bytes and {ReviewUploadLimits.MaxDocumentSizeLabel} or smaller. Invalid files: {string.Join(", ", oversizedFiles)}.");
        }

        var stateOrTerritory = NormalizeJurisdiction(request.StateOrTerritory);
        if (!enabledStatesProvider.IsStateEnabled(stateOrTerritory))
        {
            throw new InvalidOperationException(
                $"Reviews for {stateOrTerritory} are not enabled yet. Select a jurisdiction marked as available.");
        }

        var propertyTenureType = NormalizePropertyTenureType(request.PropertyTenureType);
        var packType = NormalizePackType(request.PackType);
        var buyerContext = NormalizeBuyerContext(request.BuyerContext);
        var buyerContextJson = buyerContext is null
            ? null
            : JsonSerializer.Serialize(buyerContext);

        var jobId = Guid.NewGuid();
        var progressJson = ReviewProgress.BuildJson(0, ReviewJobStatus.AwaitingUpload, "Awaiting upload preparation.");

        await reviewJobRepository.CreateJobAsync(
            jobId,
            user.Id,
            request.PropertyAddress.Trim(),
            string.IsNullOrWhiteSpace(request.BuyerType) ? "owner-occupier" : request.BuyerType.Trim(),
            buyerContextJson,
            stateOrTerritory,
            NormalizeLga(request.LocalGovernmentArea),
            propertyTenureType,
            packType,
            ReviewJobStatus.AwaitingUpload,
            ReviewPaymentStatus.Unpaid,
            progressJson,
            cancellationToken);

        var normalizedPropertyAddress = request.PropertyAddress.Trim();
        var normalizedBuyerType = string.IsNullOrWhiteSpace(request.BuyerType) ? "owner-occupier" : request.BuyerType.Trim();

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                user,
                "review.started",
                "Start report",
                $"Started a new report for {normalizedPropertyAddress}.",
                entityType: "review-job",
                entityId: jobId.ToString(),
                entityLabel: normalizedPropertyAddress,
                metadata: new
                {
                    buyerType = normalizedBuyerType,
                    stateOrTerritory,
                    propertyTenureType,
                    packType,
                    documentCount = request.Files.Count
                }),
            cancellationToken);

        var uploads = request.Files
            .Select(file =>
            {
                var documentId = Guid.NewGuid();
                var safeName = ToSafeFileName(file.FileName);
                var s3Key = $"raw/{user.Id}/{jobId}/{documentId}-{safeName}";
                var contentType = NormalizePdfContentType(file.FileName, file.ContentType);
                var (url, expiresAtUtc) = reviewStorageService.CreateUploadUrl(s3Key, contentType);
                return new ReviewUploadTargetDto(
                    documentId,
                    file.FileName,
                    contentType,
                    s3Key,
                    url,
                    expiresAtUtc);
            })
            .ToArray();

        return new CreateReviewResponse(jobId, ReviewJobStatus.AwaitingUpload, ReviewPaymentStatus.Unpaid, uploads);
    }

    private static string NormalizeJurisdiction(string value)
    {
        var normalized = (value ?? string.Empty).Trim().ToUpperInvariant();
        return SupportedJurisdictions.Contains(normalized) ? normalized : "ACT";
    }

    private static string? NormalizeLga(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Trim();
    }

    private static string NormalizePropertyTenureType(string value)
    {
        var normalized = (value ?? string.Empty).Trim();
        return SupportedTenureTypes.Contains(normalized) ? normalized : "Unknown";
    }

    private static string NormalizePackType(string value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        return SupportedPackTypes.Contains(normalized) ? normalized : "unknown";
    }

    private static string ToSafeFileName(string fileName)
    {
        var fallback = $"document-{Guid.NewGuid():N}.bin";
        if (string.IsNullOrWhiteSpace(fileName))
        {
            return fallback;
        }

        var normalized = fileName.Trim();
        normalized = Regex.Replace(normalized, @"[^a-zA-Z0-9\.\-_]+", "-");
        return string.IsNullOrWhiteSpace(normalized) ? fallback : normalized;
    }

    private static bool IsPdfDocument(string? fileName, string? contentType)
    {
        if (!string.IsNullOrWhiteSpace(contentType) &&
            string.Equals(contentType.Trim(), ReviewUploadLimits.PdfMimeType, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return !string.IsNullOrWhiteSpace(fileName) &&
               fileName.Trim().EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizePdfContentType(string? fileName, string? contentType)
    {
        if (IsPdfDocument(fileName, contentType))
        {
            return ReviewUploadLimits.PdfMimeType;
        }

        return string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim();
    }

    private static ReviewBuyerContextDto? NormalizeBuyerContext(ReviewBuyerContextDto? buyerContext)
    {
        if (buyerContext is null)
        {
            return null;
        }

        var concessionIntent = NormalizeConcessionIntent(buyerContext.ConcessionIntent);
        var contractExchanged = buyerContext.ContractExchanged;
        var agreedPriceAud = NormalizePrice(buyerContext.AgreedPriceAud, nameof(buyerContext.AgreedPriceAud));
        var estimatedPriceAud = NormalizePrice(buyerContext.EstimatedPriceAud, nameof(buyerContext.EstimatedPriceAud));

        if (agreedPriceAud.HasValue && estimatedPriceAud.HasValue)
        {
            throw new InvalidOperationException("Buyer context cannot include both agreed and estimated prices.");
        }

        if (contractExchanged == true)
        {
            if (!agreedPriceAud.HasValue)
            {
                throw new InvalidOperationException("Agreed purchase price is required when contractExchanged is true.");
            }

            if (estimatedPriceAud.HasValue)
            {
                throw new InvalidOperationException("Estimated price must be null when contractExchanged is true.");
            }
        }

        if (contractExchanged == false && agreedPriceAud.HasValue)
        {
            throw new InvalidOperationException("Agreed purchase price must be null when contractExchanged is false.");
        }

        return new ReviewBuyerContextDto(
            buyerContext.IsFirstHomeBuyer,
            concessionIntent,
            contractExchanged,
            agreedPriceAud,
            estimatedPriceAud);
    }

    private static string NormalizeConcessionIntent(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        return normalized is "yes" or "no" or "unsure" ? normalized : "unsure";
    }

    private static decimal? NormalizePrice(decimal? value, string label)
    {
        if (!value.HasValue)
        {
            return null;
        }

        if (value.Value <= 0)
        {
            throw new InvalidOperationException($"{label} must be a positive amount.");
        }

        if (value.Value > MaxReasonablePriceAud)
        {
            throw new InvalidOperationException($"{label} exceeds the supported maximum.");
        }

        return decimal.Round(value.Value, 2, MidpointRounding.AwayFromZero);
    }

    public Task<ErrorOr<CreateReviewResponse>> Handle(CreateReviewCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.Request, cancellationToken));
    }
}

public sealed class FinalizeReviewUploadsCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository,
    IReviewStorageService reviewStorageService,
    IAuditTrail auditTrail)
    : IFinalizeReviewUploadsCommandHandler,
      IRequestHandler<FinalizeReviewUploadsCommand, ErrorOr<ReviewDetailDto>>
{
    public async Task<ReviewDetailDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        FinalizeReviewUploadsRequest request,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var job = await reviewJobRepository.GetJobForUserAsync(jobId, user.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Review job was not found.");

        if (request.Documents.Count == 0)
        {
            throw new InvalidOperationException("No uploaded documents were provided.");
        }

        if (request.Documents.Count > ReviewUploadLimits.MaxDocumentsPerReview)
        {
            throw new InvalidOperationException($"You can upload up to {ReviewUploadLimits.MaxDocumentsPerReview} PDF files per review.");
        }

        var unsupportedFiles = request.Documents
            .Where(document => !IsPdfDocument(document.FileName, document.ContentType))
            .Select(document => string.IsNullOrWhiteSpace(document.FileName) ? "<unnamed>" : document.FileName.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (unsupportedFiles.Length > 0)
        {
            throw new InvalidOperationException($"Only PDF files are supported right now. Unsupported files: {string.Join(", ", unsupportedFiles)}.");
        }

        var filesMissingFromStorage = new List<string>();
        var oversizedFiles = new List<string>();
        foreach (var document in request.Documents)
        {
            var metadata = await reviewStorageService.GetObjectMetadataAsync(document.S3KeyRaw, cancellationToken);
            var documentName = string.IsNullOrWhiteSpace(document.FileName) ? "<unnamed>" : document.FileName.Trim();
            if (metadata is null)
            {
                filesMissingFromStorage.Add(documentName);
                continue;
            }

            if (metadata.SizeBytes <= 0 || metadata.SizeBytes > ReviewUploadLimits.MaxDocumentSizeBytes)
            {
                oversizedFiles.Add(documentName);
            }
        }

        if (filesMissingFromStorage.Count > 0)
        {
            throw new InvalidOperationException(
                $"One or more uploaded files could not be verified in secure storage. Re-upload: {string.Join(", ", filesMissingFromStorage.Distinct(StringComparer.OrdinalIgnoreCase))}.");
        }

        if (oversizedFiles.Count > 0)
        {
            await TryDeleteSubmittedObjectsAsync(request.Documents, cancellationToken);
            throw new InvalidOperationException(
                $"Each PDF must be larger than 0 bytes and {ReviewUploadLimits.MaxDocumentSizeLabel} or smaller. Re-upload: {string.Join(", ", oversizedFiles.Distinct(StringComparer.OrdinalIgnoreCase))}.");
        }

        var now = DateTimeOffset.UtcNow;
        var documents = request.Documents.Select(document => new ReviewDocumentRecord(
            document.DocumentId,
            jobId,
            user.Id,
            document.S3KeyRaw,
            document.FileName,
            NormalizePdfContentType(document.FileName, document.ContentType),
            InferDocType(document.FileName, document.ContentType),
            now)).ToArray();

        await reviewJobRepository.SaveUploadedDocumentsAsync(jobId, user.Id, documents, cancellationToken);
        await reviewJobRepository.TransitionToAwaitingPaymentAsync(jobId, user.Id, cancellationToken);

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                user,
                "review.uploads_finalized",
                "Finalize uploads",
                $"Finalized {documents.Length} uploaded document{(documents.Length == 1 ? string.Empty : "s")} for {job.PropertyAddress}.",
                entityType: "review-job",
                entityId: jobId.ToString(),
                entityLabel: job.PropertyAddress,
                metadata: new
                {
                    documentCount = documents.Length,
                    docTypes = documents.Select(document => document.DocType).Distinct(StringComparer.OrdinalIgnoreCase).ToArray()
                }),
            cancellationToken);

        var updated = await reviewJobRepository.GetJobForUserAsync(jobId, user.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Review job was not found after upload finalization.");

        return ReviewDetailMapper.ToDetailDto(updated);
    }

    private static string InferDocType(string fileName, string contentType)
    {
        var normalized = $"{fileName} {contentType}".ToLowerInvariant();
        if (normalized.Contains("strata", StringComparison.Ordinal))
        {
            return "strata-pack";
        }
        if (normalized.Contains("title", StringComparison.Ordinal))
        {
            return "title-search";
        }
        if (normalized.Contains("contract", StringComparison.Ordinal))
        {
            return "contract";
        }
        if (normalized.Contains("disclosure", StringComparison.Ordinal))
        {
            return "disclosure";
        }

        return "unknown";
    }

    private static bool IsPdfDocument(string? fileName, string? contentType)
    {
        if (!string.IsNullOrWhiteSpace(contentType) &&
            string.Equals(contentType.Trim(), ReviewUploadLimits.PdfMimeType, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return !string.IsNullOrWhiteSpace(fileName) &&
               fileName.Trim().EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizePdfContentType(string? fileName, string? contentType)
    {
        if (IsPdfDocument(fileName, contentType))
        {
            return ReviewUploadLimits.PdfMimeType;
        }

        return string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim();
    }

    private async Task TryDeleteSubmittedObjectsAsync(
        IReadOnlyList<FinalizeReviewDocumentRequest> documents,
        CancellationToken cancellationToken)
    {
        var submittedKeys = documents
            .Select(document => document.S3KeyRaw)
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Select(key => key.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (submittedKeys.Length == 0)
        {
            return;
        }

        try
        {
            await reviewStorageService.DeleteObjectsAsync(submittedKeys, cancellationToken);
        }
        catch
        {
            // Best-effort cleanup only. The upload limit failure should remain the primary error surfaced to callers.
        }
    }

    public Task<ErrorOr<ReviewDetailDto>> Handle(FinalizeReviewUploadsCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(
            request.Principal,
            request.JobId,
            request.Request,
            cancellationToken));
    }
}

public sealed class CreateReviewPaymentCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository,
    IStripePaymentService stripePaymentService,
    IAuditTrail auditTrail)
    : ICreateReviewPaymentCommandHandler,
      IRequestHandler<CreateReviewPaymentCommand, ErrorOr<CreateReviewPaymentResponse>>
{
    public async Task<CreateReviewPaymentResponse> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var job = await reviewJobRepository.GetJobForUserAsync(jobId, user.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Review job was not found.");

        var documentCount = await reviewJobRepository.CountDocumentsAsync(jobId, user.Id, cancellationToken);
        if (documentCount == 0)
        {
            throw new InvalidOperationException("Upload at least one document before payment.");
        }

        if (job.DisclaimerAcceptedAtUtc is null || string.IsNullOrWhiteSpace(job.DisclaimerVersion))
        {
            throw new InvalidOperationException("Acknowledge the disclaimer before payment.");
        }

        if (!string.Equals(job.DisclaimerVersion, ReviewPipelineCatalog.CurrentDisclaimerVersion, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Disclaimer terms were updated. Please acknowledge the latest disclaimer before payment.");
        }

        if (!string.Equals(job.Status, ReviewJobStatus.AwaitingPayment, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("This review is not awaiting payment.");
        }

        if (string.Equals(job.PaymentStatus, ReviewPaymentStatus.Paid, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("This review has already been paid.");
        }

        var paymentIntent = await stripePaymentService.CreateOrGetPaymentIntentAsync(
            job.StripePaymentIntentId,
            job.Id,
            user.Id,
            user.Email,
            user.FullName,
            cancellationToken);

        await reviewJobRepository.SetPaymentIntentAsync(
            job.Id,
            user.Id,
            paymentIntent.PaymentIntentId,
            paymentIntent.AmountAudCents,
            cancellationToken);

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                user,
                "review.payment_intent_created",
                "Create payment",
                $"Created a payment intent for {job.PropertyAddress}.",
                entityType: "review-job",
                entityId: job.Id.ToString(),
                entityLabel: job.PropertyAddress,
                metadata: new
                {
                    paymentIntentId = paymentIntent.PaymentIntentId,
                    amountAudCents = paymentIntent.AmountAudCents
                }),
            cancellationToken);

        return new CreateReviewPaymentResponse(
            paymentIntent.PaymentIntentId,
            paymentIntent.ClientSecret,
            paymentIntent.AmountAudCents,
            paymentIntent.Currency);
    }

    public Task<ErrorOr<CreateReviewPaymentResponse>> Handle(CreateReviewPaymentCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.JobId, cancellationToken));
    }
}

public sealed class AcknowledgeReviewDisclaimerCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository,
    IAuditTrail auditTrail)
    : IAcknowledgeReviewDisclaimerCommandHandler,
      IRequestHandler<AcknowledgeReviewDisclaimerCommand, ErrorOr<ReviewDisclaimerAcknowledgementDto>>
{
    public async Task<ReviewDisclaimerAcknowledgementDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        AcknowledgeReviewDisclaimerRequest request,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var version = string.IsNullOrWhiteSpace(request.DisclaimerVersion)
            ? ReviewPipelineCatalog.CurrentDisclaimerVersion
            : request.DisclaimerVersion.Trim();

        var acceptance = await reviewJobRepository.RecordDisclaimerAcceptanceAsync(
            jobId,
            user.Id,
            version,
            cancellationToken);

        if (acceptance is null)
        {
            throw new KeyNotFoundException("Review job was not found.");
        }

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                user,
                "review.disclaimer_acknowledged",
                "Acknowledge disclaimer",
                $"Accepted disclaimer {acceptance.DisclaimerVersion}.",
                entityType: "review-job",
                entityId: jobId.ToString(),
                entityLabel: $"Review {jobId}",
                metadata: new
                {
                    acceptance.DisclaimerVersion
                }),
            cancellationToken);

        return new ReviewDisclaimerAcknowledgementDto(
            acceptance.JobId,
            acceptance.DisclaimerVersion,
            acceptance.AcceptedAtUtc);
    }

    public Task<ErrorOr<ReviewDisclaimerAcknowledgementDto>> Handle(
        AcknowledgeReviewDisclaimerCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(
            request.Principal,
            request.JobId,
            request.Request,
            cancellationToken));
    }
}

public sealed class ConfirmReviewPaymentCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository,
    IStripePaymentService stripePaymentService,
    IAuditTrail auditTrail)
    : IConfirmReviewPaymentCommandHandler,
      IRequestHandler<ConfirmReviewPaymentCommand, ErrorOr<ReviewDetailDto>>
{
    public async Task<ReviewDetailDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var job = await reviewJobRepository.GetJobForUserAsync(jobId, user.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Review job was not found.");

        if (string.IsNullOrWhiteSpace(job.StripePaymentIntentId))
        {
            throw new InvalidOperationException("Payment intent was not created for this review.");
        }

        var paymentStatus = await stripePaymentService.GetPaymentIntentStatusAsync(job.StripePaymentIntentId, cancellationToken);
        if (!paymentStatus.IsSucceeded)
        {
            throw new InvalidOperationException(
                $"Payment is not confirmed yet. Current Stripe status is '{paymentStatus.Status}'.");
        }

        var transition = await reviewJobRepository.MarkPaidAndQueuedAsync(paymentStatus.PaymentIntentId, cancellationToken)
            ?? throw new InvalidOperationException("No review job mapping exists for the payment intent.");

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                user,
                "review.payment_confirmed",
                "Confirm payment",
                $"Confirmed payment for {job.PropertyAddress}.",
                entityType: "review-job",
                entityId: transition.JobId.ToString(),
                entityLabel: job.PropertyAddress,
                metadata: new
                {
                    paymentIntentId = paymentStatus.PaymentIntentId,
                    queued = transition.WasQueued
                }),
            cancellationToken);

        var updated = await reviewJobRepository.GetJobForUserAsync(jobId, user.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Review job was not found after payment confirmation.");

        return ReviewDetailMapper.ToDetailDto(updated);

    }

    public Task<ErrorOr<ReviewDetailDto>> Handle(ConfirmReviewPaymentCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.JobId, cancellationToken));
    }
}

public sealed class HandleStripeWebhookCommandHandler(
    IReviewJobRepository reviewJobRepository,
    Microsoft.Extensions.Options.IOptions<StripeOptions> stripeOptions)
    : IHandleStripeWebhookCommandHandler,
      IRequestHandler<HandleStripeWebhookCommand, ErrorOr<StripeWebhookHandleResult>>
{
    public async Task<StripeWebhookHandleResult> HandleAsync(string payload, string signatureHeader, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(signatureHeader))
        {
            throw new InvalidOperationException("Stripe signature header is missing.");
        }

        if (string.IsNullOrWhiteSpace(stripeOptions.Value.WebhookSecret))
        {
            throw new InvalidOperationException(
                "Stripe webhook secret is not configured. Set /conveymate/dev/stripe/webhookSecret in SSM (or Stripe:WebhookSecret in appsettings for local fallback).");
        }

        var stripeEvent = EventUtility.ConstructEvent(payload, signatureHeader, stripeOptions.Value.WebhookSecret);
        if (!string.Equals(stripeEvent.Type, EventTypes.PaymentIntentSucceeded, StringComparison.Ordinal))
        {
            return new StripeWebhookHandleResult(false, $"Event {stripeEvent.Type} ignored.");
        }

        var paymentIntent = stripeEvent.Data.Object as PaymentIntent
            ?? throw new InvalidOperationException("Webhook payload did not include a PaymentIntent object.");

        var paymentIntentId = paymentIntent.Id;
        if (string.IsNullOrWhiteSpace(paymentIntentId))
        {
            throw new InvalidOperationException("PaymentIntent id was missing.");
        }

        var expectedAmountCents = (long)stripeOptions.Value.PriceAudCents;
        if (paymentIntent.Amount != expectedAmountCents)
        {
            throw new InvalidOperationException(
                $"PaymentIntent amount {paymentIntent.Amount} does not match expected {expectedAmountCents} cents. Possible price misconfiguration or tampered event.");
        }

        var eventId = stripeEvent.Id ?? paymentIntentId;
        var registered = await reviewJobRepository.RegisterWebhookEventAsync(
            eventId,
            paymentIntentId,
            stripeEvent.Type,
            cancellationToken);

        if (!registered)
        {
            return new StripeWebhookHandleResult(true, "Duplicate webhook event ignored.");
        }

        var transition = await reviewJobRepository.MarkPaidAndQueuedAsync(paymentIntentId, cancellationToken);
        if (transition is null)
        {
            return new StripeWebhookHandleResult(false, "No matching review job was found for PaymentIntent.");
        }

        return new StripeWebhookHandleResult(true, transition.WasQueued ? "Job queued." : "Payment already processed.");
    }

    public Task<ErrorOr<StripeWebhookHandleResult>> Handle(HandleStripeWebhookCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Payload, request.SignatureHeader, cancellationToken));
    }
}

public sealed class ListReviewsQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository)
    : IListReviewsQueryHandler,
      IRequestHandler<ListReviewsQuery, ErrorOr<IReadOnlyList<ReviewSummaryDto>>>
{
    public async Task<IReadOnlyList<ReviewSummaryDto>> HandleAsync(
        ClaimsPrincipal principal,
        bool includeArchived,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var jobs = await reviewJobRepository.ListJobsForUserAsync(user.Id, includeArchived, cancellationToken);

        return jobs
            .Select(job =>
            {
                var (percent, currentStep, currentSubStep, lastUpdatedUtc) = ReviewProgress.Read(job.ProgressJson, job.Status);
                return new ReviewSummaryDto(
                    job.Id,
                    job.PropertyAddress,
                    job.BuyerType,
                    job.StateOrTerritory,
                    job.Status,
                    job.PaymentStatus,
                    job.CreatedAt,
                    job.UpdatedAt,
                    percent,
                    currentStep,
                    currentSubStep,
                    lastUpdatedUtc,
                    job.ArchivedAtUtc);
            })
            .ToArray();
    }

    public Task<ErrorOr<IReadOnlyList<ReviewSummaryDto>>> Handle(ListReviewsQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.IncludeArchived, cancellationToken));
    }
}

public sealed class GetReviewQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository)
    : IGetReviewQueryHandler,
      IRequestHandler<GetReviewQuery, ErrorOr<ReviewDetailDto>>
{
    public async Task<ReviewDetailDto?> HandleAsync(ClaimsPrincipal principal, Guid jobId, CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var job = await reviewJobRepository.GetJobForUserAsync(jobId, user.Id, cancellationToken);
        if (job is null)
        {
            return null;
        }

        return ReviewDetailMapper.ToDetailDto(job);
    }

    public async Task<ErrorOr<ReviewDetailDto>> Handle(GetReviewQuery request, CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.JobId, cancellationToken));
        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Review job was not found.")
            : result.Value;
    }
}

public sealed class SetReviewArchiveStatusCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository)
    : IRequestHandler<SetReviewArchiveStatusCommand, ErrorOr<ReviewArchiveStatusDto>>
{
    public Task<ErrorOr<ReviewArchiveStatusDto>> Handle(SetReviewArchiveStatusCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.JobId, request.Request, cancellationToken));
    }

    private async Task<ReviewArchiveStatusDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        SetReviewArchiveStatusRequest request,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var updated = await reviewJobRepository.SetArchivedAsync(jobId, user.Id, request.Archived, cancellationToken)
            ?? throw new KeyNotFoundException("Review job was not found.");

        return new ReviewArchiveStatusDto(updated.JobId, updated.ArchivedAtUtc);
    }
}

public sealed class DeleteReviewJobCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository,
    IReviewStorageService reviewStorageService,
    ILogger<DeleteReviewJobCommandHandler> logger)
    : IRequestHandler<DeleteReviewJobCommand, ErrorOr<DeleteReviewJobResponse>>
{
    public Task<ErrorOr<DeleteReviewJobResponse>> Handle(DeleteReviewJobCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.JobId, cancellationToken));
    }

    private async Task<DeleteReviewJobResponse> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var deleteCandidate = await reviewJobRepository.GetDeleteCandidateForUserAsync(jobId, user.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Review job was not found.");

        var deleted = await reviewJobRepository.DeleteJobForUserAsync(jobId, user.Id, cancellationToken);
        if (!deleted)
        {
            throw new KeyNotFoundException("Review job was not found.");
        }

        var storageKeys = BuildStorageKeys(deleteCandidate);
        if (storageKeys.Count > 0)
        {
            try
            {
                await reviewStorageService.DeleteObjectsAsync(storageKeys, cancellationToken);
            }
            catch (Exception error)
            {
                logger.LogWarning(
                    error,
                    "User deleted review job {JobId} but one or more storage objects could not be deleted.",
                    jobId);
            }
        }

        return new DeleteReviewJobResponse(jobId, true, storageKeys.Count);
    }

    private static IReadOnlyList<string> BuildStorageKeys(ReviewJobDeleteCandidateRecord deleteCandidate)
    {
        var storageKeys = new HashSet<string>(StringComparer.Ordinal);

        if (!string.IsNullOrWhiteSpace(deleteCandidate.ReportPdfS3Key))
        {
            storageKeys.Add(deleteCandidate.ReportPdfS3Key.Trim());
        }

        if (!string.IsNullOrWhiteSpace(deleteCandidate.ReportJsonS3Key))
        {
            storageKeys.Add(deleteCandidate.ReportJsonS3Key.Trim());
        }

        foreach (var key in deleteCandidate.UploadedDocumentS3Keys)
        {
            if (!string.IsNullOrWhiteSpace(key))
            {
                storageKeys.Add(key.Trim());
            }
        }

        return storageKeys.ToArray();
    }
}

internal static class ReviewDetailMapper
{
    public static ReviewDetailDto ToDetailDto(ReviewJobRecord job)
    {
        var (percent, currentStep, currentSubStep, lastUpdatedUtc) = ReviewProgress.Read(job.ProgressJson, job.Status);

        return new ReviewDetailDto(
            job.Id,
            job.PropertyAddress,
            job.BuyerType,
            ParseBuyerContext(job.BuyerContextJson),
            job.StateOrTerritory,
            job.LocalGovernmentArea,
            job.PropertyTenureType,
            job.PackType,
            job.Status,
            job.PaymentStatus,
            percent,
            currentStep,
            currentSubStep,
            lastUpdatedUtc,
            job.CreatedAt,
            job.UpdatedAt,
            job.StartedAt,
            job.CompletedAt,
            job.ErrorMessage,
            job.ReportS3Key,
            job.DisclaimerVersion,
            job.DisclaimerAcceptedAtUtc,
            ParseSummary(job.SummaryJson),
            job.ArchivedAtUtc);
    }

    private static ReviewBuyerContextDto? ParseBuyerContext(string? buyerContextJson)
    {
        if (string.IsNullOrWhiteSpace(buyerContextJson))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<ReviewBuyerContextDto>(buyerContextJson);
        }
        catch
        {
            return null;
        }
    }

    private static object? ParseSummary(string? summaryJson)
    {
        if (string.IsNullOrWhiteSpace(summaryJson))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<object>(summaryJson);
        }
        catch
        {
            return null;
        }
    }
}

public sealed class GetReviewPipelineModelQueryHandler
    : IGetReviewPipelineModelQueryHandler,
      IRequestHandler<GetReviewPipelineModelQuery, ErrorOr<ReviewPipelineModelDto>>
{
    public ReviewPipelineModelDto Handle()
    {
        var steps = ReviewPipelineCatalog.Steps
            .OrderBy(stage => stage.Order)
            .Select(stage => new ReviewPipelineStepDto(
                stage.Id,
                stage.Label,
                stage.Description,
                stage.Phase,
                stage.Order,
                stage.ProgressStartPercent,
                stage.ProgressEndPercent))
            .ToArray();

        return new ReviewPipelineModelDto(
            steps,
            ReviewPipelineCatalog.TypicalDurationMinutes,
            ReviewPipelineCatalog.CurrentDisclaimerVersion);
    }

    public Task<ErrorOr<ReviewPipelineModelDto>> Handle(GetReviewPipelineModelQuery request, CancellationToken cancellationToken)
    {
        return Task.FromResult<ErrorOr<ReviewPipelineModelDto>>(Handle());
    }
}

public sealed class ListReviewProgressEventsQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository)
    : IListReviewProgressEventsQueryHandler,
      IRequestHandler<ListReviewProgressEventsQuery, ErrorOr<IReadOnlyList<ReviewProgressEventDto>>>
{
    public async Task<IReadOnlyList<ReviewProgressEventDto>> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        DateTimeOffset? sinceUtc,
        int limit,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var events = await reviewJobRepository.ListProgressEventsForUserAsync(
            jobId,
            user.Id,
            sinceUtc,
            Math.Clamp(limit, 1, 250),
            cancellationToken);

        return events
            .Select(eventRow => new ReviewProgressEventDto(
                eventRow.Id,
                eventRow.TimestampUtc,
                eventRow.StageId,
                eventRow.StageState,
                eventRow.Severity,
                eventRow.Message,
                eventRow.PercentComplete,
                eventRow.DetailCode,
                eventRow.Attempt,
                eventRow.MaxAttempts))
            .ToArray();
    }

    public Task<ErrorOr<IReadOnlyList<ReviewProgressEventDto>>> Handle(ListReviewProgressEventsQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(
            request.Principal,
            request.JobId,
            request.SinceUtc,
            request.Limit,
            cancellationToken));
    }
}

public sealed class GetReviewDownloadQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository,
    IReviewStorageService reviewStorageService,
    IAuditTrail auditTrail)
    : IGetReviewDownloadQueryHandler,
      IRequestHandler<GetReviewDownloadQuery, ErrorOr<ReviewDownloadUrlResponse>>
{
    public async Task<ReviewDownloadUrlResponse?> HandleAsync(
        ClaimsPrincipal principal,
        Guid jobId,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var job = await reviewJobRepository.GetJobForUserAsync(jobId, user.Id, cancellationToken);
        if (job is null)
        {
            return null;
        }

        if (!string.Equals(job.Status, ReviewJobStatus.Completed, StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(job.ReportS3Key))
        {
            return null;
        }

        var (url, expiresAtUtc) = reviewStorageService.CreateDownloadUrl(job.ReportS3Key);
        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                user,
                "review.download_requested",
                "Download report",
                $"Requested the completed report for {job.PropertyAddress}.",
                entityType: "review-job",
                entityId: job.Id.ToString(),
                entityLabel: job.PropertyAddress,
                metadata: new
                {
                    reportS3Key = job.ReportS3Key
                }),
            cancellationToken);

        return new ReviewDownloadUrlResponse(url, expiresAtUtc);
    }

    public async Task<ErrorOr<ReviewDownloadUrlResponse>> Handle(GetReviewDownloadQuery request, CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.JobId, cancellationToken));
        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Review report was not found.")
            : result.Value;
    }
}
