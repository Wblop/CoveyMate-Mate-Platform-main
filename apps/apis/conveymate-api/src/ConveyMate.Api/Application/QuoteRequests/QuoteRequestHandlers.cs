using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ErrorOr;
using MediatR;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Conveyancers;
using ConveyMate.Api.Application.Conveyancers.Abstractions;
using ConveyMate.Api.Application.QuoteRequests.Abstractions;
using ConveyMate.Api.Application.QuoteRequests.Contracts;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Configuration;
using ConveyMate.Api.Domain.QuoteRequests;
using ConveyMate.Api.Domain.Reviews;

namespace ConveyMate.Api.Application.QuoteRequests;

public sealed record CreateQuoteRequestFromReportCommand(
    ClaimsPrincipal Principal,
    Guid ReviewJobId,
    CreateQuoteRequestFromReportRequest Request) : IRequest<ErrorOr<QuoteRequestDetailDto>>;

public sealed record ListQuoteRequestsQuery(ClaimsPrincipal Principal, bool IncludeArchived) : IRequest<ErrorOr<IReadOnlyList<QuoteRequestSummaryDto>>>;

public sealed record GetQuoteRequestSummaryByReviewJobQuery(
    ClaimsPrincipal Principal,
    Guid ReviewJobId) : IRequest<ErrorOr<QuoteRequestSummaryDto>>;

public sealed record GetQuoteRequestQuery(ClaimsPrincipal Principal, Guid QuoteRequestId) : IRequest<ErrorOr<QuoteRequestDetailDto>>;

public sealed record GetPublicQuoteRequestQuery(
    string Token,
    string? DocumentAccessToken) : IRequest<ErrorOr<PublicQuoteRequestViewDto>>;

public sealed record RequestPublicQuoteRequestDocumentAccessOtpCommand(string Token)
    : IRequest<ErrorOr<RequestPublicQuoteRequestDocumentAccessOtpResponse>>;

public sealed record VerifyPublicQuoteRequestDocumentAccessOtpCommand(
    string Token,
    VerifyPublicQuoteRequestDocumentAccessOtpRequest Request)
    : IRequest<ErrorOr<VerifyPublicQuoteRequestDocumentAccessOtpResponse>>;

public sealed record UnsubscribePublicQuoteRequestConveyancerCommand(string Token)
    : IRequest<ErrorOr<UnsubscribePublicQuoteRequestConveyancerResponse>>;

public sealed record SetQuoteRequestArchiveStatusCommand(
    ClaimsPrincipal Principal,
    Guid QuoteRequestId,
    SetQuoteRequestArchiveStatusRequest Request) : IRequest<ErrorOr<QuoteRequestArchiveStatusDto>>;

public sealed record DeleteQuoteRequestCommand(
    ClaimsPrincipal Principal,
    Guid QuoteRequestId) : IRequest<ErrorOr<DeleteQuoteRequestResponse>>;

public sealed record SubmitPublicQuoteRequestCommand(
    string Token,
    SubmitPublicQuoteRequestResponse Request) : IRequest<ErrorOr<QuoteRequestResponseDto>>;

public sealed class CreateQuoteRequestFromReportCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IReviewJobRepository reviewJobRepository,
    IConveyancerDirectoryRepository conveyancerDirectoryRepository,
    IQuoteRequestRepository quoteRequestRepository,
    IQuoteRequestEmailSender quoteRequestEmailSender,
    IOptions<QuoteRequestEmailOptions> emailOptions,
    IOptions<ReviewPipelineOptions> pipelineOptions,
    IAuditTrail auditTrail)
    : IRequestHandler<CreateQuoteRequestFromReportCommand, ErrorOr<QuoteRequestDetailDto>>
{
    private static readonly HashSet<string> SupportedServiceNeeds =
    [
        "pre-exchange-review",
        "full-conveyancing",
        "settlement-only"
    ];

    public Task<ErrorOr<QuoteRequestDetailDto>> Handle(CreateQuoteRequestFromReportCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.ReviewJobId, request.Request, cancellationToken));
    }

    private async Task<QuoteRequestDetailDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid reviewJobId,
        CreateQuoteRequestFromReportRequest request,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var report = await reviewJobRepository.GetJobForUserAsync(reviewJobId, user.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Review job was not found.");

        if (!string.Equals(report.Status, ReviewJobStatus.Completed, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Quote requests are only available for completed reports.");
        }

        if (string.IsNullOrWhiteSpace(report.SummaryJson))
        {
            throw new InvalidOperationException("This report is not ready for conveyancer handoff yet.");
        }

        var existingRequest = await quoteRequestRepository.GetSummaryForUserByReviewJobAsync(user.Id, reviewJobId, cancellationToken);
        if (existingRequest is not null)
        {
            throw new InvalidOperationException("A quote workflow already exists for this report.");
        }

        var normalizedSelections = NormalizeSelections(request.SelectedConveyancers);
        if (normalizedSelections.Count == 0)
        {
            throw new InvalidOperationException("Select at least one conveyancer to request a quote.");
        }

        if (normalizedSelections.Count > 3)
        {
            throw new InvalidOperationException("You can request quotes from up to 3 conveyancers at a time.");
        }

        var normalizedServiceNeed = NormalizeServiceNeed(request.ServiceNeed);
        var generatedBrief = QuoteRequestMapper.BuildBrief(report.SummaryJson);
        var brief = generatedBrief with
        {
            TopConcerns = [],
            ConveyancerQuestions = NormalizeConveyancerQuestions(request.ConveyancerQuestions, generatedBrief.ConveyancerQuestions)
        };
        var briefJson = JsonSerializer.Serialize(brief, QuoteRequestMapper.JsonOptions);

        var directoryRows = await conveyancerDirectoryRepository.ListActiveByJurisdictionAsync(report.StateOrTerritory, cancellationToken);
        var conveyancersByKey = directoryRows.ToDictionary(
            row => BuildSelectionKey(row.Jurisdiction, row.RegulatorType, row.SourceIdentifier),
            row => row,
            StringComparer.OrdinalIgnoreCase);

        var targetSpecs = normalizedSelections
            .Select(selection =>
            {
                var key = BuildSelectionKey(selection.Jurisdiction, selection.RegulatorType, selection.SourceIdentifier);
                if (!conveyancersByKey.TryGetValue(key, out var record))
                {
                    throw new InvalidOperationException($"Selected conveyancer '{selection.SourceIdentifier}' is no longer available.");
                }

                if (string.IsNullOrWhiteSpace(record.Email))
                {
                    throw new InvalidOperationException($"Conveyancer '{record.Name}' does not have an email address available for quote requests.");
                }

                if (!record.QuoteRequestsEnabled)
                {
                    throw new InvalidOperationException($"Conveyancer '{record.Name}' is no longer accepting quote requests through ConveyMate.");
                }

                var token = QuoteRequestTokenCodec.GenerateRawToken();
                return new TargetSendSpec(record, token, QuoteRequestTokenCodec.ComputeHash(token));
            })
            .ToArray();

        var now = DateTimeOffset.UtcNow;
        var expiresAtUtc = now.AddHours(emailOptions.Value.RequestExpiryHours);
        var quoteRequestId = Guid.NewGuid();

        var requestRecord = new QuoteRequestCreateRecord(
            quoteRequestId,
            user.Id,
            report.Id,
            report.PropertyAddress,
            report.StateOrTerritory,
            normalizedServiceNeed,
            NormalizeNullableMessage(request.Message),
            request.ShareReportPdf,
            briefJson,
            QuoteRequestStatus.Open,
            now,
            expiresAtUtc);

        var targetRecords = targetSpecs
            .Select(spec => new QuoteRequestTargetCreateRecord(
                Guid.NewGuid(),
                quoteRequestId,
                spec.Record.Jurisdiction,
                spec.Record.RegulatorType,
                spec.Record.SourceIdentifier,
                spec.Record.Name,
                spec.Record.ContactName,
                spec.Record.OrganizationName,
                spec.Record.Email!,
                spec.Record.Phone,
                spec.Record.Website,
                spec.Record.SourceUrl,
                spec.TokenHash,
                QuoteRequestTargetStatus.Prepared,
                now))
            .ToArray();

        await quoteRequestRepository.CreateAsync(requestRecord, targetRecords, cancellationToken);

        var responseBaseUrl = pipelineOptions.Value.AppBaseUrl.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(responseBaseUrl))
        {
            throw new InvalidOperationException("ReviewPipeline:AppBaseUrl must be configured for quote-request response links.");
        }

        var targetByHash = targetRecords.ToDictionary(target => target.ResponseTokenHash, StringComparer.Ordinal);
        var deliveryUpdates = new List<QuoteRequestTargetDeliveryUpdate>(targetRecords.Length);

        for (var index = 0; index < targetSpecs.Length; index += 1)
        {
            var spec = targetSpecs[index];
            var target = targetByHash[spec.TokenHash];
            var responseUrl = $"{responseBaseUrl}/quote/respond/{Uri.EscapeDataString(spec.RawToken)}";
            var unsubscribeUrl = $"{responseBaseUrl}/quote/unsubscribe/{Uri.EscapeDataString(spec.RawToken)}";
            var emailMessage = BuildEmailMessage(
                spec.Record,
                user.FullName,
                requestRecord,
                brief,
                responseUrl,
                unsubscribeUrl,
                responseBaseUrl,
                expiresAtUtc);

            var deliveryResult = await quoteRequestEmailSender.SendAsync(emailMessage, cancellationToken);
            deliveryUpdates.Add(new QuoteRequestTargetDeliveryUpdate(
                target.Id,
                deliveryResult.IsSuccess ? QuoteRequestTargetStatus.Sent : QuoteRequestTargetStatus.DeliveryFailed,
                deliveryResult.IsSuccess ? now : null,
                deliveryResult.IsSuccess ? null : NormalizeNullableMessage(deliveryResult.ErrorMessage)));
        }

        await quoteRequestRepository.ApplyDeliveryUpdatesAsync(quoteRequestId, deliveryUpdates, cancellationToken);

        var created = await quoteRequestRepository.GetForUserAsync(quoteRequestId, user.Id, cancellationToken)
            ?? throw new InvalidOperationException("Quote request could not be loaded after creation.");

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                user,
                "quote.workflow_created",
                "Create quote workflow",
                $"Created a quote workflow for {report.PropertyAddress}.",
                entityType: "quote-request",
                entityId: quoteRequestId.ToString(),
                entityLabel: report.PropertyAddress,
                metadata: new
                {
                    serviceNeed = normalizedServiceNeed,
                    targetCount = targetRecords.Length,
                    sharedReportPdf = request.ShareReportPdf
                }),
            cancellationToken);

        return QuoteRequestMapper.ToDetailDto(created);
    }

    private static IReadOnlyList<NormalizedSelection> NormalizeSelections(
        IReadOnlyList<QuoteRequestSelectedConveyancerRequest> selections)
    {
        var deduped = new Dictionary<string, NormalizedSelection>(StringComparer.OrdinalIgnoreCase);

        foreach (var selection in selections)
        {
            var jurisdiction = (selection.Jurisdiction ?? string.Empty).Trim().ToUpperInvariant();
            var regulatorType = (selection.RegulatorType ?? string.Empty).Trim();
            var sourceIdentifier = (selection.SourceIdentifier ?? string.Empty).Trim();

            if (string.IsNullOrWhiteSpace(jurisdiction) ||
                string.IsNullOrWhiteSpace(regulatorType) ||
                string.IsNullOrWhiteSpace(sourceIdentifier))
            {
                continue;
            }

            var key = BuildSelectionKey(jurisdiction, regulatorType, sourceIdentifier);
            deduped[key] = new NormalizedSelection(jurisdiction, regulatorType, sourceIdentifier);
        }

        return deduped.Values.ToArray();
    }

    private static string NormalizeServiceNeed(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (!SupportedServiceNeeds.Contains(normalized))
        {
            throw new InvalidOperationException("Select a supported conveyancing service before requesting quotes.");
        }

        return normalized;
    }

    private static IReadOnlyList<string> NormalizeConveyancerQuestions(
        IReadOnlyList<string>? values,
        IReadOnlyList<string> fallback)
    {
        return NormalizeBriefList(values, fallback);
    }

    private static IReadOnlyList<string> NormalizeBriefList(
        IReadOnlyList<string>? values,
        IReadOnlyList<string> fallback)
    {
        if (values is null)
        {
            return fallback;
        }

        var maxItems = Math.Min(50, fallback.Count + 3);

        return values
            .Select(value => value?.Trim() ?? string.Empty)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(maxItems)
            .ToArray();
    }

    private static QuoteRequestEmailMessage BuildEmailMessage(
        ConveyancerDirectoryRecord record,
        string buyerName,
        QuoteRequestCreateRecord request,
        QuoteRequestBriefPayload brief,
        string responseUrl,
        string unsubscribeUrl,
        string appBaseUrl,
        DateTimeOffset expiresAtUtc)
    {
        return QuoteRequestEmailComposer.BuildQuoteRequestEmail(
            record,
            buyerName,
            request,
            brief,
            responseUrl,
            unsubscribeUrl,
            appBaseUrl,
            expiresAtUtc);
    }

    private static string BuildSelectionKey(string jurisdiction, string regulatorType, string sourceIdentifier)
    {
        return $"{jurisdiction.Trim().ToUpperInvariant()}|{regulatorType.Trim().ToLowerInvariant()}|{sourceIdentifier.Trim().ToLowerInvariant()}";
    }

    private static string? NormalizeNullableMessage(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private sealed record NormalizedSelection(string Jurisdiction, string RegulatorType, string SourceIdentifier);

    private sealed record TargetSendSpec(
        ConveyancerDirectoryRecord Record,
        string RawToken,
        string TokenHash);
}

