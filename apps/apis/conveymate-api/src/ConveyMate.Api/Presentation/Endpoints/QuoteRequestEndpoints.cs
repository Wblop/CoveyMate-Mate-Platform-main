using System.Security.Claims;
using System.Text.RegularExpressions;
using System.IO;
using Carter;
using MediatR;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.QuoteRequests;
using ConveyMate.Api.Application.QuoteRequests.Abstractions;
using ConveyMate.Api.Application.QuoteRequests.Contracts;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Authenticated and token-scoped endpoints for conveyancer quote requests.
/// </summary>
public sealed class QuoteRequestEndpoints : ICarterModule
{
    private const string DocumentAccessTokenHeaderName = "X-Document-Access-Token";

    public void AddRoutes(IEndpointRouteBuilder app)
    {
        var authenticatedGroup = app.MapGroup("/api/quote-requests")
            .RequireAuthorization();

        authenticatedGroup.MapGet(string.Empty, () =>
                RetiredQuoteWorkflowResult("Quote workflows are no longer available in ConveyMate."))
            .WithName("ListQuoteRequests");

        authenticatedGroup.MapGet("/by-report/{reviewJobId:guid}", () =>
                RetiredQuoteWorkflowResult("Quote workflows are no longer available in ConveyMate."))
            .WithName("GetQuoteRequestByReport");

        authenticatedGroup.MapPost("/from-report/{reviewJobId:guid}", () =>
                RetiredQuoteWorkflowResult("Quote creation from reports has been retired."))
            .WithName("CreateQuoteRequestFromReport");

        authenticatedGroup.MapGet("/{quoteRequestId:guid}", () =>
                RetiredQuoteWorkflowResult("Quote workflows are no longer available in ConveyMate."))
            .WithName("GetQuoteRequest");

        authenticatedGroup.MapPost("/{quoteRequestId:guid}/archive", () =>
                RetiredQuoteWorkflowResult("Quote workflows are no longer available in ConveyMate."))
            .WithName("SetQuoteRequestArchiveStatus");

        authenticatedGroup.MapDelete("/{quoteRequestId:guid}", () =>
                RetiredQuoteWorkflowResult("Quote workflows are no longer available in ConveyMate."))
            .WithName("DeleteQuoteRequest");

        var publicGroup = app.MapGroup("/api/public/quote-requests")
            .AllowAnonymous();

        publicGroup.MapGet("/{token}", () =>
                RetiredQuoteWorkflowResult("Public quote links have been retired."))
            .WithName("GetPublicQuoteRequest");

        publicGroup.MapPost("/{token}/document-access/request-otp", () =>
                RetiredQuoteWorkflowResult("Public quote links have been retired."))
            .WithName("RequestPublicQuoteRequestDocumentAccessOtp");

        publicGroup.MapPost("/{token}/document-access/verify-otp", () =>
                RetiredQuoteWorkflowResult("Public quote links have been retired."))
            .WithName("VerifyPublicQuoteRequestDocumentAccessOtp");

        publicGroup.MapPost("/{token}/response", () =>
                RetiredQuoteWorkflowResult("Public quote links have been retired."))
            .WithName("SubmitPublicQuoteRequestResponse");

        publicGroup.MapPost("/{token}/unsubscribe", () =>
                RetiredQuoteWorkflowResult("Quote workflow emails have been retired."))
            .WithName("UnsubscribePublicQuoteRequestConveyancer");

        publicGroup.MapGet("/{token}/report-download", () =>
                RetiredQuoteWorkflowResult("Public quote links have been retired."))
            .WithName("GetPublicQuoteRequestReportDownload");

        publicGroup.MapGet("/{token}/documents/{documentId:guid}/download", () =>
                RetiredQuoteWorkflowResult("Public quote links have been retired."))
            .WithName("GetPublicQuoteRequestDocumentDownload");
    }

    private static IResult RetiredQuoteWorkflowResult(string detail)
    {
        return Results.Problem(
            title: "Quote workflows retired.",
            detail: detail,
            statusCode: StatusCodes.Status410Gone);
    }

    private static async Task<IResult> ServeSharedReportAsync(
        string token,
        string? documentAccessToken,
        HttpContext httpContext,
        IQuoteRequestRepository quoteRequestRepository,
        IReviewStorageService reviewStorageService,
        IUserRepository userRepository,
        IAuditTrail auditTrail,
        CancellationToken cancellationToken)
    {
        var record = await GetPublicQuoteRequestQueryHandler.RequirePublicTargetAsync(token, quoteRequestRepository, cancellationToken);
        if (!record.Request.ShareReportPdf)
        {
            throw new InvalidOperationException("The buyer did not enable secure document sharing for this quote request.");
        }

        await RequireDocumentAccessSessionAsync(record, documentAccessToken, quoteRequestRepository, cancellationToken);

        if (string.IsNullOrWhiteSpace(record.ReportS3Key))
        {
            throw new InvalidOperationException("No report PDF is available for this quote request.");
        }

        var download = await reviewStorageService.OpenReadAsync(record.ReportS3Key, cancellationToken)
            ?? throw new KeyNotFoundException("The shared report could not be found.");

        var fileName = $"{Slugify(record.Request.PropertyAddress)}-conveymate-report.pdf";
        await quoteRequestRepository.RecordDocumentDownloadAsync(
            new QuoteRequestDocumentDownloadUpsertRecord(
                Guid.NewGuid(),
                record.Target.Id,
                "report",
                "report",
                null,
                fileName,
                DateTimeOffset.UtcNow),
            cancellationToken);

        var buyer = await QuoteRequestAuditHelpers.TryGetUserSnapshotAsync(record.Request.UserId, userRepository, cancellationToken);
        await auditTrail.WriteAsync(
            AuditEventFactory.ForConveyancer(
                "quote.shared_report_downloaded",
                "Conveyancer downloaded shared report",
                $"Downloaded the shared report for {record.Request.PropertyAddress}.",
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
                    fileName
                }),
            cancellationToken);

