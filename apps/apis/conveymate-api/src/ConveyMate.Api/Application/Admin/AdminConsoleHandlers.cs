using System.Security.Claims;
using System.Text.Json;
using ErrorOr;
using MediatR;
using Microsoft.Extensions.Logging;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Admin.Abstractions;
using ConveyMate.Api.Application.Admin.Contracts;
using ConveyMate.Api.Application.Reviews;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Application.Users.Contracts;
using ConveyMate.Api.Domain.Reviews;

namespace ConveyMate.Api.Application.Admin;

public sealed record ListAdminJobsQuery(
    ClaimsPrincipal Principal,
    int Page,
    int PageSize,
    string? Search,
    string? Status) : IRequest<ErrorOr<AdminJobsPageDto>>;

public sealed record GetAdminJobDetailQuery(ClaimsPrincipal Principal, Guid JobId) : IRequest<ErrorOr<AdminJobDetailDto>>;

public sealed record DeleteAdminJobCommand(ClaimsPrincipal Principal, Guid JobId) : IRequest<ErrorOr<AdminDeleteJobResponse>>;

public sealed record DeleteAdminQuoteWorkflowCommand(ClaimsPrincipal Principal, Guid JobId) : IRequest<ErrorOr<AdminDeleteQuoteWorkflowResponse>>;

public sealed record GetAdminJobArtifactDownloadQuery(
    ClaimsPrincipal Principal,
    Guid JobId,
    string Artifact) : IRequest<ErrorOr<AdminStorageDownloadUrlResponse>>;

public sealed record GetAdminJobDocumentDownloadQuery(
    ClaimsPrincipal Principal,
    Guid JobId,
    Guid DocumentId) : IRequest<ErrorOr<AdminStorageDownloadUrlResponse>>;

public sealed record ListAdminFeedbackQuery(
    ClaimsPrincipal Principal,
    int Page,
    int PageSize,
    string? Type) : IRequest<ErrorOr<AdminFeedbackPageDto>>;

public sealed record ListAdminUsersQuery(
    ClaimsPrincipal Principal,
    int Page,
    int PageSize,
    string? Search) : IRequest<ErrorOr<AdminUsersPageDto>>;

public sealed record SetAdminUserSuspensionCommand(
    ClaimsPrincipal Principal,
    Guid UserId,
    SetUserSuspensionRequest Request) : IRequest<ErrorOr<AdminUserDto>>;

public sealed class ListAdminJobsQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository)
    : IRequestHandler<ListAdminJobsQuery, ErrorOr<AdminJobsPageDto>>
{
    public Task<ErrorOr<AdminJobsPageDto>> Handle(ListAdminJobsQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var page = Math.Max(1, request.Page);
            var pageSize = Math.Clamp(request.PageSize <= 0 ? 25 : request.PageSize, 1, 100);
            var list = await adminConsoleRepository.ListJobsAsync(
                page,
                pageSize,
                AdminConsoleHandlerHelpers.NormalizeSearch(request.Search),
                AdminConsoleHandlerHelpers.NormalizeStatus(request.Status),
                cancellationToken);

            var totalPages = list.TotalCount <= 0
                ? 0
                : (int)Math.Ceiling(list.TotalCount / (double)pageSize);

            return new AdminJobsPageDto(
                list.Jobs.Select(job => new AdminJobSummaryDto(
                    job.Id,
                    job.UserId,
                    job.UserEmail,
                    job.UserFullName,
                    job.PropertyAddress,
                    job.Status,
                    job.PaymentStatus,
                    job.AmountAudCents,
                    job.CreatedAt,
                    job.UpdatedAt,
                    job.StartedAt,
                    job.CompletedAt,
                    job.ErrorMessage,
                    job.HasQuoteWorkflow)).ToArray(),
                page,
                pageSize,
                list.TotalCount,
                totalPages);
        });
    }
}

public sealed class ListAdminFeedbackQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository)
    : IRequestHandler<ListAdminFeedbackQuery, ErrorOr<AdminFeedbackPageDto>>
{
    public Task<ErrorOr<AdminFeedbackPageDto>> Handle(ListAdminFeedbackQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var page = Math.Max(1, request.Page);
            var pageSize = Math.Clamp(request.PageSize <= 0 ? 25 : request.PageSize, 1, 100);
            var list = await adminConsoleRepository.ListFeedbackAsync(
                page,
                pageSize,
                AdminConsoleHandlerHelpers.NormalizeFeedbackType(request.Type),
                cancellationToken);

            var totalPages = list.TotalCount <= 0
                ? 0
                : (int)Math.Ceiling(list.TotalCount / (double)pageSize);

            return new AdminFeedbackPageDto(
                list.Feedback.Select(item => new AdminFeedbackDto(
                    item.Id,
                    item.UserId,
                    item.UserEmail,
                    item.UserFullName,
                    item.Type,
                    item.Message,
                    item.PageUrl,
                    item.UserAgent,
                    item.CreatedAt)).ToArray(),
                page,
                pageSize,
                list.TotalCount,
                totalPages);
        });
    }
}