public sealed class GetQuoteRequestSummaryByReviewJobQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IQuoteRequestRepository quoteRequestRepository)
    : IRequestHandler<GetQuoteRequestSummaryByReviewJobQuery, ErrorOr<QuoteRequestSummaryDto>>
{
    public Task<ErrorOr<QuoteRequestSummaryDto>> Handle(
        GetQuoteRequestSummaryByReviewJobQuery request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.ReviewJobId, cancellationToken));
    }

    private async Task<QuoteRequestSummaryDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid reviewJobId,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var summary = await quoteRequestRepository.GetSummaryForUserByReviewJobAsync(user.Id, reviewJobId, cancellationToken)
            ?? throw new KeyNotFoundException("Quote request was not found for this report.");

        return QuoteRequestMapper.ToSummaryDto(summary);
    }
}

public sealed class ListQuoteRequestsQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IQuoteRequestRepository quoteRequestRepository)
    : IRequestHandler<ListQuoteRequestsQuery, ErrorOr<IReadOnlyList<QuoteRequestSummaryDto>>>
{
    public Task<ErrorOr<IReadOnlyList<QuoteRequestSummaryDto>>> Handle(ListQuoteRequestsQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.IncludeArchived, cancellationToken));
    }

    private async Task<IReadOnlyList<QuoteRequestSummaryDto>> HandleAsync(
        ClaimsPrincipal principal,
        bool includeArchived,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var rows = await quoteRequestRepository.ListForUserAsync(user.Id, includeArchived, cancellationToken);
        return rows.Select(QuoteRequestMapper.ToSummaryDto).ToArray();
    }
}

public sealed class GetQuoteRequestQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IQuoteRequestRepository quoteRequestRepository,
    IAuditTrail auditTrail)
    : IRequestHandler<GetQuoteRequestQuery, ErrorOr<QuoteRequestDetailDto>>
{
    public Task<ErrorOr<QuoteRequestDetailDto>> Handle(GetQuoteRequestQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.QuoteRequestId, cancellationToken));
    }

    private async Task<QuoteRequestDetailDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid quoteRequestId,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var detail = await quoteRequestRepository.GetForUserAsync(quoteRequestId, user.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Quote request was not found.");

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                user,
                "quote.workflow_opened",
                "Open quote workflow",
                $"Opened the quote workflow for {detail.Request.PropertyAddress}.",
                entityType: "quote-request",
                entityId: detail.Request.Id.ToString(),
                entityLabel: detail.Request.PropertyAddress,
                metadata: new
                {
                    responseCount = detail.Targets.Count(target => target.Response is not null),
                    targetCount = detail.Targets.Count
                }),
            cancellationToken);

        return QuoteRequestMapper.ToDetailDto(detail);
    }
}

public sealed class SetQuoteRequestArchiveStatusCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IQuoteRequestRepository quoteRequestRepository)
    : IRequestHandler<SetQuoteRequestArchiveStatusCommand, ErrorOr<QuoteRequestArchiveStatusDto>>
{
    public Task<ErrorOr<QuoteRequestArchiveStatusDto>> Handle(SetQuoteRequestArchiveStatusCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.QuoteRequestId, request.Request, cancellationToken));
    }

    private async Task<QuoteRequestArchiveStatusDto> HandleAsync(
        ClaimsPrincipal principal,
        Guid quoteRequestId,
        SetQuoteRequestArchiveStatusRequest request,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var updated = await quoteRequestRepository.SetArchivedAsync(quoteRequestId, user.Id, request.Archived, cancellationToken)
            ?? throw new KeyNotFoundException("Quote request was not found.");

        return new QuoteRequestArchiveStatusDto(updated.QuoteRequestId, updated.ArchivedAtUtc);
    }
}

public sealed class DeleteQuoteRequestCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IQuoteRequestRepository quoteRequestRepository)
    : IRequestHandler<DeleteQuoteRequestCommand, ErrorOr<DeleteQuoteRequestResponse>>
{
    public Task<ErrorOr<DeleteQuoteRequestResponse>> Handle(DeleteQuoteRequestCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Principal, request.QuoteRequestId, cancellationToken));
    }

    private async Task<DeleteQuoteRequestResponse> HandleAsync(
        ClaimsPrincipal principal,
        Guid quoteRequestId,
        CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetCurrentUserAsync(principal, cancellationToken);
        var deleted = await quoteRequestRepository.DeleteForUserAsync(quoteRequestId, user.Id, cancellationToken);
        if (!deleted)
        {
            throw new KeyNotFoundException("Quote request was not found.");
        }

        return new DeleteQuoteRequestResponse(quoteRequestId, true);
    }
}

