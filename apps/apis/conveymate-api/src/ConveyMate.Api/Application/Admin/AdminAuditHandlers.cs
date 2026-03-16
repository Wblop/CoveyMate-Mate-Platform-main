using System.Security.Claims;
using ErrorOr;
using MediatR;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Admin.Contracts;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Users.Abstractions;

namespace ConveyMate.Api.Application.Admin;

public sealed record ListAdminAuditEventsQuery(
    ClaimsPrincipal Principal,
    int Page,
    int PageSize,
    string? Search,
    string? ActionCode,
    string? ActorType) : IRequest<ErrorOr<AdminAuditPageDto>>;

public sealed class ListAdminAuditEventsQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    IAuditRepository auditRepository)
    : IRequestHandler<ListAdminAuditEventsQuery, ErrorOr<AdminAuditPageDto>>
{
    public Task<ErrorOr<AdminAuditPageDto>> Handle(ListAdminAuditEventsQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            AdminConsoleHandlerHelpers.EnsureAdmin(actor);

            var page = Math.Max(1, request.Page);
            var pageSize = Math.Clamp(request.PageSize <= 0 ? 25 : request.PageSize, 1, 100);
            var list = await auditRepository.ListForAdminAsync(
                page,
                pageSize,
                AdminConsoleHandlerHelpers.NormalizeSearch(request.Search),
                NormalizeActionCode(request.ActionCode),
                NormalizeActorType(request.ActorType),
                cancellationToken);
            var summary = await auditRepository.GetAdminSummaryAsync(cancellationToken);

            var totalPages = list.TotalCount <= 0
                ? 0
                : (int)Math.Ceiling(list.TotalCount / (double)pageSize);

            return new AdminAuditPageDto(
                list.Items.Select(item => new AdminAuditEventDto(
                    item.Id,
                    item.OccurredAt,
                    item.ActionCode,
                    item.ActionGroup,
                    item.ActionLabel,
                    item.Description,
                    item.Source,
                    item.ActorType,
                    item.ActorUserId,
                    item.ActorEmail,
                    item.ActorName,
                    item.SubjectUserId,
                    item.SubjectEmail,
                    item.SubjectName,
                    item.EntityType,
                    item.EntityId,
                    item.EntityLabel,
                    item.RequestPath,
                    item.RequestMethod,
                    item.IpAddress)).ToArray(),
                page,
                pageSize,
                list.TotalCount,
                totalPages,
                new AdminAuditSummaryDto(
                    summary.EventsLast24Hours,
                    summary.EventsLast7Days,
                    summary.UniqueActorsLast7Days,
                    summary.SignInsLast7Days,
                    summary.ReportsStartedLast7Days,
                    summary.QuoteInteractionsLast7Days,
                    summary.DocumentDownloadsLast7Days,
                    summary.TopActions.Select(item => new AdminAuditActionMetricDto(
                        item.ActionCode,
                        item.ActionLabel,
                        item.Count)).ToArray()));
        });
    }

    private static string? NormalizeActionCode(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private static string? NormalizeActorType(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return normalized is "user" or "admin" or "conveyancer" or "anonymous" or "system"
            ? normalized
            : null;
    }
}
