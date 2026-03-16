using System.Text.Json;

namespace ConveyMate.Api.Application.Reviews;

/// <summary>
/// Utility helpers for serializing and reading persisted job progress JSON.
/// </summary>
public static class ReviewProgress
{
    public static string BuildJson(int percent, string currentStep, string? currentSubStep = null, DateTimeOffset? lastUpdatedUtc = null)
    {
        percent = Math.Clamp(percent, 0, 99);
        var payload = new
        {
            percent,
            currentStep,
            currentSubStep = currentSubStep ?? string.Empty,
            lastUpdatedUtc = (lastUpdatedUtc ?? DateTimeOffset.UtcNow).ToUniversalTime().ToString("O")
        };

        return JsonSerializer.Serialize(payload);
    }

    public static (int Percent, string CurrentStep, string CurrentSubStep, DateTimeOffset LastUpdatedUtc) Read(string? progressJson, string fallbackStep)
    {
        if (string.IsNullOrWhiteSpace(progressJson))
        {
            return (0, fallbackStep, string.Empty, DateTimeOffset.UtcNow);
        }

        try
        {
            using var document = JsonDocument.Parse(progressJson);
            var root = document.RootElement;
            var percent = root.TryGetProperty("percent", out var percentElement) && percentElement.TryGetInt32(out var parsedPercent)
                ? Math.Clamp(parsedPercent, 0, 100)
                : 0;
            var currentStep = root.TryGetProperty("currentStep", out var stepElement)
                ? stepElement.GetString()
                : null;
            var currentSubStep = root.TryGetProperty("currentSubStep", out var subStepElement)
                ? subStepElement.GetString()
                : null;
            var lastUpdatedUtc = root.TryGetProperty("lastUpdatedUtc", out var lastUpdatedElement)
                ? lastUpdatedElement.GetString()
                : null;

            var parsedLastUpdated = DateTimeOffset.TryParse(lastUpdatedUtc, out var lastUpdated)
                ? lastUpdated.ToUniversalTime()
                : DateTimeOffset.UtcNow;

            return (
                percent,
                string.IsNullOrWhiteSpace(currentStep) ? fallbackStep : currentStep,
                string.IsNullOrWhiteSpace(currentSubStep) ? string.Empty : currentSubStep,
                parsedLastUpdated);
        }
        catch
        {
            return (0, fallbackStep, string.Empty, DateTimeOffset.UtcNow);
        }
    }
}