public sealed class GetPublicQuoteRequestQueryHandler(
    IQuoteRequestRepository quoteRequestRepository,
    IUserRepository userRepository,
    IAuditTrail auditTrail)
    : IRequestHandler<GetPublicQuoteRequestQuery, ErrorOr<PublicQuoteRequestViewDto>>
{
    public Task<ErrorOr<PublicQuoteRequestViewDto>> Handle(GetPublicQuoteRequestQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Token, request.DocumentAccessToken, cancellationToken));
    }

    private async Task<PublicQuoteRequestViewDto> HandleAsync(
        string token,
        string? documentAccessToken,
        CancellationToken cancellationToken)
    {
        var record = await RequirePublicTargetAsync(token, quoteRequestRepository, cancellationToken);
        var wasFirstOpen = record.Target.Response is null &&
            (string.Equals(record.Target.Status, QuoteRequestTargetStatus.Sent, StringComparison.Ordinal) ||
             string.Equals(record.Target.Status, QuoteRequestTargetStatus.Prepared, StringComparison.Ordinal));
        if (record.Target.Response is null &&
            (string.Equals(record.Target.Status, QuoteRequestTargetStatus.Sent, StringComparison.Ordinal) ||
             string.Equals(record.Target.Status, QuoteRequestTargetStatus.Prepared, StringComparison.Ordinal)))
        {
            await quoteRequestRepository.MarkTargetOpenedAsync(record.Target.Id, cancellationToken);
            record = record with
            {
                Target = record.Target with
                {
                    Status = QuoteRequestTargetStatus.Opened,
                    OpenedAtUtc = DateTimeOffset.UtcNow
                }
            };
        }

        if (wasFirstOpen)
        {
            var buyer = await QuoteRequestAuditHelpers.TryGetUserSnapshotAsync(record.Request.UserId, userRepository, cancellationToken);
            await auditTrail.WriteAsync(
                AuditEventFactory.ForConveyancer(
                    "quote.public_request_opened",
                    "Conveyancer opened request",
                    $"Opened the secure quote request for {record.Request.PropertyAddress}.",
                    record.Target.Email,
                    record.Target.OrganizationName ?? record.Target.Name,
                    buyer.UserId,
                    buyer.Email,
                    buyer.FullName,
                    entityType: "quote-request",
                    entityId: record.Request.Id.ToString(),
                    entityLabel: record.Request.PropertyAddress,
                    metadata: new
                    {
                        sharedDocumentCount = record.SharedDocuments.Count
                    }),
                cancellationToken);
        }

        var documentAccessSession = await ResolveDocumentAccessSessionAsync(record, documentAccessToken, quoteRequestRepository, cancellationToken);
        return QuoteRequestMapper.ToPublicDto(record, documentAccessSession);
    }

    internal static async Task<QuoteRequestPublicTargetRecord> RequirePublicTargetAsync(
        string token,
        IQuoteRequestRepository quoteRequestRepository,
        CancellationToken cancellationToken)
    {
        return await RequirePublicTargetAsync(token, quoteRequestRepository, enforceNotExpired: true, cancellationToken);
    }

    internal static async Task<QuoteRequestPublicTargetRecord> RequirePublicTargetAsync(
        string token,
        IQuoteRequestRepository quoteRequestRepository,
        bool enforceNotExpired,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            throw new KeyNotFoundException("Quote request token was not found.");
        }

        var tokenHash = QuoteRequestTokenCodec.ComputeHash(token.Trim());
        var record = await quoteRequestRepository.GetPublicTargetByTokenHashAsync(tokenHash, cancellationToken)
            ?? throw new KeyNotFoundException("Quote request token was not found.");

        if (enforceNotExpired && record.Request.ExpiresAtUtc <= DateTimeOffset.UtcNow)
        {
            throw new InvalidOperationException("This quote request has expired.");
        }

        return record;
    }

    internal static async Task<QuoteRequestDocumentAccessSessionRecord?> ResolveDocumentAccessSessionAsync(
        QuoteRequestPublicTargetRecord record,
        string? documentAccessToken,
        IQuoteRequestRepository quoteRequestRepository,
        CancellationToken cancellationToken)
    {
        if (!record.Request.ShareReportPdf ||
            record.Target.DocumentAccess.TotalDocumentCount <= 0 ||
            string.IsNullOrWhiteSpace(documentAccessToken))
        {
            return null;
        }

        var tokenHash = QuoteRequestTokenCodec.ComputeHash(documentAccessToken.Trim());
        return await quoteRequestRepository.GetActiveDocumentAccessSessionAsync(record.Target.Id, tokenHash, cancellationToken);
    }
}

