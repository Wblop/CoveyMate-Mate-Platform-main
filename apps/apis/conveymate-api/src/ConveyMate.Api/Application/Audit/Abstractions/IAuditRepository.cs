namespace ConveyMate.Api.Application.Audit.Abstractions;

public interface IAuditRepository
{
    Task InsertAsync(AuditEventCreateRecord record, CancellationToken cancellationToken);

    Task<AdminAuditEventListRecord> ListForAdminAsync(
        int page,
        int pageSize,
        string? search,
        string? actionCode,
        string? actorType,
        CancellationToken cancellationToken);

    Task<AdminAuditSummaryRecord> GetAdminSummaryAsync(CancellationToken cancellationToken);
}

public sealed record AuditEventCreateRecord(
    DateTimeOffset OccurredAt,
    string ActionCode,
    string ActionGroup,
    string ActionLabel,
    string? Description,
    string Source,
    string ActorType,
    Guid? ActorUserId,
    string? ActorEmail,
    string? ActorName,
    Guid? SubjectUserId,
    string? SubjectEmail,
    string? SubjectName,
    string? EntityType,
    string? EntityId,
    string? EntityLabel,
    string? RequestPath,
    string? RequestMethod,
    string? IpAddress,
    string? UserAgent,
    string MetadataJson);

public sealed record AdminAuditEventListRecord(
    IReadOnlyList<AdminAuditEventRecord> Items,
    int TotalCount);

public sealed record AdminAuditEventRecord(
    long Id,
    DateTimeOffset OccurredAt,
    string ActionCode,
    string ActionGroup,
    string ActionLabel,
    string? Description,
    string Source,
    string ActorType,
    Guid? ActorUserId,
    string? ActorEmail,
    string? ActorName,
    Guid? SubjectUserId,
    string? SubjectEmail,
    string? SubjectName,
    string? EntityType,
    string? EntityId,
    string? EntityLabel,
    string? RequestPath,
    string? RequestMethod,
    string? IpAddress);

public sealed record AdminAuditSummaryRecord(
    int EventsLast24Hours,
    int EventsLast7Days,
    int UniqueActorsLast7Days,
    int SignInsLast7Days,
    int ReportsStartedLast7Days,
    int QuoteInteractionsLast7Days,
    int DocumentDownloadsLast7Days,
    IReadOnlyList<AdminAuditActionMetricRecord> TopActions);

public sealed record AdminAuditActionMetricRecord(
    string ActionCode,
    string ActionLabel,
    int Count);
