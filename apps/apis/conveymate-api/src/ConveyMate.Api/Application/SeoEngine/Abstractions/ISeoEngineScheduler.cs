namespace ConveyMate.Api.Application.SeoEngine.Abstractions;

public sealed record SeoEngineScheduleRecord(
    string JobType,
    string ScheduleExpression,
    string ScheduleExpressionTimezone,
    bool Enabled,
    string State);

public sealed record SeoEngineScheduleUpdateRecord(
    string ScheduleExpression,
    string ScheduleExpressionTimezone,
    bool Enabled);

public interface ISeoEngineScheduler
{
    Task<IReadOnlyList<SeoEngineScheduleRecord>> ListSchedulesAsync(CancellationToken cancellationToken);

    Task<SeoEngineScheduleRecord> UpdateScheduleAsync(
        string jobType,
        SeoEngineScheduleUpdateRecord update,
        CancellationToken cancellationToken);
}