public sealed class RequestPublicQuoteRequestDocumentAccessOtpCommandHandler(
    IQuoteRequestRepository quoteRequestRepository,
    IUserRepository userRepository,
    IQuoteRequestEmailSender quoteRequestEmailSender,
    IOptions<QuoteRequestEmailOptions> emailOptions,
    IOptions<ReviewPipelineOptions> pipelineOptions,
    IAuditTrail auditTrail)
    : IRequestHandler<RequestPublicQuoteRequestDocumentAccessOtpCommand, ErrorOr<RequestPublicQuoteRequestDocumentAccessOtpResponse>>
{
    public Task<ErrorOr<RequestPublicQuoteRequestDocumentAccessOtpResponse>> Handle(
        RequestPublicQuoteRequestDocumentAccessOtpCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Token, cancellationToken));
    }

    private async Task<RequestPublicQuoteRequestDocumentAccessOtpResponse> HandleAsync(
        string token,
        CancellationToken cancellationToken)
    {
        var record = await GetPublicQuoteRequestQueryHandler.RequirePublicTargetAsync(token, quoteRequestRepository, cancellationToken);
        if (!record.Request.ShareReportPdf || record.Target.DocumentAccess.TotalDocumentCount == 0)
        {
            throw new InvalidOperationException("Secure document access is not available for this quote request.");
        }

        var now = DateTimeOffset.UtcNow;
        var cooldown = TimeSpan.FromSeconds(emailOptions.Value.DocumentAccessOtpCooldownSeconds);
        if (record.Target.DocumentAccess.OtpRequestedAtUtc.HasValue &&
            cooldown > TimeSpan.Zero &&
            now - record.Target.DocumentAccess.OtpRequestedAtUtc.Value < cooldown)
        {
            var availableAtUtc = record.Target.DocumentAccess.OtpRequestedAtUtc.Value.Add(cooldown);
            throw new InvalidOperationException($"A code was just sent. Try again after {availableAtUtc:HH:mm} UTC.");
        }

        var otpCode = QuoteRequestTokenCodec.GenerateOtpCode();
        var expiresAtUtc = now.AddMinutes(emailOptions.Value.DocumentAccessOtpExpiryMinutes);
        var emailMessage = BuildDocumentAccessOtpEmailMessage(
            record.Target,
            record.Request.PropertyAddress,
            otpCode,
            expiresAtUtc,
            pipelineOptions.Value.AppBaseUrl);

        var sendResult = await quoteRequestEmailSender.SendAsync(emailMessage, cancellationToken);
        if (!sendResult.IsSuccess)
        {
            throw new InvalidOperationException(sendResult.ErrorMessage ?? "The access code email could not be delivered.");
        }

        await quoteRequestRepository.UpdateDocumentAccessOtpAsync(
            record.Target.Id,
            QuoteRequestTokenCodec.ComputeHash(otpCode),
            now,
            expiresAtUtc,
            cancellationToken);

        var buyer = await QuoteRequestAuditHelpers.TryGetUserSnapshotAsync(record.Request.UserId, userRepository, cancellationToken);
        await auditTrail.WriteAsync(
            AuditEventFactory.ForConveyancer(
                "quote.document_access_code_requested",
                "Request document access code",
                $"Requested a secure document access code for {record.Request.PropertyAddress}.",
                record.Target.Email,
                record.Target.OrganizationName ?? record.Target.Name,
                buyer.UserId,
                buyer.Email,
                buyer.FullName,
                entityType: "quote-request",
                entityId: record.Request.Id.ToString(),
                entityLabel: record.Request.PropertyAddress,
                metadata: new
                {
                    expiresAtUtc
                }),
            cancellationToken);

        return new RequestPublicQuoteRequestDocumentAccessOtpResponse(now, expiresAtUtc);
    }

    private static QuoteRequestEmailMessage BuildDocumentAccessOtpEmailMessage(
        QuoteRequestTargetDetailRecord target,
        string propertyAddress,
        string otpCode,
        DateTimeOffset expiresAtUtc,
        string? appBaseUrl)
    {
        return QuoteRequestEmailComposer.BuildDocumentAccessOtpEmail(
            target,
            propertyAddress,
            otpCode,
            expiresAtUtc,
            appBaseUrl);
    }
}

public sealed class VerifyPublicQuoteRequestDocumentAccessOtpCommandHandler(
    IQuoteRequestRepository quoteRequestRepository,
    IUserRepository userRepository,
    IOptions<QuoteRequestEmailOptions> emailOptions,
    IAuditTrail auditTrail)
    : IRequestHandler<VerifyPublicQuoteRequestDocumentAccessOtpCommand, ErrorOr<VerifyPublicQuoteRequestDocumentAccessOtpResponse>>
{
    public Task<ErrorOr<VerifyPublicQuoteRequestDocumentAccessOtpResponse>> Handle(
        VerifyPublicQuoteRequestDocumentAccessOtpCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Token, request.Request, cancellationToken));
    }

    private async Task<VerifyPublicQuoteRequestDocumentAccessOtpResponse> HandleAsync(
        string token,
        VerifyPublicQuoteRequestDocumentAccessOtpRequest request,
        CancellationToken cancellationToken)
    {
        var record = await GetPublicQuoteRequestQueryHandler.RequirePublicTargetAsync(token, quoteRequestRepository, cancellationToken);
        if (!record.Request.ShareReportPdf || record.Target.DocumentAccess.TotalDocumentCount == 0)
        {
            throw new InvalidOperationException("Secure document access is not available for this quote request.");
        }

        var access = record.Target.DocumentAccess;
        var submittedCode = request.Code?.Trim() ?? string.Empty;
        if (submittedCode.Length == 0)
        {
            throw new InvalidOperationException("Enter the access code that was emailed to you.");
        }

        if (string.IsNullOrWhiteSpace(access.OtpCodeHash) || !access.OtpExpiresAtUtc.HasValue)
        {
            throw new InvalidOperationException("Request a new access code before trying to unlock the documents.");
        }

        var now = DateTimeOffset.UtcNow;
        if (access.OtpExpiresAtUtc.Value <= now)
        {
            throw new InvalidOperationException("This access code has expired. Request a new one.");
        }

        var submittedHash = QuoteRequestTokenCodec.ComputeHash(submittedCode);
        if (!string.Equals(access.OtpCodeHash, submittedHash, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The access code is invalid.");
        }

        await quoteRequestRepository.MarkDocumentAccessVerifiedAsync(record.Target.Id, now, cancellationToken);

        var sessionRawToken = QuoteRequestTokenCodec.GenerateRawToken();
        var sessionExpiresAtUtc = DateTimeOffset.Compare(record.Request.ExpiresAtUtc, now.AddHours(emailOptions.Value.DocumentAccessSessionHours)) < 0
            ? record.Request.ExpiresAtUtc
            : now.AddHours(emailOptions.Value.DocumentAccessSessionHours);

        await quoteRequestRepository.CreateDocumentAccessSessionAsync(
            new QuoteRequestDocumentAccessSessionCreateRecord(
                Guid.NewGuid(),
                record.Target.Id,
                QuoteRequestTokenCodec.ComputeHash(sessionRawToken),
                now,
                sessionExpiresAtUtc),
            cancellationToken);

        var buyer = await QuoteRequestAuditHelpers.TryGetUserSnapshotAsync(record.Request.UserId, userRepository, cancellationToken);
        await auditTrail.WriteAsync(
            AuditEventFactory.ForConveyancer(
                "quote.document_access_unlocked",
                "Unlock shared documents",
                $"Unlocked shared documents for {record.Request.PropertyAddress}.",
                record.Target.Email,
                record.Target.OrganizationName ?? record.Target.Name,
                buyer.UserId,
                buyer.Email,
                buyer.FullName,
                entityType: "quote-request",
                entityId: record.Request.Id.ToString(),
                entityLabel: record.Request.PropertyAddress,
                metadata: new
                {
                    sessionExpiresAtUtc
                }),
            cancellationToken);

        return new VerifyPublicQuoteRequestDocumentAccessOtpResponse(sessionRawToken, sessionExpiresAtUtc);
    }
}

