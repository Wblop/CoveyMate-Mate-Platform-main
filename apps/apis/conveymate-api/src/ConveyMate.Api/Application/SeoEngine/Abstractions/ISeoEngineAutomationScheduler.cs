namespace ConveyMate.Api.Application.SeoEngine.Abstractions;

public interface ISeoEngineAutomationScheduler
{
    Task<IReadOnlyList<SeoEngineAutomationScheduleRecord>> ListSchedulesAsync(CancellationToken cancellationToken);

    Task<SeoEngineAutomationScheduleRecord> UpdateScheduleAsync(
        string scheduleKey,
        bool enabled,
        string timeOfDayLocal,
        CancellationToken cancellationToken);
}

public sealed record SeoEngineAutomationScheduleRecord(
    string Key,
    string JobType,
    string Label,
    string Description,
    bool Enabled,
    string TimeOfDayLocal,
    string Timezone,
    DateTimeOffset? LastModifiedAtUtc,
    bool Available,
    bool RefreshesSitemap);
