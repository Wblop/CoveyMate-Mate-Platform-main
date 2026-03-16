using System.Security.Claims;
using System.Net;
using System.Text.Json;
using ErrorOr;
using MediatR;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Admin;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.SeoEngine.Abstractions;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Application.Users.Contracts;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Application.SeoEngine;

public sealed record GetSeoEngineOverviewQuery(ClaimsPrincipal Principal) : IRequest<ErrorOr<SeoEngineOverviewDto>>;

public sealed record ListSeoEngineJobsQuery(ClaimsPrincipal Principal) : IRequest<ErrorOr<IReadOnlyList<SeoEngineJobDto>>>;

public sealed record ListSeoEngineSchedulesQuery(ClaimsPrincipal Principal)
    : IRequest<ErrorOr<IReadOnlyList<SeoEngineScheduleDto>>>;

public sealed record ListSeoEngineArticlesQuery(ClaimsPrincipal Principal, string? Status)
    : IRequest<ErrorOr<IReadOnlyList<SeoEngineArticleSummaryDto>>>;

public sealed record GetSeoEngineArticleQuery(ClaimsPrincipal Principal, Guid ArticleId)
    : IRequest<ErrorOr<SeoEngineArticleDetailDto>>;

public sealed record GenerateSeoEngineArticleCommand(ClaimsPrincipal Principal)
    : IRequest<ErrorOr<SeoEngineJobTriggerResponse>>;

public sealed record RefreshSeoEngineSitemapCommand(ClaimsPrincipal Principal)
    : IRequest<ErrorOr<SeoEngineJobTriggerResponse>>;

public sealed record UpdateSeoEngineScheduleCommand(
    ClaimsPrincipal Principal,
    string JobType,
    UpdateSeoEngineScheduleRequest Request) : IRequest<ErrorOr<SeoEngineScheduleDto>>;

public sealed record DeleteSeoEngineJobCommand(ClaimsPrincipal Principal, Guid JobId)
    : IRequest<ErrorOr<Deleted>>;

public sealed record ClearSeoEngineJobHistoryCommand(ClaimsPrincipal Principal)
    : IRequest<ErrorOr<SeoEngineJobHistoryClearResponse>>;

public sealed record UpdateSeoEngineArticleCommand(
    ClaimsPrincipal Principal,
    Guid ArticleId,
    UpdateSeoEngineArticleRequest Request) : IRequest<ErrorOr<SeoEngineArticleDetailDto>>;

public sealed record PublishSeoEngineArticleCommand(ClaimsPrincipal Principal, Guid ArticleId)
    : IRequest<ErrorOr<SeoEngineArticleDetailDto>>;

public sealed record DeleteSeoEngineArticleCommand(ClaimsPrincipal Principal, Guid ArticleId)
    : IRequest<ErrorOr<Deleted>>;

public sealed record SeoEngineOverviewDto(
    bool EngineEnabled,
    bool QueueConfigured,
    string EngineName,
    string MarketingHost,
    string AppHost,
    int DraftCount,
    int PublishedCount,
    int RunningJobCount,
    int FailedJobCount);

public sealed record SeoEngineJobDto(
    Guid Id,
    string JobType,
    string Status,
    string RequestedSource,
    string? RequestedByEmail,
    string? RequestedByName,
    Guid? ArticleId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    string? ErrorMessage);

public sealed record SeoEngineScheduleDto(
    string JobType,
    string Label,
    string Description,
    string ScheduleExpression,
    string ScheduleExpressionTimezone,
    bool Enabled,
    string State);

public sealed record SeoEngineDuplicateWarningDto(
    string Severity,
    string MatchType,
    string Message,
    Guid? ExistingArticleId,
    string? ExistingArticleTitle,
    string? ExistingArticleSlug,
    decimal SimilarityScore);

public sealed record SeoEngineArticleSectionDto(
    string SectionId,
    string Heading,
    string[] Paragraphs,
    string[] Bullets,
    int Position);

public sealed record SeoEngineArticleSourceDto(
    string SourceName,
    string Publisher,
    string Headline,
    string SourceUrl,
    DateTimeOffset? PublishedAt,
    string Summary,
    int Position);

public sealed record SeoEngineArticleSummaryDto(
    Guid Id,
    string Status,
    string Title,
    string Slug,
    string Excerpt,
    string MetaTitle,
    string MetaDescription,
    string[] Tags,
    string[] Keywords,
    int SourceCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? PublishedAt,
    IReadOnlyList<SeoEngineDuplicateWarningDto> DuplicateWarnings);