public sealed class UnsubscribePublicQuoteRequestConveyancerCommandHandler(
    IQuoteRequestRepository quoteRequestRepository,
    IConveyancerDirectoryRepository conveyancerDirectoryRepository,
    IUserRepository userRepository,
    IMemoryCache cache,
    IAuditTrail auditTrail)
    : IRequestHandler<UnsubscribePublicQuoteRequestConveyancerCommand, ErrorOr<UnsubscribePublicQuoteRequestConveyancerResponse>>
{
    public Task<ErrorOr<UnsubscribePublicQuoteRequestConveyancerResponse>> Handle(
        UnsubscribePublicQuoteRequestConveyancerCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Token, cancellationToken));
    }

    private async Task<UnsubscribePublicQuoteRequestConveyancerResponse> HandleAsync(
        string token,
        CancellationToken cancellationToken)
    {
        var record = await GetPublicQuoteRequestQueryHandler.RequirePublicTargetAsync(
            token,
            quoteRequestRepository,
            enforceNotExpired: false,
            cancellationToken);

        var updated = await conveyancerDirectoryRepository.SetQuoteRequestsEnabledBySourceAsync(
            record.Target.Jurisdiction,
            record.Target.RegulatorType,
            record.Target.SourceIdentifier,
            false,
            cancellationToken);

        if (updated is not null)
        {
            cache.Remove(ConveyancerDirectoryCacheKeys.BuildJurisdictionKey(updated.Jurisdiction));
        }

        var buyer = await QuoteRequestAuditHelpers.TryGetUserSnapshotAsync(record.Request.UserId, userRepository, cancellationToken);
        await auditTrail.WriteAsync(
            AuditEventFactory.ForConveyancer(
                "quote.conveyancer_unsubscribed",
                "Conveyancer unsubscribed",
                $"Disabled future quote requests for {record.Target.OrganizationName ?? record.Target.Name}.",
                record.Target.Email,
                record.Target.OrganizationName ?? record.Target.Name,
                buyer.UserId,
                buyer.Email,
                buyer.FullName,
                entityType: "conveyancer",
                entityId: $"{record.Target.Jurisdiction}|{record.Target.RegulatorType}|{record.Target.SourceIdentifier}",
                entityLabel: record.Target.OrganizationName ?? record.Target.Name),
            cancellationToken);

        return new UnsubscribePublicQuoteRequestConveyancerResponse(
            record.Target.OrganizationName ?? record.Target.Name,
            false,
            updated?.QuoteRequestsDisabledAtUtc ?? DateTimeOffset.UtcNow);
    }
}

public sealed class SubmitPublicQuoteRequestCommandHandler(
    IQuoteRequestRepository quoteRequestRepository,
    IUserRepository userRepository,
    IQuoteRequestEmailSender quoteRequestEmailSender,
    IOptions<ReviewPipelineOptions> pipelineOptions,
    ILogger<SubmitPublicQuoteRequestCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<SubmitPublicQuoteRequestCommand, ErrorOr<QuoteRequestResponseDto>>
{
    public Task<ErrorOr<QuoteRequestResponseDto>> Handle(SubmitPublicQuoteRequestCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request.Token, request.Request, cancellationToken));
    }

    private async Task<QuoteRequestResponseDto> HandleAsync(
        string token,
        SubmitPublicQuoteRequestResponse request,
        CancellationToken cancellationToken)
    {
        var record = await GetPublicQuoteRequestQueryHandler.RequirePublicTargetAsync(token, quoteRequestRepository, cancellationToken);
        if (record.Target.Response is not null)
        {
            throw new InvalidOperationException("A quote response has already been submitted for this request.");
        }

        var now = DateTimeOffset.UtcNow;
        var responseCreateRecord = new QuoteRequestResponseCreateRecord(
            Guid.NewGuid(),
            record.Target.Id,
            RequireTrimmed(request.ResponderName, "Responder name"),
            RequireEmail(request.ResponderEmail),
            NormalizeNullable(request.ResponderPhone),
            NormalizePositiveMoney(request.ProfessionalFeeAud, "Professional fee"),
            request.IncludesGst,
            NormalizeNullableMoney(request.DisbursementsEstimateAud),
            NormalizeNullablePositiveInt(request.TurnaroundBusinessDays),
            RequireTrimmed(request.ScopeNotes, "Scope notes"),
            NormalizeExcludedItems(request.ExcludedItems),
            request.ValidUntilUtc,
            now);

        var updated = await quoteRequestRepository.SubmitResponseAsync(record.Target.Id, responseCreateRecord, cancellationToken)
            ?? throw new InvalidOperationException("Quote response could not be recorded.");

        var submittedResponse = updated.Target.Response
            ?? throw new InvalidOperationException("Quote response was not available after submission.");

        await TryNotifyBuyerAsync(updated, cancellationToken);

        var buyer = await QuoteRequestAuditHelpers.TryGetUserSnapshotAsync(updated.Request.UserId, userRepository, cancellationToken);
        await auditTrail.WriteAsync(
            AuditEventFactory.ForConveyancer(
                "quote.response_submitted",
                "Submit quote response",
                $"Submitted a quote response for {updated.Request.PropertyAddress}.",
                submittedResponse.ResponderEmail,
                submittedResponse.ResponderName,
                buyer.UserId,
                buyer.Email,
                buyer.FullName,
                entityType: "quote-request",
                entityId: updated.Request.Id.ToString(),
                entityLabel: updated.Request.PropertyAddress,
                metadata: new
                {
                    professionalFeeAud = submittedResponse.ProfessionalFeeAud,
                    disbursementsEstimateAud = submittedResponse.DisbursementsEstimateAud,
                    turnaroundBusinessDays = submittedResponse.TurnaroundBusinessDays
                }),
            cancellationToken);

        return QuoteRequestMapper.ToResponseDto(submittedResponse);
    }

    private async Task TryNotifyBuyerAsync(
        QuoteRequestPublicTargetRecord updated,
        CancellationToken cancellationToken)
    {
        var workflowUrl = BuildBuyerWorkflowUrl(updated.Request.Id);
        if (workflowUrl is null)
        {
            logger.LogWarning(
                "Buyer quote-response email skipped for quote request {QuoteRequestId} because ReviewPipeline:AppBaseUrl is not configured.",
                updated.Request.Id);
            return;
        }

        try
        {
            var buyer = await userRepository.GetByIdAsync(updated.Request.UserId, cancellationToken);
            if (buyer is null)
            {
                logger.LogWarning(
                    "Buyer quote-response email skipped for quote request {QuoteRequestId} because user {UserId} was not found.",
                    updated.Request.Id,
                    updated.Request.UserId);
                return;
            }

            var emailMessage = QuoteRequestEmailComposer.BuildBuyerQuoteReceivedEmail(
                buyer.Email,
                buyer.FullName,
                updated.Request,
                updated.Target,
                workflowUrl,
                pipelineOptions.Value.AppBaseUrl);

            var sendResult = await quoteRequestEmailSender.SendAsync(emailMessage, cancellationToken);
            if (!sendResult.IsSuccess)
            {
                logger.LogWarning(
                    "Quote response was recorded for request {QuoteRequestId}, but the buyer notification email failed: {ErrorMessage}",
                    updated.Request.Id,
                    sendResult.ErrorMessage ?? "Unknown email error.");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            logger.LogInformation(
                "Quote response was recorded for request {QuoteRequestId}, but buyer notification email work was cancelled.",
                updated.Request.Id);
        }
        catch (Exception error)
        {
            logger.LogWarning(
                error,
                "Quote response was recorded for request {QuoteRequestId}, but the buyer notification email could not be sent.",
                updated.Request.Id);
        }
    }

    private string? BuildBuyerWorkflowUrl(Guid quoteRequestId)
    {
        var appBaseUrl = pipelineOptions.Value.AppBaseUrl.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(appBaseUrl))
        {
            return null;
        }

        return $"{appBaseUrl}/quotes/{quoteRequestId}";
    }

    private static string RequireTrimmed(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"{label} is required.");
        }

        return value.Trim();
    }

    private static string RequireEmail(string? value)
    {
        var trimmed = RequireTrimmed(value, "Responder email");
        if (!trimmed.Contains('@', StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Responder email must be a valid email address.");
        }

        return trimmed;
    }

    private static decimal NormalizePositiveMoney(decimal value, string label)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException($"{label} must be greater than zero.");
        }

        return decimal.Round(value, 2, MidpointRounding.AwayFromZero);
    }

    private static decimal? NormalizeNullableMoney(decimal? value)
    {
        if (!value.HasValue)
        {
            return null;
        }

        if (value.Value < 0)
        {
            throw new InvalidOperationException("Disbursements estimate cannot be negative.");
        }

        return decimal.Round(value.Value, 2, MidpointRounding.AwayFromZero);
    }

    private static int? NormalizeNullablePositiveInt(int? value)
    {
        if (!value.HasValue)
        {
            return null;
        }

        if (value.Value <= 0)
        {
            throw new InvalidOperationException("Turnaround must be greater than zero business days.");
        }

        return value.Value;
    }

    private static string? NormalizeNullable(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Trim();
    }

    private static IReadOnlyList<string> NormalizeExcludedItems(IReadOnlyList<string> values)
    {
        return values
            .Select(value => value?.Trim() ?? string.Empty)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(8)
            .ToArray();
    }

}

