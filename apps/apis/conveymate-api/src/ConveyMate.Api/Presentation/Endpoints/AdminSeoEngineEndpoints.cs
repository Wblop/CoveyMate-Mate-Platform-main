using System.Security.Claims;
using Carter;
using MediatR;
using ConveyMate.Api.Application.SeoEngine;
using ConveyMate.Api.Presentation;
using ConveyMate.Api.Security;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Admin editorial endpoints for the SEO Engine insights workflow.
/// </summary>
public sealed class AdminSeoEngineEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/seo-engine")
            .RequireAuthorization(AuthorizationPolicies.Admin);

        group.MapGet("/overview", async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GetSeoEngineOverviewQuery(principal), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminGetSeoEngineOverview");

        group.MapGet("/jobs", async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new ListSeoEngineJobsQuery(principal), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListSeoEngineJobs");

        group.MapGet("/schedules", async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new ListSeoEngineSchedulesQuery(principal), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListSeoEngineSchedules");

        group.MapPut("/schedules/{jobType}", async (
                ClaimsPrincipal principal,
                string jobType,
                UpdateSeoEngineScheduleRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new UpdateSeoEngineScheduleCommand(principal, jobType, request), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "SEO Engine schedule update is invalid.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminUpdateSeoEngineSchedule");

        group.MapDelete("/jobs/history", async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new ClearSeoEngineJobHistoryCommand(principal), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "SEO Engine job history could not be cleared.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminClearSeoEngineJobHistory");

        group.MapDelete("/jobs/{jobId:guid}", async (
                ClaimsPrincipal principal,
                Guid jobId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new DeleteSeoEngineJobCommand(principal, jobId), cancellationToken);
                return result.Match(
                    _ => Results.NoContent(),
                    errors => errors.ToHttpResult(
                        validationTitle: "SEO Engine job cannot be removed from history.",
                        notFoundTitle: "SEO Engine job was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminDeleteSeoEngineJob");

        group.MapPost("/jobs/generate-article", async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GenerateSeoEngineArticleCommand(principal), cancellationToken);
                return result.Match(
                    payload => Results.Accepted($"/api/admin/seo-engine/jobs/{payload.JobId}", payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "SEO Engine generation could not be queued.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminGenerateSeoEngineArticle");

        group.MapPost("/sitemap/refresh", async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new RefreshSeoEngineSitemapCommand(principal), cancellationToken);
                return result.Match(
                    payload => Results.Accepted($"/api/admin/seo-engine/jobs/{payload.JobId}", payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "SEO Engine sitemap refresh could not be queued.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminRefreshSeoEngineSitemap");

        group.MapGet("/articles", async (
                ClaimsPrincipal principal,
                string? status,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new ListSeoEngineArticlesQuery(principal, status), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "SEO Engine article filter is invalid.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListSeoEngineArticles");

        group.MapGet("/articles/{articleId:guid}", async (
                ClaimsPrincipal principal,
                Guid articleId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GetSeoEngineArticleQuery(principal, articleId), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "SEO Engine article was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminGetSeoEngineArticle");

        group.MapPut("/articles/{articleId:guid}", async (
                ClaimsPrincipal principal,
                Guid articleId,
                UpdateSeoEngineArticleRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new UpdateSeoEngineArticleCommand(principal, articleId, request), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "SEO Engine article update is invalid.",
                        notFoundTitle: "SEO Engine article was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminUpdateSeoEngineArticle");

        group.MapPost("/articles/{articleId:guid}/publish", async (
                ClaimsPrincipal principal,
                Guid articleId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new PublishSeoEngineArticleCommand(principal, articleId), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "SEO Engine article cannot be published.",
                        notFoundTitle: "SEO Engine article was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminPublishSeoEngineArticle");

        group.MapDelete("/articles/{articleId:guid}", async (
                ClaimsPrincipal principal,
                Guid articleId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new DeleteSeoEngineArticleCommand(principal, articleId), cancellationToken);
                return result.Match(
                    _ => Results.NoContent(),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "SEO Engine article was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminDeleteSeoEngineArticle");
    }
}