        var payload = await ReadDownloadPayloadAsync(download, cancellationToken);
        ApplyPrivateDownloadHeaders(httpContext);
        httpContext.Response.ContentLength = payload.Length;
        return Results.File(
            payload,
            download.ContentType,
            fileName);
    }

    private static async Task<IResult> ServeSharedDocumentAsync(
        string token,
        Guid documentId,
        string? documentAccessToken,
        HttpContext httpContext,
        IQuoteRequestRepository quoteRequestRepository,
        IReviewStorageService reviewStorageService,
        IUserRepository userRepository,
        IAuditTrail auditTrail,
        CancellationToken cancellationToken)
    {
        var record = await GetPublicQuoteRequestQueryHandler.RequirePublicTargetAsync(token, quoteRequestRepository, cancellationToken);
        if (!record.Request.ShareReportPdf)
        {
            throw new InvalidOperationException("The buyer did not enable secure document sharing for this quote request.");
        }

        await RequireDocumentAccessSessionAsync(record, documentAccessToken, quoteRequestRepository, cancellationToken);

        var document = record.SharedDocuments.FirstOrDefault(item => item.Id == documentId)
            ?? throw new KeyNotFoundException("The requested document was not found for this quote request.");

        var download = await reviewStorageService.OpenReadAsync(document.S3KeyRaw, cancellationToken)
            ?? throw new KeyNotFoundException("The requested document could not be found.");

        var fileName = SanitizeFileName(document.FileName);
        await quoteRequestRepository.RecordDocumentDownloadAsync(
            new QuoteRequestDocumentDownloadUpsertRecord(
                Guid.NewGuid(),
                record.Target.Id,
                $"document:{document.Id}",
                "job-document",
                document.Id,
                fileName,
                DateTimeOffset.UtcNow),
            cancellationToken);

        var buyer = await QuoteRequestAuditHelpers.TryGetUserSnapshotAsync(record.Request.UserId, userRepository, cancellationToken);
        await auditTrail.WriteAsync(
            AuditEventFactory.ForConveyancer(
                "quote.shared_document_downloaded",
                "Conveyancer downloaded shared document",
                $"Downloaded shared document {fileName}.",
                record.Target.Email,
                record.Target.OrganizationName ?? record.Target.Name,
                buyer.UserId,
                buyer.Email,
                buyer.FullName,
                entityType: "job-document",
                entityId: document.Id.ToString(),
                entityLabel: fileName,
                metadata: new
                {
                    jobId = document.JobId,
                    document.DocType
                }),
            cancellationToken);

        var payload = await ReadDownloadPayloadAsync(download, cancellationToken);
        ApplyPrivateDownloadHeaders(httpContext);
        httpContext.Response.ContentLength = payload.Length;
        return Results.File(payload, download.ContentType, fileName);
    }

    private static void ApplyPrivateDownloadHeaders(HttpContext httpContext)
    {
        httpContext.Response.Headers["Cache-Control"] = "private, no-store, no-cache, max-age=0";
        httpContext.Response.Headers["Pragma"] = "no-cache";
        httpContext.Response.Headers["Expires"] = "0";
        httpContext.Response.Headers["X-Content-Type-Options"] = "nosniff";
    }

    private static string Slugify(string value)
    {
        var slug = Regex.Replace(value.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "property" : slug;
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? "shared-document" : cleaned;
    }

    private static string? ReadDocumentAccessToken(HttpRequest request)
    {
        return request.Headers.TryGetValue(DocumentAccessTokenHeaderName, out var values)
            ? values.FirstOrDefault()?.Trim()
            : null;
    }

    private static async Task<byte[]> ReadDownloadPayloadAsync(
        ReviewStorageDownloadObject download,
        CancellationToken cancellationToken)
    {
        await using var _ = download;
        using var buffer = download.ContentLength is { } contentLength && contentLength > 0 && contentLength <= int.MaxValue
            ? new MemoryStream((int)contentLength)
            : new MemoryStream();
        await download.Stream.CopyToAsync(buffer, cancellationToken);

        if (buffer.Length <= 0)
        {
            throw new InvalidOperationException("The requested file is empty in secure storage.");
        }

        return buffer.ToArray();
    }

    private static async Task RequireDocumentAccessSessionAsync(
        QuoteRequestPublicTargetRecord record,
        string? documentAccessToken,
        IQuoteRequestRepository quoteRequestRepository,
        CancellationToken cancellationToken)
    {
        if (record.Target.DocumentAccess.TotalDocumentCount == 0)
        {
            throw new InvalidOperationException("No shared documents are available for this quote request.");
        }

        var session = await GetPublicQuoteRequestQueryHandler.ResolveDocumentAccessSessionAsync(
            record,
            documentAccessToken,
            quoteRequestRepository,
            cancellationToken);

        if (session is null)
        {
            throw new UnauthorizedAccessException("Request and verify a one-time access code before downloading the documents.");
        }
    }
}
