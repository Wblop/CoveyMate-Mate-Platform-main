using Amazon.Scheduler;
using Amazon.Scheduler.Model;
using ConveyMate.Api.Application.SeoEngine;
using ConveyMate.Api.Application.SeoEngine.Abstractions;
using ConveyMate.Api.Configuration;
using Microsoft.Extensions.Options;

namespace ConveyMate.Api.Infrastructure.Aws;

public sealed class SeoEngineScheduler(
    IAmazonScheduler schedulerClient,
    IOptions<SeoEngineAutomationOptions> seoEngineOptions)
    : ISeoEngineScheduler
{
    private const string DefaultGroupName = "default";
    private const string QueueSuffix = "-seo-commands";

    public async Task<IReadOnlyList<SeoEngineScheduleRecord>> ListSchedulesAsync(CancellationToken cancellationToken)
    {
        var schedulePrefix = ResolveSchedulePrefix();
        var records = new List<SeoEngineScheduleRecord>(3);

        foreach (var jobType in GetSupportedJobTypes())
        {
            records.Add(await GetScheduleAsync(schedulePrefix, jobType, cancellationToken));
        }

        return records;
    }

    public async Task<SeoEngineScheduleRecord> UpdateScheduleAsync(
        string jobType,
        SeoEngineScheduleUpdateRecord update,
        CancellationToken cancellationToken)
    {
        var schedulePrefix = ResolveSchedulePrefix();
        var scheduleName = ResolveScheduleName(schedulePrefix, jobType);

        GetScheduleResponse current;
        try
        {
            current = await schedulerClient.GetScheduleAsync(
                new GetScheduleRequest
                {
                    GroupName = DefaultGroupName,
                    Name = scheduleName
                },
                cancellationToken);
        }
        catch (ResourceNotFoundException)
        {
            throw new KeyNotFoundException($"SEO Engine schedule '{jobType}' was not found.");
        }
        catch (AmazonSchedulerException error)
        {
            throw new InvalidOperationException($"SEO Engine schedule '{jobType}' could not be loaded: {error.Message}", error);
        }

        try
        {
            await schedulerClient.UpdateScheduleAsync(
                new UpdateScheduleRequest
                {
                    GroupName = current.GroupName,
                    Name = current.Name,
                    Description = current.Description,
                    EndDate = current.EndDate,
                    FlexibleTimeWindow = CloneFlexibleTimeWindow(current.FlexibleTimeWindow),
                    KmsKeyArn = current.KmsKeyArn,
                    ScheduleExpression = update.ScheduleExpression,
                    ScheduleExpressionTimezone = update.ScheduleExpressionTimezone,
                    StartDate = current.StartDate,
                    State = update.Enabled ? ScheduleState.ENABLED : ScheduleState.DISABLED,
                    Target = CloneTarget(current.Target)
                },
                cancellationToken);
        }
        catch (ResourceNotFoundException)
        {
            throw new KeyNotFoundException($"SEO Engine schedule '{jobType}' was not found.");
        }
        catch (ValidationException error)
        {
            throw new InvalidOperationException(error.Message, error);
        }
        catch (AmazonSchedulerException error)
        {
            throw new InvalidOperationException($"SEO Engine schedule '{jobType}' could not be updated: {error.Message}", error);
        }

        return await GetScheduleAsync(schedulePrefix, jobType, cancellationToken);
    }

    private async Task<SeoEngineScheduleRecord> GetScheduleAsync(
        string schedulePrefix,
        string jobType,
        CancellationToken cancellationToken)
    {
        var scheduleName = ResolveScheduleName(schedulePrefix, jobType);

        try
        {
            var response = await schedulerClient.GetScheduleAsync(
                new GetScheduleRequest
                {
                    GroupName = DefaultGroupName,
                    Name = scheduleName
                },
                cancellationToken);

            return new SeoEngineScheduleRecord(
                jobType,
                response.ScheduleExpression ?? string.Empty,
                response.ScheduleExpressionTimezone ?? string.Empty,
                string.Equals(response.State?.Value, ScheduleState.ENABLED.Value, StringComparison.OrdinalIgnoreCase),
                response.State?.Value ?? string.Empty);
        }
        catch (ResourceNotFoundException)
        {
            throw new KeyNotFoundException($"SEO Engine schedule '{jobType}' was not found.");
        }
        catch (AmazonSchedulerException error)
        {
            throw new InvalidOperationException($"SEO Engine schedule '{jobType}' could not be loaded: {error.Message}", error);
        }
    }

    private string ResolveSchedulePrefix()
    {
        var queueUrl = seoEngineOptions.Value.CommandQueueUrl?.Trim();
        if (string.IsNullOrWhiteSpace(queueUrl))
        {
            throw new InvalidOperationException("SEO Engine queue is not configured.");
        }

        if (!Uri.TryCreate(queueUrl, UriKind.Absolute, out var queueUri))
        {
            throw new InvalidOperationException("SEO Engine queue configuration is invalid.");
        }

        var queueName = queueUri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault();
        if (string.IsNullOrWhiteSpace(queueName) || !queueName.EndsWith(QueueSuffix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("SEO Engine scheduler names could not be derived from the queue configuration.");
        }

        return queueName[..^QueueSuffix.Length];
    }

    private static string ResolveScheduleName(string schedulePrefix, string jobType)
    {
        return jobType switch
        {
            SeoEngineJobTypes.GenerateArticle => $"{schedulePrefix}-seo-generate-article",
            SeoEngineJobTypes.PublishNextArticle => $"{schedulePrefix}-seo-publish-next-article",
            SeoEngineJobTypes.RefreshSitemap => $"{schedulePrefix}-seo-refresh-sitemap",
            _ => throw new InvalidOperationException("Unsupported SEO Engine schedule type.")
        };
    }

    private static IEnumerable<string> GetSupportedJobTypes()
    {
        yield return SeoEngineJobTypes.GenerateArticle;
        yield return SeoEngineJobTypes.PublishNextArticle;
        yield return SeoEngineJobTypes.RefreshSitemap;
    }

    private static FlexibleTimeWindow CloneFlexibleTimeWindow(FlexibleTimeWindow source)
    {
        return new FlexibleTimeWindow
        {
            MaximumWindowInMinutes = source.MaximumWindowInMinutes,
            Mode = source.Mode
        };
    }

    private static Target CloneTarget(Target source)
    {
        return new Target
        {
            Arn = source.Arn,
            DeadLetterConfig = source.DeadLetterConfig is null
                ? null
                : new DeadLetterConfig
                {
                    Arn = source.DeadLetterConfig.Arn
                },
            Input = source.Input,
            RetryPolicy = source.RetryPolicy is null
                ? null
                : new RetryPolicy
                {
                    MaximumEventAgeInSeconds = source.RetryPolicy.MaximumEventAgeInSeconds,
                    MaximumRetryAttempts = source.RetryPolicy.MaximumRetryAttempts
                },
            RoleArn = source.RoleArn,
            SqsParameters = source.SqsParameters is null
                ? null
                : new SqsParameters
                {
                    MessageGroupId = source.SqsParameters.MessageGroupId
                }
        };
    }
}