public sealed class GetAdminJobDetailQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository)
    : IRequestHandler<GetAdminJobDetailQuery, ErrorOr<AdminJobDetailDto>>
{
    public async Task<ErrorOr<AdminJobDetailDto>> Handle(GetAdminJobDetailQuery request, CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var job = await adminConsoleRepository.GetJobByIdAsync(request.JobId, cancellationToken);
            if (job is null)
            {
                return null;
            }

            var uploadedDocuments = await adminConsoleRepository.ListJobDocumentsAsync(request.JobId, cancellationToken);
            var reportJsonKey = AdminConsoleHandlerHelpers.BuildReportJsonS3Key(job.Id);
            var (percent, currentStep, currentSubStep, lastUpdatedUtc) = ReviewProgress.Read(job.ProgressJson, job.Status);

            return new AdminJobDetailDto(
                job.Id,
                job.UserId,
                job.UserEmail,
                job.UserFullName,
                job.PropertyAddress,
                job.BuyerType,
                AdminConsoleHandlerHelpers.ParseJson(job.BuyerContextJson),
                job.StateOrTerritory,
                job.LocalGovernmentArea,
                job.PropertyTenureType,
                job.PackType,
                job.Status,
                job.PaymentStatus,
                job.AmountAudCents,
                job.StripePaymentIntentId,
                job.ReportS3Key,
                reportJsonKey,
                job.ErrorMessage,
                job.CreatedAt,
                job.UpdatedAt,
                job.StartedAt,
                job.CompletedAt,
                percent,
                currentStep,
                currentSubStep,
                lastUpdatedUtc,
                AdminConsoleHandlerHelpers.ParseJson(job.SummaryJson),
                uploadedDocuments.Select(document => new AdminJobDocumentDto(
                    document.Id,
                    document.FileName,
                    document.ContentType,
                    document.DocType,
                    document.S3KeyRaw,
                    document.UploadedAt)).ToArray(),
                job.HasQuoteWorkflow,
                job.QuoteWorkflowStatus,
                job.QuoteWorkflowTargetCount,
                job.QuoteWorkflowResponseCount);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Review job was not found.")
            : result.Value;
    }
}

public sealed class DeleteAdminJobCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository,
    IReviewStorageService reviewStorageService,
    ILogger<DeleteAdminJobCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<DeleteAdminJobCommand, ErrorOr<AdminDeleteJobResponse>>
{
    public async Task<ErrorOr<AdminDeleteJobResponse>> Handle(DeleteAdminJobCommand request, CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var deleteCandidate = await adminConsoleRepository.GetJobDeleteCandidateAsync(request.JobId, cancellationToken);
            if (deleteCandidate is null)
            {
                return null;
            }

            var deleted = await adminConsoleRepository.DeleteJobAsync(request.JobId, cancellationToken);
            if (!deleted)
            {
                return null;
            }

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) deleted job {JobId} (owner: {OwnerId}).",
                actor.Id, actor.Email, request.JobId, deleteCandidate.UserId);

            var targetUser = await adminConsoleRepository.GetUserByIdAsync(deleteCandidate.UserId, cancellationToken);
            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.job_deleted",
                    "Delete job",
                    $"Deleted review job {request.JobId}.",
                    deleteCandidate.UserId,
                    targetUser?.Email,
                    targetUser?.FullName,
                    entityType: "review-job",
                    entityId: request.JobId.ToString(),
                    entityLabel: $"Job {request.JobId}",
                    metadata: new
                    {
                        deletedStorageObjectCount = BuildStorageKeys(deleteCandidate).Count
                    }),
                cancellationToken);

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
                        "Admin deleted job {JobId} but one or more storage objects could not be deleted.",
                        request.JobId);
                }
            }

            return new AdminDeleteJobResponse(request.JobId, true, storageKeys.Count);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Review job was not found.")
            : result.Value;
    }

    private static IReadOnlyList<string> BuildStorageKeys(AdminDeleteJobCandidateRecord deleteCandidate)
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