public sealed record SeoEngineArticleDetailDto(
    Guid Id,
    string Status,
    string Title,
    string Slug,
    string Excerpt,
    string BodyMarkdown,
    string BodyHtml,
    string BodyPlainText,
    string MetaTitle,
    string MetaDescription,
    string[] Tags,
    string[] Keywords,
    int SourceCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? LastGeneratedAt,
    DateTimeOffset? PublishedAt,
    IReadOnlyList<SeoEngineDuplicateWarningDto> DuplicateWarnings,
    IReadOnlyList<SeoEngineArticleSectionDto> Sections,
    IReadOnlyList<SeoEngineArticleSourceDto> Sources);

public sealed record SeoEngineJobTriggerResponse(
    Guid JobId,
    string JobType,
    string Status,
    DateTimeOffset QueuedAtUtc,
    string Message);

public sealed record SeoEngineJobHistoryClearResponse(int DeletedCount);

public sealed record UpdateSeoEngineScheduleRequest(
    string? ScheduleExpression,
    string? ScheduleExpressionTimezone,
    bool Enabled);

public sealed record UpdateSeoEngineArticleRequest(
    string? Title,
    string? Slug,
    string? Excerpt,
    string? BodyMarkdown,
    string? MetaTitle,
    string? MetaDescription,
    string[]? Tags,
    string[]? Keywords);

internal static class SeoEngineJobTypes
{
    public const string GenerateArticle = "generate-article";
    public const string PublishNextArticle = "publish-next-article";
    public const string RefreshSitemap = "refresh-sitemap";
}

internal sealed record SeoEngineAutomationCommandMessage(
    Guid JobId,
    string Action,
    DateTimeOffset RequestedAtUtc,
    SeoEngineAutomationCommandActor RequestedBy,
    string? Notes,
    IReadOnlyDictionary<string, string> Payload);

internal sealed record SeoEngineAutomationCommandActor(
    Guid UserId,
    string Email,
    string? Name,
    bool IsAdmin);

public sealed class GetSeoEngineOverviewQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository,
    IOptions<SeoEngineAutomationOptions> options)
    : IRequestHandler<GetSeoEngineOverviewQuery, ErrorOr<SeoEngineOverviewDto>>
{
    public Task<ErrorOr<SeoEngineOverviewDto>> Handle(GetSeoEngineOverviewQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var overview = await repository.GetOverviewAsync(cancellationToken);
            var configuration = options.Value;

            return new SeoEngineOverviewDto(
                configuration.Enabled,
                !string.IsNullOrWhiteSpace(configuration.CommandQueueUrl),
                SeoEngineValueNormalizer.WithFallback(configuration.EngineName, "SEO Engine"),
                SeoEngineValueNormalizer.WithFallback(configuration.MarketingHost, "conveymate.com.au"),
                SeoEngineValueNormalizer.WithFallback(configuration.AppHost, "app.conveymate.com.au"),
                overview.DraftCount,
                overview.PublishedCount,
                overview.RunningJobCount,
                overview.FailedJobCount);
        });
    }
}

public sealed class ListSeoEngineJobsQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository)
    : IRequestHandler<ListSeoEngineJobsQuery, ErrorOr<IReadOnlyList<SeoEngineJobDto>>>
{
    public Task<ErrorOr<IReadOnlyList<SeoEngineJobDto>>> Handle(ListSeoEngineJobsQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);
            var jobs = await repository.ListJobsAsync(30, cancellationToken);
            return (IReadOnlyList<SeoEngineJobDto>)jobs.Select(SeoEngineDtoMapper.ToJobDto).ToArray();
        });
    }
}

public sealed class ListSeoEngineSchedulesQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineScheduler scheduler)
    : IRequestHandler<ListSeoEngineSchedulesQuery, ErrorOr<IReadOnlyList<SeoEngineScheduleDto>>>
{
    public Task<ErrorOr<IReadOnlyList<SeoEngineScheduleDto>>> Handle(
        ListSeoEngineSchedulesQuery request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var schedules = await scheduler.ListSchedulesAsync(cancellationToken);
            return (IReadOnlyList<SeoEngineScheduleDto>)schedules.Select(SeoEngineDtoMapper.ToScheduleDto).ToArray();
        });
    }
}

public sealed class ListSeoEngineArticlesQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository)
    : IRequestHandler<ListSeoEngineArticlesQuery, ErrorOr<IReadOnlyList<SeoEngineArticleSummaryDto>>>
{
    public Task<ErrorOr<IReadOnlyList<SeoEngineArticleSummaryDto>>> Handle(
        ListSeoEngineArticlesQuery request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var articles = await repository.ListArticlesAsync(request.Status, 100, cancellationToken);
            return (IReadOnlyList<SeoEngineArticleSummaryDto>)articles.Select(SeoEngineDtoMapper.ToSummaryDto).ToArray();
        });
    }
}

public sealed class GetSeoEngineArticleQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository)
    : IRequestHandler<GetSeoEngineArticleQuery, ErrorOr<SeoEngineArticleDetailDto>>
{
    public Task<ErrorOr<SeoEngineArticleDetailDto>> Handle(GetSeoEngineArticleQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<SeoEngineArticleDetailDto>(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var article = await repository.GetArticleAsync(request.ArticleId, cancellationToken);
            if (article is null)
            {
                throw new KeyNotFoundException("SEO Engine article not found.");
            }

            return SeoEngineDtoMapper.ToDetailDto(article);
        });
    }
}

public sealed class GenerateSeoEngineArticleCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository,
    IOptions<SeoEngineAutomationOptions> options,
    ISeoEngineCommandPublisher publisher,
    IAuditTrail auditTrail)
    : IRequestHandler<GenerateSeoEngineArticleCommand, ErrorOr<SeoEngineJobTriggerResponse>>
{
    public async Task<ErrorOr<SeoEngineJobTriggerResponse>> Handle(
        GenerateSeoEngineArticleCommand request,
        CancellationToken cancellationToken)
    {
        var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
        AdminConsoleHandlerHelpers.EnsureAdmin(actor);

        var response = await SeoEngineCommandQueue.QueueAsync(
            actor,
            SeoEngineJobTypes.GenerateArticle,
            "admin",
            null,
            "Queued article generation for SEO Engine.",
            options.Value,
            repository,
            publisher,
            cancellationToken);

        if (response.IsError)
        {
            return response.Errors;
        }

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                actor,
                "admin.seo_engine_job_queued",
                "Queued SEO Engine job",
                "Queued article generation for SEO Engine.",
                entityType: "seo-engine-job",
                entityId: response.Value.JobId.ToString(),
                entityLabel: SeoEngineJobTypes.GenerateArticle,
                metadata: new
                {
                    jobId = response.Value.JobId,
                    jobType = SeoEngineJobTypes.GenerateArticle
                }),
            cancellationToken);

        return response.Value;
    }
}

public sealed class RefreshSeoEngineSitemapCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository,
    IOptions<SeoEngineAutomationOptions> options,
    ISeoEngineCommandPublisher publisher,
    IAuditTrail auditTrail)
    : IRequestHandler<RefreshSeoEngineSitemapCommand, ErrorOr<SeoEngineJobTriggerResponse>>
{
    public async Task<ErrorOr<SeoEngineJobTriggerResponse>> Handle(
        RefreshSeoEngineSitemapCommand request,
        CancellationToken cancellationToken)
    {
        var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
        AdminConsoleHandlerHelpers.EnsureAdmin(actor);

        var response = await SeoEngineCommandQueue.QueueAsync(
            actor,
            SeoEngineJobTypes.RefreshSitemap,
            "admin",
            null,
            "Queued SEO Engine sitemap refresh.",
            options.Value,
            repository,
            publisher,
            cancellationToken);

        if (response.IsError)
        {
            return response.Errors;
        }

        await auditTrail.WriteAsync(
            AuditEventFactory.ForAuthenticatedUser(
                actor,
                "admin.seo_engine_sitemap_refresh_queued",
                "Queued SEO Engine sitemap refresh",
                "Queued sitemap and publish manifest refresh for SEO Engine.",
                entityType: "seo-engine-job",
                entityId: response.Value.JobId.ToString(),
                entityLabel: SeoEngineJobTypes.RefreshSitemap,
                metadata: new
                {
                    jobId = response.Value.JobId,
                    jobType = SeoEngineJobTypes.RefreshSitemap
                }),
            cancellationToken);

        return response.Value;
    }
}

public sealed class UpdateSeoEngineScheduleCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineScheduler scheduler,
    IAuditTrail auditTrail)
    : IRequestHandler<UpdateSeoEngineScheduleCommand, ErrorOr<SeoEngineScheduleDto>>
{
    public Task<ErrorOr<SeoEngineScheduleDto>> Handle(
        UpdateSeoEngineScheduleCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<SeoEngineScheduleDto>(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var jobType = SeoEngineScheduleCatalog.NormalizeJobType(request.JobType);
            var scheduleExpression = SeoEngineScheduleCatalog.RequireValue(
                request.Request.ScheduleExpression,
                "Schedule expression is required.");
            var scheduleTimezone = SeoEngineScheduleCatalog.RequireValue(
                request.Request.ScheduleExpressionTimezone,
                "Schedule timezone is required.");

            var updated = await scheduler.UpdateScheduleAsync(
                jobType,
                new SeoEngineScheduleUpdateRecord(
                    scheduleExpression,
                    scheduleTimezone,
                    request.Request.Enabled),
                cancellationToken);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.seo_engine_schedule_updated",
                    "Updated SEO Engine schedule",
                    $"Updated SEO Engine schedule {jobType}.",
                    entityType: "seo-engine-schedule",
                    entityId: jobType,
                    entityLabel: jobType,
                    metadata: new
                    {
                        jobType,
                        scheduleExpression = updated.ScheduleExpression,
                        scheduleTimezone = updated.ScheduleExpressionTimezone,
                        enabled = updated.Enabled,
                        state = updated.State
                    }),
                cancellationToken);

            return SeoEngineDtoMapper.ToScheduleDto(updated);
        });
    }
}

public sealed class DeleteSeoEngineJobCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository,
    IAuditTrail auditTrail)
    : IRequestHandler<DeleteSeoEngineJobCommand, ErrorOr<Deleted>>
{
    public Task<ErrorOr<Deleted>> Handle(DeleteSeoEngineJobCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<Deleted>(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var job = await repository.GetJobAsync(request.JobId, cancellationToken);
            if (job is null)
            {
                throw new KeyNotFoundException("SEO Engine job not found.");
            }

            if (!SeoEngineJobStatusHelper.IsTerminalJobStatus(job.Status))
            {
                throw new InvalidOperationException("Only completed or failed SEO Engine jobs can be removed from history.");
            }

            var deleted = await repository.DeleteTerminalJobAsync(job.Id, cancellationToken);
            if (!deleted)
            {
                throw new InvalidOperationException("SEO Engine job could not be removed from history.");
            }

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.seo_engine_job_deleted",
                    "Deleted SEO Engine job history entry",
                    $"Deleted SEO Engine job history entry {job.Id}.",
                    entityType: "seo-engine-job",
                    entityId: job.Id.ToString(),
                    entityLabel: job.JobType,
                    metadata: new
                    {
                        jobId = job.Id,
                        jobType = job.JobType,
                        jobStatus = job.Status
                    }),
                cancellationToken);

            return Result.Deleted;
        });
    }
}

public sealed class ClearSeoEngineJobHistoryCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository,
    IAuditTrail auditTrail)
    : IRequestHandler<ClearSeoEngineJobHistoryCommand, ErrorOr<SeoEngineJobHistoryClearResponse>>
{
    public Task<ErrorOr<SeoEngineJobHistoryClearResponse>> Handle(
        ClearSeoEngineJobHistoryCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<SeoEngineJobHistoryClearResponse>(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var deletedCount = await repository.ClearTerminalJobsAsync(cancellationToken);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.seo_engine_job_history_cleared",
                    "Cleared SEO Engine job history",
                    $"Cleared {deletedCount} completed or failed SEO Engine jobs from history.",
                    entityType: "seo-engine-job-history",
                    entityId: "terminal-jobs",
                    metadata: new
                    {
                        deletedCount
                    }),
                cancellationToken);

            return new SeoEngineJobHistoryClearResponse(deletedCount);
        });
    }
}

public sealed class UpdateSeoEngineArticleCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository,
    IOptions<SeoEngineAutomationOptions> options,
    ISeoEngineCommandPublisher publisher,
    IAuditTrail auditTrail)
    : IRequestHandler<UpdateSeoEngineArticleCommand, ErrorOr<SeoEngineArticleDetailDto>>
{
    public Task<ErrorOr<SeoEngineArticleDetailDto>> Handle(
        UpdateSeoEngineArticleCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<SeoEngineArticleDetailDto>(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var existing = await repository.GetArticleAsync(request.ArticleId, cancellationToken);
            if (existing is null)
            {
                throw new KeyNotFoundException("SEO Engine article not found.");
            }

            var title = SeoEngineValueNormalizer.RequiredOrFallback(request.Request.Title, existing.Title);
            var slug = SeoEngineContentFormatter.NormalizeSlug(title, request.Request.Slug ?? existing.Slug);
            var excerpt = SeoEngineValueNormalizer.OptionalOrFallback(request.Request.Excerpt, existing.Excerpt);
            var bodyMarkdown = SeoEngineValueNormalizer.RequiredOrFallback(request.Request.BodyMarkdown, existing.BodyMarkdown);
            var metaTitle = SeoEngineValueNormalizer.OptionalOrFallback(request.Request.MetaTitle, existing.MetaTitle);
            var metaDescription = SeoEngineValueNormalizer.OptionalOrFallback(request.Request.MetaDescription, existing.MetaDescription);
            var tags = request.Request.Tags is null
                ? existing.Tags
                : SeoEngineContentFormatter.NormalizeKeywords(request.Request.Tags, 12);
            var keywords = request.Request.Keywords is null
                ? existing.Keywords
                : SeoEngineContentFormatter.NormalizeKeywords(request.Request.Keywords, 16);

            var sections = SeoEngineContentFormatter.ParseSections(bodyMarkdown);
            var bodyHtml = SeoEngineContentFormatter.BuildHtml(sections);
            var bodyPlainText = SeoEngineContentFormatter.BuildPlainText(sections);
            var fingerprint = SeoEngineContentFormatter.ComputeFingerprint(bodyPlainText);

            var saved = await repository.SaveArticleAsync(
                new SeoEngineArticleSaveRecord(
                    existing.Id,
                    existing.Status,
                    title,
                    slug,
                    excerpt,
                    bodyMarkdown,
                    bodyHtml,
                    bodyPlainText,
                    fingerprint,
                    metaTitle,
                    metaDescription,
                    tags,
                    keywords,
                    existing.SourceCount,
                    existing.LastGeneratedAt,
                    null,
                    actor.Id,
                    Array.Empty<SeoEngineDuplicateWarningRecord>(),
                    sections,
                    existing.Sources),
                cancellationToken);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.seo_engine_article_saved",
                    "Saved SEO Engine article",
                    $"Saved SEO Engine article {saved.Title}.",
                    entityType: "seo-engine-article",
                    entityId: saved.Id.ToString(),
                    entityLabel: saved.Title),
                cancellationToken);

            if (string.Equals(saved.Status, "published", StringComparison.OrdinalIgnoreCase))
            {
                await SeoEngineCommandQueue.QueueRefreshIfConfiguredAsync(
                    actor,
                    options.Value,
                    repository,
                    publisher,
                    cancellationToken);
            }

            return SeoEngineDtoMapper.ToDetailDto(saved);
        });
    }
}

public sealed class PublishSeoEngineArticleCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository,
    IOptions<SeoEngineAutomationOptions> options,
    ISeoEngineCommandPublisher publisher,
    IHttpClientFactory httpClientFactory,
    IAuditTrail auditTrail)
    : IRequestHandler<PublishSeoEngineArticleCommand, ErrorOr<SeoEngineArticleDetailDto>>
{
    public Task<ErrorOr<SeoEngineArticleDetailDto>> Handle(
        PublishSeoEngineArticleCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<SeoEngineArticleDetailDto>(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var existing = await repository.GetArticleAsync(request.ArticleId, cancellationToken);
            if (existing is null)
            {
                throw new KeyNotFoundException("SEO Engine article not found.");
            }

            var warnings = await repository.FindDuplicateWarningsAsync(
                existing.Id,
                existing.Slug,
                existing.Title,
                existing.BodyPlainText,
                SeoEngineContentFormatter.ComputeFingerprint(existing.BodyPlainText),
                existing.Sources.Select(source => source.SourceUrl).ToArray(),
                cancellationToken);

            if (warnings.Any(warning => string.Equals(warning.Severity, "block", StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidOperationException("Clear duplicate warnings must be resolved before publishing.");
            }

            var unreachableSourceUrls = await SeoEnginePublishSourceValidator.FindUnreachableSourceUrlsAsync(
                httpClientFactory.CreateClient(),
                existing.Sources,
                cancellationToken);
            if (unreachableSourceUrls.Length > 0)
            {
                throw new InvalidOperationException(
                    $"This article cannot be published because {unreachableSourceUrls.Length} source link(s) did not resolve: {string.Join(", ", unreachableSourceUrls)}");
            }

            await repository.SaveArticleAsync(
                new SeoEngineArticleSaveRecord(
                    existing.Id,
                    "published",
                    existing.Title,
                    existing.Slug,
                    existing.Excerpt,
                    existing.BodyMarkdown,
                    existing.BodyHtml,
                    existing.BodyPlainText,
                    SeoEngineContentFormatter.ComputeFingerprint(existing.BodyPlainText),
                    existing.MetaTitle,
                    existing.MetaDescription,
                    existing.Tags,
                    existing.Keywords,
                    existing.SourceCount,
                    existing.LastGeneratedAt,
                    null,
                    actor.Id,
                    warnings,
                    existing.Sections,
                    existing.Sources),
                cancellationToken);

            var published = await repository.PublishArticleAsync(existing.Id, actor.Id, cancellationToken)
                ?? throw new InvalidOperationException("Published article could not be loaded.");

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.seo_engine_article_published",
                    "Published SEO Engine article",
                    $"Published SEO Engine article {published.Title}.",
                    entityType: "seo-engine-article",
                    entityId: published.Id.ToString(),
                    entityLabel: published.Title),
                cancellationToken);

            await SeoEngineCommandQueue.QueueRefreshIfConfiguredAsync(
                actor,
                options.Value,
                repository,
                publisher,
                cancellationToken);

            return SeoEngineDtoMapper.ToDetailDto(published);
        });
    }
}

public sealed class DeleteSeoEngineArticleCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    ISeoEngineRepository repository,
    IOptions<SeoEngineAutomationOptions> options,
    ISeoEngineCommandPublisher publisher,
    IAuditTrail auditTrail)
    : IRequestHandler<DeleteSeoEngineArticleCommand, ErrorOr<Deleted>>
{
    public Task<ErrorOr<Deleted>> Handle(DeleteSeoEngineArticleCommand request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<Deleted>(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var deleted = await repository.DeleteArticleAsync(request.ArticleId, actor.Id, cancellationToken);
            if (!deleted)
            {
                throw new KeyNotFoundException("SEO Engine article not found.");
            }

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.seo_engine_article_deleted",
                    "Deleted SEO Engine article",
                    $"Deleted SEO Engine article {request.ArticleId}.",
                    entityType: "seo-engine-article",
                    entityId: request.ArticleId.ToString()),
                cancellationToken);

            await SeoEngineCommandQueue.QueueRefreshIfConfiguredAsync(
                actor,
                options.Value,
                repository,
                publisher,
                cancellationToken);

            return Result.Deleted;
        });
    }
}

internal static class SeoEngineJobStatusHelper
{
    public static bool IsTerminalJobStatus(string status)
    {
        var normalized = status.Trim().ToLowerInvariant();
        return normalized is "completed" or "failed";
    }
}

internal static class SeoEngineDtoMapper
{
    public static SeoEngineJobDto ToJobDto(SeoEngineJobRecord record) =>
        new(
            record.Id,
            record.JobType,
            record.Status,
            record.RequestedSource,
            record.RequestedByEmail,
            record.RequestedByName,
            record.ArticleId,
            record.CreatedAt,
            record.StartedAt,
            record.CompletedAt,
            record.ErrorMessage);

    public static SeoEngineScheduleDto ToScheduleDto(SeoEngineScheduleRecord record)
    {
        var definition = SeoEngineScheduleCatalog.GetDefinition(record.JobType);
        return new SeoEngineScheduleDto(
            record.JobType,
            definition.Label,
            definition.Description,
            record.ScheduleExpression,
            record.ScheduleExpressionTimezone,
            record.Enabled,
            record.State);
    }

    public static SeoEngineArticleSummaryDto ToSummaryDto(SeoEngineArticleListRecord record) =>
        new(
            record.Id,
            record.Status,
            record.Title,
            record.Slug,
            record.Excerpt,
            record.MetaTitle,
            record.MetaDescription,
            record.Tags,
            record.Keywords,
            record.SourceCount,
            record.CreatedAt,
            record.UpdatedAt,
            record.PublishedAt,
            record.DuplicateWarnings.Select(ToDuplicateDto).ToArray());

