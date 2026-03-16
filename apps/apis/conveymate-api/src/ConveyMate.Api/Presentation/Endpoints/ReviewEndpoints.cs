using System.Security.Claims;
using Carter;
using MediatR;
using ConveyMate.Api.Application.Reviews;
using ConveyMate.Api.Application.Reviews.Contracts;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Authenticated HTTP endpoints for review creation, payment, status, and downloads.
/// </summary>
public sealed class ReviewEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/reviews")
            .RequireAuthorization();

        group.MapPost("/", () =>
                RetiredWorkflowResult("The review workflow no longer accepts new submissions. Existing reports remain available."))
            .WithName("CreateReview");

        group.MapPost("/{id:guid}/finalize-uploads", () =>
                RetiredWorkflowResult("Upload finalisation is no longer available because the review workflow has been retired."))
            .WithName("FinalizeReviewUploads");

        group.MapPost("/{id:guid}/pay", () =>
                RetiredWorkflowResult("Payment initiation is no longer available because the review workflow has been retired."))
            .WithName("CreateReviewPaymentIntent");

        group.MapPost("/{id:guid}/acknowledge-disclaimer", () =>
                RetiredWorkflowResult("Disclaimer acknowledgement is no longer available because the review workflow has been retired."))
            .WithName("AcknowledgeReviewDisclaimer");

        group.MapPost("/{id:guid}/confirm-payment", () =>
                RetiredWorkflowResult("Payment confirmation is no longer available because the review workflow has been retired."))
            .WithName("ConfirmReviewPayment");

        group.MapGet("/", async (
                ClaimsPrincipal principal,
                bool? includeArchived,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new ListReviewsQuery(principal, includeArchived == true), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult());
            })
            .WithName("ListReviews");

        group.MapGet("/pipeline-model", async (
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GetReviewPipelineModelQuery(), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult());
            })
            .WithName("GetReviewPipelineModel");

        group.MapGet("/{id:guid}", async (
                ClaimsPrincipal principal,
                Guid id,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GetReviewQuery(principal, id), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(notFoundTitle: "Review job was not found."));
            })
            .WithName("GetReview");

        group.MapGet("/{id:guid}/events", async (
                ClaimsPrincipal principal,
                Guid id,
                DateTimeOffset? sinceUtc,
                int? limit,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new ListReviewProgressEventsQuery(principal, id, sinceUtc, limit ?? 100),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult());
            })
            .WithName("GetReviewProgressEvents");

        group.MapGet("/{id:guid}/download", async (
                ClaimsPrincipal principal,
                Guid id,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GetReviewDownloadQuery(principal, id), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(notFoundTitle: "Review report was not found."));
            })
            .WithName("GetReviewDownload");

        group.MapPost("/{id:guid}/archive", async (
                ClaimsPrincipal principal,
                Guid id,
                SetReviewArchiveStatusRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new SetReviewArchiveStatusCommand(principal, id, request), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(notFoundTitle: "Review job was not found."));
            })
            .WithName("SetReviewArchiveStatus");

        group.MapDelete("/{id:guid}", async (
                ClaimsPrincipal principal,
                Guid id,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new DeleteReviewJobCommand(principal, id), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(notFoundTitle: "Review job was not found."));
            })
            .WithName("DeleteReview");
    }

    private static IResult RetiredWorkflowResult(string detail)
    {
        return Results.Problem(
            title: "Review workflow retired.",
            detail: detail,
            statusCode: StatusCodes.Status410Gone);
    }
}