public sealed class DeleteAdminQuoteWorkflowCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository,
    ILogger<DeleteAdminQuoteWorkflowCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<DeleteAdminQuoteWorkflowCommand, ErrorOr<AdminDeleteQuoteWorkflowResponse>>
{
    public async Task<ErrorOr<AdminDeleteQuoteWorkflowResponse>> Handle(
        DeleteAdminQuoteWorkflowCommand request,
        CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var deleteCandidate = await adminConsoleRepository.GetQuoteWorkflowDeleteCandidateAsync(request.JobId, cancellationToken);
            if (deleteCandidate is null)
            {
                return null;
            }

            var deletedCount = await adminConsoleRepository.DeleteQuoteWorkflowsAsync(request.JobId, cancellationToken);
            if (deletedCount <= 0)
            {
                return null;
            }

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) deleted {WorkflowCount} quote workflow(s) for job {JobId} (owner: {OwnerId}).",
                actor.Id,
                actor.Email,
                deletedCount,
                request.JobId,
                deleteCandidate.UserId);

            var targetUser = await adminConsoleRepository.GetUserByIdAsync(deleteCandidate.UserId, cancellationToken);
            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.quote_workflow_deleted",
                    "Delete quote workflow",
                    $"Deleted quote workflow records for review job {request.JobId}.",
                    deleteCandidate.UserId,
                    targetUser?.Email,
                    targetUser?.FullName,
                    entityType: "review-job",
                    entityId: request.JobId.ToString(),
                    entityLabel: $"Job {request.JobId}",
                    metadata: new
                    {
                        deletedWorkflowCount = deletedCount
                    }),
                cancellationToken);

            return new AdminDeleteQuoteWorkflowResponse(request.JobId, true, deletedCount);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Quote workflow was not found for this review job.")
            : result.Value;
    }
}

public sealed class GetAdminJobArtifactDownloadQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository,
    IReviewStorageService reviewStorageService,
    IAuditTrail auditTrail)
    : IRequestHandler<GetAdminJobArtifactDownloadQuery, ErrorOr<AdminStorageDownloadUrlResponse>>
{
    public async Task<ErrorOr<AdminStorageDownloadUrlResponse>> Handle(
        GetAdminJobArtifactDownloadQuery request,
        CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var job = await adminConsoleRepository.GetJobByIdAsync(request.JobId, cancellationToken);
            if (job is null)
            {
                return null;
            }

            var artifact = (request.Artifact ?? string.Empty).Trim().ToLowerInvariant();
            var key = artifact switch
            {
                "report-pdf" when string.Equals(job.Status, ReviewJobStatus.Completed, StringComparison.Ordinal) &&
                                  !string.IsNullOrWhiteSpace(job.ReportS3Key)
                    => job.ReportS3Key!,
                "report-json" when string.Equals(job.Status, ReviewJobStatus.Completed, StringComparison.Ordinal)
                    => AdminConsoleHandlerHelpers.BuildReportJsonS3Key(job.Id),
                _ => null
            };

            if (string.IsNullOrWhiteSpace(key))
            {
                return null;
            }

            var (url, expiresAtUtc) = reviewStorageService.CreateDownloadUrl(key);
            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.job_artifact_download_requested",
                    "Download artifact",
                    $"Requested {artifact} for {job.PropertyAddress}.",
                    job.UserId,
                    job.UserEmail,
                    job.UserFullName,
                    entityType: "review-job",
                    entityId: job.Id.ToString(),
                    entityLabel: job.PropertyAddress,
                    metadata: new
                    {
                        artifact,
                        s3Key = key
                    }),
                cancellationToken);

            return new AdminStorageDownloadUrlResponse(key, url, expiresAtUtc);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Requested artifact was not found for this job.")
            : result.Value;
    }
}

public sealed class GetAdminJobDocumentDownloadQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository,
    IReviewStorageService reviewStorageService,
    IAuditTrail auditTrail)
    : IRequestHandler<GetAdminJobDocumentDownloadQuery, ErrorOr<AdminStorageDownloadUrlResponse>>
{
    public async Task<ErrorOr<AdminStorageDownloadUrlResponse>> Handle(
        GetAdminJobDocumentDownloadQuery request,
        CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var document = await adminConsoleRepository.GetJobDocumentAsync(
                request.JobId,
                request.DocumentId,
                cancellationToken);
            if (document is null)
            {
                return null;
            }

            var (url, expiresAtUtc) = reviewStorageService.CreateDownloadUrl(document.S3KeyRaw);
            var targetUser = await adminConsoleRepository.GetUserByIdAsync(document.UserId, cancellationToken);
            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.job_document_download_requested",
                    "Download source document",
                    $"Requested source document {document.FileName}.",
                    document.UserId,
                    targetUser?.Email,
                    targetUser?.FullName,
                    entityType: "job-document",
                    entityId: document.Id.ToString(),
                    entityLabel: document.FileName,
                    metadata: new
                    {
                        jobId = document.JobId,
                        document.DocType
                    }),
                cancellationToken);

            return new AdminStorageDownloadUrlResponse(document.S3KeyRaw, url, expiresAtUtc);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Requested document was not found for this job.")
            : result.Value;
    }
}