    public static SeoEngineArticleDetailDto ToDetailDto(SeoEngineArticleRecord record) =>
        new(
            record.Id,
            record.Status,
            record.Title,
            record.Slug,
            record.Excerpt,
            record.BodyMarkdown,
            record.BodyHtml,
            record.BodyPlainText,
            record.MetaTitle,
            record.MetaDescription,
            record.Tags,
            record.Keywords,
            record.SourceCount,
            record.CreatedAt,
            record.UpdatedAt,
            record.LastGeneratedAt,
            record.PublishedAt,
            record.DuplicateWarnings.Select(ToDuplicateDto).ToArray(),
            record.Sections.Select(section => new SeoEngineArticleSectionDto(
                section.SectionId,
                section.Heading,
                section.Paragraphs,
                section.Bullets,
                section.Position)).ToArray(),
            record.Sources.Select(source => new SeoEngineArticleSourceDto(
                source.SourceName,
                source.Publisher,
                source.Headline,
                source.SourceUrl,
                source.PublishedAt,
                source.Summary,
                source.Position)).ToArray());

    public static SeoEngineDuplicateWarningDto ToDuplicateDto(SeoEngineDuplicateWarningRecord record) =>
        new(
            record.Severity,
            record.MatchType,
            record.Message,
            record.ExistingArticleId,
            record.ExistingArticleTitle,
            record.ExistingArticleSlug,
            record.SimilarityScore);
}

internal static class SeoEngineScheduleCatalog
{
    private static readonly IReadOnlyDictionary<string, SeoEngineScheduleDefinition> Definitions =
        new Dictionary<string, SeoEngineScheduleDefinition>(StringComparer.OrdinalIgnoreCase)
        {
            [SeoEngineJobTypes.GenerateArticle] = new(
                "Generate drafts",
                "Create fresh draft insights on a schedule. Use EventBridge cron syntax if you want multiple generation windows."),
            [SeoEngineJobTypes.PublishNextArticle] = new(
                "Publish next ready draft",
                "Automatically publish the next review-ready article. Use comma-separated hours in the cron expression to publish multiple times per day."),
            [SeoEngineJobTypes.RefreshSitemap] = new(
                "Refresh sitemap",
                "Rebuild sitemap.xml and the public insights manifest after content changes.")
        };

    public static SeoEngineScheduleDefinition GetDefinition(string jobType)
    {
        var normalized = NormalizeJobType(jobType);
        return Definitions[normalized];
    }

    public static string NormalizeJobType(string? jobType)
    {
        var normalized = jobType?.Trim();
        if (string.IsNullOrWhiteSpace(normalized) || !Definitions.ContainsKey(normalized))
        {
            throw new InvalidOperationException("Unsupported SEO Engine schedule type.");
        }

        return normalized;
    }

    public static string RequireValue(string? value, string errorMessage)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new InvalidOperationException(errorMessage);
        }

        return normalized;
    }
}

internal sealed record SeoEngineScheduleDefinition(string Label, string Description);

internal static class SeoEngineCommandQueue
{
    public static async Task<ErrorOr<SeoEngineJobTriggerResponse>> QueueAsync(
        UserInfoDto actor,
        string jobType,
        string requestedSource,
        string? notes,
        string acceptanceMessage,
        SeoEngineAutomationOptions options,
        ISeoEngineRepository repository,
        ISeoEngineCommandPublisher publisher,
        CancellationToken cancellationToken)
    {
        if (!options.Enabled)
        {
            return Error.Validation(description: "SEO Engine is disabled for this environment.");
        }

        if (string.IsNullOrWhiteSpace(options.CommandQueueUrl))
        {
            return Error.Validation(description: "SEO Engine queue is not configured.");
        }

        var job = await repository.CreateJobAsync(
            jobType,
            requestedSource,
            actor.Id,
            actor.Email,
            actor.FullName,
            cancellationToken);

        var queuedAt = DateTimeOffset.UtcNow;
        var message = new SeoEngineAutomationCommandMessage(
            job.Id,
            jobType,
            queuedAt,
            new SeoEngineAutomationCommandActor(actor.Id, actor.Email, actor.FullName, actor.IsAdmin),
            SeoEngineValueNormalizer.Optional(notes),
            BuildPayload(options, requestedSource));

        await publisher.PublishAsync(JsonSerializer.Serialize(message), cancellationToken);
        return new SeoEngineJobTriggerResponse(job.Id, jobType, "pending", queuedAt, acceptanceMessage);
    }