internal static class QuoteRequestMapper
{
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static QuoteRequestSummaryDto ToSummaryDto(QuoteRequestSummaryRecord row)
    {
        return new QuoteRequestSummaryDto(
            row.Id,
            row.ReviewJobId,
            row.PropertyAddress,
            row.StateOrTerritory,
            row.ServiceNeed,
            row.Status,
            row.CreatedAtUtc,
            row.SentAtUtc,
            row.ExpiresAtUtc,
            row.TargetCount,
            row.ResponseCount,
            row.ArchivedAtUtc);
    }

    public static QuoteRequestDetailDto ToDetailDto(QuoteRequestDetailRecord detail)
    {
        var brief = ParseBrief(detail.Request.BriefJson);
        return new QuoteRequestDetailDto(
            detail.Request.Id,
            detail.Request.ReviewJobId,
            detail.Request.PropertyAddress,
            detail.Request.StateOrTerritory,
            detail.Request.ServiceNeed,
            detail.Request.Message,
            detail.Request.ShareReportPdf,
            detail.Request.Status,
            detail.Request.CreatedAtUtc,
            detail.Request.SentAtUtc,
            detail.Request.ExpiresAtUtc,
            detail.Request.ArchivedAtUtc,
            new QuoteRequestBriefDto(
                brief.Summary,
                brief.TopConcerns,
                brief.ConveyancerQuestions),
            detail.Targets
                .OrderBy(target => target.OrganizationName ?? target.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(target => target.Name, StringComparer.OrdinalIgnoreCase)
                .Select(ToTargetDto)
                .ToArray());
    }

    public static QuoteRequestTargetDto ToTargetDto(QuoteRequestTargetDetailRecord target)
    {
        return new QuoteRequestTargetDto(
            target.Id,
            target.Jurisdiction,
            target.RegulatorType,
            target.SourceIdentifier,
            target.Name,
            target.ContactName,
            target.OrganizationName,
            target.Email,
            target.Phone,
            target.Website,
            target.SourceUrl,
            target.Status,
            target.SentAtUtc,
            target.OpenedAtUtc,
            target.RespondedAtUtc,
            target.DeliveryError,
            target.Response is null ? null : ToResponseDto(target.Response),
            ToTargetDocumentAccessDto(target.DocumentAccess));
    }

    public static QuoteRequestResponseDto ToResponseDto(QuoteRequestResponseRecord response)
    {
        return new QuoteRequestResponseDto(
            response.ResponderName,
            response.ResponderEmail,
            response.ResponderPhone,
            response.ProfessionalFeeAud,
            response.IncludesGst,
            response.DisbursementsEstimateAud,
            response.TurnaroundBusinessDays,
            response.ScopeNotes,
            response.ExcludedItems,
            response.ValidUntilUtc,
            response.CreatedAtUtc);
    }

    public static PublicQuoteRequestViewDto ToPublicDto(
        QuoteRequestPublicTargetRecord record,
        QuoteRequestDocumentAccessSessionRecord? documentAccessSession)
    {
        var brief = ParseBrief(record.Request.BriefJson);
        var displayName = record.Target.OrganizationName ?? record.Target.Name;
        var canRespond = record.Target.Response is null && record.Request.ExpiresAtUtc > DateTimeOffset.UtcNow;

        return new PublicQuoteRequestViewDto(
            displayName,
            record.Request.PropertyAddress,
            record.Request.StateOrTerritory,
            record.Request.ServiceNeed,
            brief.Summary,
            brief.TopConcerns,
            brief.ConveyancerQuestions,
            record.Request.ShareReportPdf,
            record.Request.ShareReportPdf
                ? record.SharedDocuments
                    .OrderBy(document => document.UploadedAtUtc)
                    .ThenBy(document => document.FileName, StringComparer.OrdinalIgnoreCase)
                    .Select(document => new QuoteRequestSharedDocumentDto(
                        document.Id,
                        document.FileName,
                        document.ContentType,
                        document.DocType,
                        document.UploadedAtUtc))
                    .ToArray()
                : [],
            ToPublicDocumentAccessDto(record.Target.DocumentAccess, documentAccessSession),
            canRespond,
            record.Request.ExpiresAtUtc,
            record.Target.Response is null ? null : ToResponseDto(record.Target.Response));
    }

    public static QuoteRequestTargetDocumentAccessDto ToTargetDocumentAccessDto(QuoteRequestTargetDocumentAccessRecord access)
    {
        var downloadedDocumentCount = access.DownloadedSharedDocumentCount + (access.ReportDownloaded ? 1 : 0);
        return new QuoteRequestTargetDocumentAccessDto(
            access.TotalDocumentCount > 0,
            access.OtpRequestedAtUtc,
            access.VerifiedAtUtc,
            access.ReportDownloaded,
            downloadedDocumentCount,
            access.TotalDocumentCount,
            access.LastDownloadedAtUtc);
    }

    public static QuoteRequestPublicDocumentAccessDto ToPublicDocumentAccessDto(
        QuoteRequestTargetDocumentAccessRecord access,
        QuoteRequestDocumentAccessSessionRecord? session)
    {
        var downloadedDocumentCount = access.DownloadedSharedDocumentCount + (access.ReportDownloaded ? 1 : 0);
        return new QuoteRequestPublicDocumentAccessDto(
            access.TotalDocumentCount > 0,
            session is not null,
            access.OtpRequestedAtUtc,
            access.OtpExpiresAtUtc,
            access.VerifiedAtUtc,
            session?.ExpiresAtUtc,
            access.ReportDownloaded,
            downloadedDocumentCount,
            access.TotalDocumentCount,
            access.LastDownloadedAtUtc);
    }

    public static QuoteRequestBriefPayload BuildBrief(string summaryJson)
    {
        try
        {
            using var document = JsonDocument.Parse(summaryJson);
            var root = document.RootElement;

            var summary = GetString(root, "summary")
                          ?? GetString(root, "executiveSummary")
                          ?? "Buyer is requesting a conveyancing quote based on a completed ConveyMate report.";

            var questions = ReadStringArray(root, "lawyerQuestions", 50);
            if (questions.Count == 0)
            {
                questions = ReadStringArray(root, "recommendedActions", 50);
            }

            return new QuoteRequestBriefPayload(summary, [], questions);
        }
        catch
        {
            return new QuoteRequestBriefPayload(
                "Buyer is requesting a conveyancing quote based on a completed ConveyMate report.",
                [],
                []);
        }
    }

    public static string FormatServiceNeed(string value)
    {
        return value switch
        {
            "pre-exchange-review" => "Pre-exchange contract review",
            "full-conveyancing" => "Full conveyancing",
            "settlement-only" => "Settlement only",
            _ => value
        };
    }

    private static QuoteRequestBriefPayload ParseBrief(string briefJson)
    {
        try
        {
            var parsed = JsonSerializer.Deserialize<QuoteRequestBriefPayload>(briefJson, JsonOptions);
            return parsed ?? new QuoteRequestBriefPayload(string.Empty, [], []);
        }
        catch
        {
            return new QuoteRequestBriefPayload(string.Empty, [], []);
        }
    }

    private static string? GetString(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var element) || element.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var value = element.GetString()?.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static IReadOnlyList<string> ReadNamedItems(JsonElement root, string arrayName, string fieldName, int maxItems)
    {
        if (!root.TryGetProperty(arrayName, out var arrayElement) || arrayElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return arrayElement
            .EnumerateArray()
            .Select(item =>
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    return null;
                }

                return GetString(item, fieldName);
            })
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(maxItems)
            .Select(value => value!)
            .ToArray();
    }

