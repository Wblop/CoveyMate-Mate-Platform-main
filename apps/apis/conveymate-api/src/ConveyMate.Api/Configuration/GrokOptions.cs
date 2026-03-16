namespace ConveyMate.Api.Configuration;

/// <summary>
/// Grok API settings used by background analysis workers.
/// </summary>
public sealed class GrokOptions
{
    public const string SectionName = "Grok";

    public string ApiKey { get; init; } = string.Empty;

    public string ApiUrl { get; init; } = "https://api.x.ai/v1/chat/completions";

    public string Model { get; init; } = "grok-4-1-fast-reasoning";

    public double Temperature { get; init; } = 0.1d;

    public Dictionary<string, string> Collections { get; init; } = new(StringComparer.OrdinalIgnoreCase);
}
