namespace ConveyMate.Api.Configuration;

/// <summary>
/// Configuration for the separate ConveyMate-SEO automation engine.
/// </summary>
public sealed class SeoEngineAutomationOptions
{
    public const string SectionName = "SeoEngineAutomation";

    public bool Enabled { get; init; }

    public string EngineName { get; init; } = "SEO Engine";

    public string CommandQueueUrl { get; init; } = string.Empty;

    public string CommandQueueRegion { get; init; } = string.Empty;

    public string MarketingHost { get; init; } = "conveymate.com.au";

    public string AppHost { get; init; } = "app.conveymate.com.au";
}
