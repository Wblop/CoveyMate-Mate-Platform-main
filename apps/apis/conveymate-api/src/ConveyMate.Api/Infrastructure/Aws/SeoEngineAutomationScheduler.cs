using System.Globalization;
using System.Text.RegularExpressions;
using Amazon.Scheduler;
using Amazon.Scheduler.Model;
using Microsoft.Extensions.Configuration;
using ConveyMate.Api.Application.SeoEngine;
using ConveyMate.Api.Application.SeoEngine.Abstractions;

namespace ConveyMate.Api.Infrastructure.Aws;

public sealed class SeoEngineAutomationScheduler(
    IAmazonScheduler schedulerClient,
    IConfiguration configuration)
    : ISeoEngineAutomationScheduler
{
    private const string DefaultAppName = "conveymate";
    private const string DefaultEnvironmentName = "www";
    private const string DefaultGroupName = "default";
    private const string DefaultTimezone = "Australia/Sydney";
    private const string SchedulerDefaultTimezone = "UTC";
    private static readonly Regex DailyCronPattern = new(
        @"^cron\((?<minute>\d{1,2})\s+(?<hour>\d{1,2})\s+\*\s+\*\s+\?\s+\*\)$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    public async Task<IReadOnlyList<SeoEngineAutomationScheduleRecord>> ListSchedulesAsync(CancellationToken cancellationToken)
    {
        var schedules = new List<SeoEngineAutomationScheduleRecord>();
        foreach (var definition in GetDefinitions())
        {
            schedules.Add(await GetScheduleAsync(definition, cancellationToken));
        }

        return schedules;
    }

    public async Task<SeoEngineAutomationScheduleRecord> UpdateScheduleAsync(
        string scheduleKey,
        bool enabled,
        string timeOfDayLocal,
        CancellationToken cancellationToken)
    {
        var definition = GetDefinitions().FirstOrDefault(item =>
            string.Equals(item.Key, scheduleKey?.Trim(), StringComparison.OrdinalIgnoreCase));

        if (definition is null)
        {
            throw new InvalidOperationException("SEO Engine automation schedule is invalid.");
        }

        if (!TimeOnly.TryParseExact(timeOfDayLocal?.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedTime))
        {
            throw new InvalidOperationException("Automation time must use 24-hour HH:mm format.");
        }

        GetScheduleResponse existing;
        try
        {
            existing = await schedulerClient.GetScheduleAsync(
                new GetScheduleRequest
                {
                    GroupName = DefaultGroupName,
                    Name = definition.Name
                },
                cancellationToken);
        }
        catch (ResourceNotFoundException)
        {
            throw new InvalidOperationException("The requested SEO automation schedule is not available yet. Redeploy the SEO stack first.");
        }

        await schedulerClient.UpdateScheduleAsync(
            new UpdateScheduleRequest
            {
                GroupName = existing.GroupName,
                Name = existing.Name,
                Description = existing.Description,
                ScheduleExpression = $"cron({parsedTime.Minute} {parsedTime.Hour} * * ? *)",
                ScheduleExpressionTimezone = DefaultTimezone,
                State = enabled ? ScheduleState.ENABLED : ScheduleState.DISABLED,
                FlexibleTimeWindow = existing.FlexibleTimeWindow,
                ActionAfterCompletion = existing.ActionAfterCompletion,
                Target = existing.Target
            },
            cancellationToken);

        return await GetScheduleAsync(definition, cancellationToken);
    }

    private async Task<SeoEngineAutomationScheduleRecord> GetScheduleAsync(
        SeoEngineScheduleDefinition definition,
        CancellationToken cancellationToken)
    {
        try
        {
            var response = await schedulerClient.GetScheduleAsync(
                new GetScheduleRequest
                {
                    GroupName = DefaultGroupName,
                    Name = definition.Name
                },
                cancellationToken);

            return new SeoEngineAutomationScheduleRecord(
                definition.Key,
                definition.JobType,
                definition.Label,
                definition.Description,
                response.State == ScheduleState.ENABLED,
                ResolveLocalTime(response.ScheduleExpression, response.ScheduleExpressionTimezone),
                string.IsNullOrWhiteSpace(response.ScheduleExpressionTimezone) ? SchedulerDefaultTimezone : response.ScheduleExpressionTimezone,
                response.LastModificationDate.HasValue
                    ? new DateTimeOffset(response.LastModificationDate.Value.ToUniversalTime())
                    : null,
                true,
                definition.RefreshesSitemap);
        }
        catch (ResourceNotFoundException)
        {
            return new SeoEngineAutomationScheduleRecord(
                definition.Key,
                definition.JobType,
                definition.Label,
                definition.Description,
                false,
                definition.DefaultTimeOfDayLocal,
                DefaultTimezone,
                null,
                false,
                definition.RefreshesSitemap);
        }
    }

    private IReadOnlyList<SeoEngineScheduleDefinition> GetDefinitions()
    {
        var appName = configuration["SeoEngineAutomation:AppName"]?.Trim();
        if (string.IsNullOrWhiteSpace(appName))
        {
            appName = DefaultAppName;
        }

        var environmentName = configuration["ConveyMate:ConfigEnvironment"]?.Trim();
        if (string.IsNullOrWhiteSpace(environmentName))
        {
            environmentName = DefaultEnvironmentName;
        }

        environmentName = environmentName.ToLowerInvariant();

        return
        [
            new SeoEngineScheduleDefinition(
                "generate-article",
                SeoEngineJobTypes.GenerateArticle,
                $"{appName}-{environmentName}-seo-generate-article",
                "Generate draft",
                "Queue one fresh draft article each day.",
                "07:00",
                false),
            new SeoEngineScheduleDefinition(
                "publish-next-article",
                SeoEngineJobTypes.PublishNextArticle,
                $"{appName}-{environmentName}-seo-publish-next-article",
                "Publish ready draft",
                "Publish the most recently updated ready draft each day and refresh the sitemap in the same job.",
                "10:00",
                true),
            new SeoEngineScheduleDefinition(
                "refresh-sitemap",
                SeoEngineJobTypes.RefreshSitemap,
                $"{appName}-{environmentName}-seo-refresh-sitemap",
                "Refresh sitemap",
                "Regenerate the sitemap without publishing an article.",
                "10:00",
                false)
        ];
    }

    private static string ResolveLocalTime(string? scheduleExpression, string? scheduleTimezone)
    {
        if (string.IsNullOrWhiteSpace(scheduleExpression))
        {
            return "10:00";
        }

        var match = DailyCronPattern.Match(scheduleExpression.Trim());
        if (!match.Success
            || !int.TryParse(match.Groups["hour"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var hour)
            || !int.TryParse(match.Groups["minute"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var minute))
        {
            return "10:00";
        }

        var sourceTimezone = ResolveTimezone(string.IsNullOrWhiteSpace(scheduleTimezone) ? SchedulerDefaultTimezone : scheduleTimezone);
        var localTimezone = ResolveTimezone(DefaultTimezone);
        var today = TimeProvider.System.GetUtcNow().UtcDateTime.Date;
        var sourceLocal = new DateTime(today.Year, today.Month, today.Day, hour, minute, 0, DateTimeKind.Unspecified);
        var converted = TimeZoneInfo.ConvertTime(sourceLocal, sourceTimezone, localTimezone);
        return converted.ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    private static TimeZoneInfo ResolveTimezone(string? timezone)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(timezone) ? DefaultTimezone : timezone.Trim());
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    private sealed record SeoEngineScheduleDefinition(
        string Key,
        string JobType,
        string Name,
        string Label,
        string Description,
        string DefaultTimeOfDayLocal,
        bool RefreshesSitemap);
}
