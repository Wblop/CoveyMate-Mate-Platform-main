using System.ComponentModel.DataAnnotations;

namespace ConveyMate.Api.Configuration;

/// <summary>
/// Runtime settings for the async review processing pipeline.
/// </summary>
public sealed class ReviewPipelineOptions
{
    public const string SectionName = "ReviewPipeline";

    public string AppBaseUrl { get; init; } = string.Empty;

    public string ReportsBucketName { get; init; } = string.Empty;

    public bool TextractEnabled { get; init; } = true;

    public string DefaultState { get; init; } = "ACT";

    [Range(60, 3600)]
    public int PresignedUrlTtlSeconds { get; init; } = 900;
}
