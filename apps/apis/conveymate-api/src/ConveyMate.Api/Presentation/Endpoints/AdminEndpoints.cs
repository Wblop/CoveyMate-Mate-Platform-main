using System.Security.Claims;
using Carter;
using MediatR;
using ConveyMate.Api.Application.Admin;
using ConveyMate.Api.Application.Admin.Contracts;
using ConveyMate.Api.Presentation;
using ConveyMate.Api.Security;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Admin-only endpoints for operational access to jobs and users.
/// </summary>
public sealed class AdminEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin")
            .RequireAuthorization(AuthorizationPolicies.Admin);

        group.MapGet("/jobs", async (
                ClaimsPrincipal principal,
                int? page,
                int? pageSize,
                string? search,
                string? status,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new ListAdminJobsQuery(
                        principal,
                        page ?? 1,
                        pageSize ?? 25,
                        search,
                        status),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListJobs");

        group.MapGet("/jobs/{jobId:guid}", async (
                ClaimsPrincipal principal,
                Guid jobId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GetAdminJobDetailQuery(principal, jobId), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Review job was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminGetJobDetail");

        group.MapDelete("/jobs/{jobId:guid}", async (
                ClaimsPrincipal principal,
                Guid jobId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new DeleteAdminJobCommand(principal, jobId), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Review job was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminDeleteJob");

        group.MapDelete("/jobs/{jobId:guid}/quote-workflow", async (
                ClaimsPrincipal principal,
                Guid jobId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new DeleteAdminQuoteWorkflowCommand(principal, jobId), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Quote workflow was not found for this review job.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminDeleteQuoteWorkflow");

        group.MapGet("/jobs/{jobId:guid}/artifacts/{artifact}/download", async (
                ClaimsPrincipal principal,
                Guid jobId,
                string artifact,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new GetAdminJobArtifactDownloadQuery(principal, jobId, artifact),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Requested artifact was not found for this job.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminGetJobArtifactDownload");

        group.MapGet("/jobs/{jobId:guid}/documents/{documentId:guid}/download", async (
                ClaimsPrincipal principal,
                Guid jobId,
                Guid documentId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new GetAdminJobDocumentDownloadQuery(principal, jobId, documentId),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Requested document was not found for this job.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminGetJobDocumentDownload");

        group.MapGet("/feedback", async (
                ClaimsPrincipal principal,
                int? page,
                int? pageSize,
                string? type,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new ListAdminFeedbackQuery(
                        principal,
                        page ?? 1,
                        pageSize ?? 25,
                        type),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "Invalid feedback filter.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListFeedback");

        group.MapGet("/audit", async (
                ClaimsPrincipal principal,
                int? page,
                int? pageSize,
                string? search,
                string? actionCode,
                string? actorType,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new ListAdminAuditEventsQuery(
                        principal,
                        page ?? 1,
                        pageSize ?? 25,
                        search,
                        actionCode,
                        actorType),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "Invalid audit filter.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListAuditEvents");

        group.MapGet("/users", async (
                ClaimsPrincipal principal,
                int? page,
                int? pageSize,
                string? search,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new ListAdminUsersQuery(principal, page ?? 1, pageSize ?? 25, search),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListUsers");

        group.MapGet("/conveyancers", async (
                ClaimsPrincipal principal,
                int? page,
                int? pageSize,
                string? search,
                string? jurisdiction,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new ListAdminConveyancersQuery(principal, page ?? 1, pageSize ?? 25, search, jurisdiction),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "Invalid conveyancer filter.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListConveyancers");

        group.MapPost("/conveyancers", async (
                ClaimsPrincipal principal,
                CreateAdminConveyancerRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new CreateAdminConveyancerCommand(principal, request), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "Invalid conveyancer.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminCreateConveyancer");

        group.MapPut("/conveyancers/{conveyancerId:guid}", async (
                ClaimsPrincipal principal,
                Guid conveyancerId,
                UpdateAdminConveyancerRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new UpdateAdminConveyancerCommand(principal, conveyancerId, request),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "Invalid conveyancer.",
                        notFoundTitle: "Conveyancer was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminUpdateConveyancer");

        group.MapPost("/conveyancers/{conveyancerId:guid}/active", async (
                ClaimsPrincipal principal,
                Guid conveyancerId,
                SetAdminConveyancerActiveRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new SetAdminConveyancerActiveCommand(principal, conveyancerId, request),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Conveyancer was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminSetConveyancerActive");

        group.MapPost("/conveyancers/{conveyancerId:guid}/quote-requests-enabled", async (
                ClaimsPrincipal principal,
                Guid conveyancerId,
                SetAdminConveyancerQuoteRequestsEnabledRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new SetAdminConveyancerQuoteRequestsEnabledCommand(principal, conveyancerId, request),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Conveyancer was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminSetConveyancerQuoteRequestsEnabled");

        group.MapPost("/users/{userId:guid}/suspension", async (
                ClaimsPrincipal principal,
                Guid userId,
                SetUserSuspensionRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new SetAdminUserSuspensionCommand(principal, userId, request),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "User was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminSetUserSuspension");

    }
}