    public static async Task QueueRefreshIfConfiguredAsync(
        UserInfoDto actor,
        SeoEngineAutomationOptions options,
        ISeoEngineRepository repository,
        ISeoEngineCommandPublisher publisher,
        CancellationToken cancellationToken)
    {
        if (!options.Enabled || string.IsNullOrWhiteSpace(options.CommandQueueUrl))
        {
            return;
        }

        var job = await repository.CreateJobAsync(
            SeoEngineJobTypes.RefreshSitemap,
            "system",
            actor.Id,
            actor.Email,
            actor.FullName,
            cancellationToken);

        var message = new SeoEngineAutomationCommandMessage(
            job.Id,
            SeoEngineJobTypes.RefreshSitemap,
            DateTimeOffset.UtcNow,
            new SeoEngineAutomationCommandActor(actor.Id, actor.Email, actor.FullName, actor.IsAdmin),
            "Triggered after SEO Engine content change.",
            BuildPayload(options, "system"));

        await publisher.PublishAsync(JsonSerializer.Serialize(message), cancellationToken);
    }

    private static Dictionary<string, string> BuildPayload(SeoEngineAutomationOptions options, string source) =>
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["source"] = source,
            ["marketingHost"] = SeoEngineValueNormalizer.WithFallback(options.MarketingHost, "conveymate.com.au"),
            ["appHost"] = SeoEngineValueNormalizer.WithFallback(options.AppHost, "app.conveymate.com.au")
        };
}

internal static class SeoEngineValueNormalizer
{
    public static string WithFallback(string? value, string fallback)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? fallback : trimmed;
    }

    public static string RequiredOrFallback(string? candidate, string fallback)
    {
        var trimmed = candidate?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? fallback : trimmed;
    }

    public static string OptionalOrFallback(string? candidate, string fallback)
    {
        return Optional(candidate) ?? fallback;
    }

    public static string? Optional(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }
}

internal static class SeoEnginePublishSourceValidator
{
    private static readonly HashSet<HttpStatusCode> ReachableButRestrictedStatuses =
    [
        HttpStatusCode.Unauthorized,
        HttpStatusCode.Forbidden,
        HttpStatusCode.MethodNotAllowed,
        HttpStatusCode.NotAcceptable
    ];

    public static async Task<string[]> FindUnreachableSourceUrlsAsync(
        HttpClient httpClient,
        IReadOnlyList<SeoEngineArticleSourceRecord> sources,
        CancellationToken cancellationToken)
    {
        httpClient.Timeout = TimeSpan.FromSeconds(8);

        var unreachable = new List<string>();
        foreach (var source in sources)
        {
            var sourceUrl = source.SourceUrl?.Trim();
            if (string.IsNullOrWhiteSpace(sourceUrl))
            {
                continue;
            }

            if (!Uri.TryCreate(sourceUrl, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                unreachable.Add(sourceUrl);
                continue;
            }

            if (await IsReachableAsync(httpClient, uri, cancellationToken))
            {
                continue;
            }

            unreachable.Add(sourceUrl);
        }

        return unreachable
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static async Task<bool> IsReachableAsync(HttpClient httpClient, Uri uri, CancellationToken cancellationToken)
    {
        using var headRequest = new HttpRequestMessage(HttpMethod.Head, uri);
        using var headResponse = await SendAsync(httpClient, headRequest, cancellationToken);
        if (headResponse is not null)
        {
            return IsReachableStatusCode(headResponse.StatusCode);
        }

        using var getRequest = new HttpRequestMessage(HttpMethod.Get, uri);
        getRequest.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 0);
        using var getResponse = await SendAsync(httpClient, getRequest, cancellationToken);
        return getResponse is not null && IsReachableStatusCode(getResponse.StatusCode);
    }

    private static async Task<HttpResponseMessage?> SendAsync(
        HttpClient httpClient,
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        try
        {
            return await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch
        {
            return null;
        }
    }

    private static bool IsReachableStatusCode(HttpStatusCode statusCode)
    {
        var numericStatusCode = (int)statusCode;
        return (numericStatusCode >= 200 && numericStatusCode < 400)
               || ReachableButRestrictedStatuses.Contains(statusCode);
    }
}