    private static IReadOnlyList<string> ReadStringArray(JsonElement root, string arrayName, int maxItems)
    {
        if (!root.TryGetProperty(arrayName, out var arrayElement) || arrayElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return arrayElement
            .EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString()?.Trim())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(maxItems)
            .Select(value => value!)
            .ToArray();
    }
}

internal static class QuoteRequestTokenCodec
{
    public static string GenerateRawToken()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public static string GenerateOtpCode()
    {
        var value = RandomNumberGenerator.GetInt32(0, 1_000_000);
        return value.ToString("D6");
    }

    public static string ComputeHash(string rawToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(bytes);
    }
}

internal static class QuoteRequestAuditHelpers
{
    public static async Task<QuoteRequestAuditUserSnapshot> TryGetUserSnapshotAsync(
        Guid userId,
        IUserRepository userRepository,
        CancellationToken cancellationToken)
    {
        var user = await userRepository.GetByIdAsync(userId, cancellationToken);
        return user is null
            ? new QuoteRequestAuditUserSnapshot(userId, null, null)
            : new QuoteRequestAuditUserSnapshot(user.Id, user.Email, user.FullName);
    }
}

internal sealed record QuoteRequestAuditUserSnapshot(
    Guid UserId,
    string? Email,
    string? FullName);

internal sealed record QuoteRequestBriefPayload(
    string Summary,
    IReadOnlyList<string> TopConcerns,
    IReadOnlyList<string> ConveyancerQuestions);