public sealed class ListAdminUsersQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository)
    : IRequestHandler<ListAdminUsersQuery, ErrorOr<AdminUsersPageDto>>
{
    public Task<ErrorOr<AdminUsersPageDto>> Handle(ListAdminUsersQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var page = Math.Max(1, request.Page);
            var pageSize = Math.Clamp(request.PageSize <= 0 ? 25 : request.PageSize, 1, 100);
            var list = await adminConsoleRepository.ListUsersAsync(
                page,
                pageSize,
                AdminConsoleHandlerHelpers.NormalizeSearch(request.Search),
                cancellationToken);
            var totalPages = list.TotalCount <= 0
                ? 0
                : (int)Math.Ceiling(list.TotalCount / (double)pageSize);

            return new AdminUsersPageDto(
                list.Users.Select(AdminConsoleHandlerHelpers.ToAdminUserDto).ToArray(),
                page,
                pageSize,
                list.TotalCount,
                totalPages);
        });
    }
}

public sealed class SetAdminUserSuspensionCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAdminConsoleRepository adminConsoleRepository,
    ILogger<SetAdminUserSuspensionCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<SetAdminUserSuspensionCommand, ErrorOr<AdminUserDto>>
{
    public async Task<ErrorOr<AdminUserDto>> Handle(SetAdminUserSuspensionCommand request, CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            if (request.Request.IsSuspended && actor.Id == request.UserId)
            {
                throw new InvalidOperationException("You cannot suspend your own account.");
            }

            var updatedUser = await adminConsoleRepository.SetUserSuspensionAsync(
                request.UserId,
                request.Request.IsSuspended,
                cancellationToken);
            if (updatedUser is null)
            {
                return null;
            }

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) {Action} user {TargetUserId} ({TargetEmail}).",
                actor.Id, actor.Email,
                request.Request.IsSuspended ? "suspended" : "unsuspended",
                updatedUser.Id, updatedUser.Email);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.user_suspension_changed",
                    request.Request.IsSuspended ? "Suspend user" : "Unsuspend user",
                    $"{(request.Request.IsSuspended ? "Suspended" : "Unsuspended")} {updatedUser.Email}.",
                    updatedUser.Id,
                    updatedUser.Email,
                    updatedUser.FullName,
                    entityType: "user",
                    entityId: updatedUser.Id.ToString(),
                    entityLabel: updatedUser.Email,
                    metadata: new
                    {
                        isSuspended = request.Request.IsSuspended
                    }),
                cancellationToken);

            return AdminConsoleHandlerHelpers.ToAdminUserDto(updatedUser);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "User was not found.")
            : result.Value;
    }
}

internal static class AdminConsoleHandlerHelpers
{
    private static readonly HashSet<string> AllowedFeedbackTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "bug",
        "suggestion",
        "general"
    };

    public static void EnsureAdmin(UserInfoDto actor)
    {
        if (!actor.IsAdmin)
        {
            throw new UnauthorizedAccessException("Admin access is required.");
        }
    }

    public static AdminUserDto ToAdminUserDto(AdminUserRecord user)
    {
        return new AdminUserDto(
            user.Id,
            user.FullName,
            user.Email,
            user.IsAdmin,
            user.IsSuspended,
            user.CreatedAt,
            user.LastLoginAtUtc,
            user.JobsRunCount,
            user.TotalSpentAudCents);
    }

    public static string? NormalizeSearch(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Trim();
    }

    public static string? NormalizeStatus(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Trim();
    }

    public static string? NormalizeFeedbackType(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim().ToLowerInvariant();
        if (!AllowedFeedbackTypes.Contains(normalized))
        {
            throw new ArgumentException("Feedback type filter must be one of: bug, suggestion, general.");
        }

        return normalized;
    }

    public static object? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<object>(json);
        }
        catch
        {
            return null;
        }
    }

    public static string BuildReportJsonS3Key(Guid jobId)
    {
        return $"reports/{jobId}/report.json";
    }
}
