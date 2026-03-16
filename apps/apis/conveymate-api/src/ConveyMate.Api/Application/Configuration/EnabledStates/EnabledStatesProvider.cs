using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.Configuration.Contracts;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Application.Configuration.EnabledStates;

/// <summary>
/// Resolves enabled jurisdictions from SSM-backed Grok collection mappings at startup.
/// </summary>
public sealed class EnabledStatesProvider(
    IOptions<ReviewPipelineOptions> reviewPipelineOptions,
    IOptions<GrokOptions> grokOptions) : IEnabledStatesProvider
{
    private static readonly string[] SupportedStates =
    [
        "ACT", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT"
    ];

    private readonly EnabledStatesConfigurationResponse snapshot = BuildSnapshot(
        reviewPipelineOptions.Value.DefaultState,
        grokOptions.Value.Collections);

    public EnabledStatesConfigurationResponse GetSnapshot() => snapshot;

    public bool IsStateEnabled(string stateOrTerritory)
    {
        var normalized = NormalizeState(stateOrTerritory);
        return snapshot.EnabledStates.Contains(normalized, StringComparer.OrdinalIgnoreCase);
    }

    private static EnabledStatesConfigurationResponse BuildSnapshot(
        string defaultStateRaw,
        IReadOnlyDictionary<string, string> collections)
    {
        var defaultState = NormalizeState(defaultStateRaw);
        var mappedCollections = collections
            .Where(item => !string.IsNullOrWhiteSpace(item.Key) && !string.IsNullOrWhiteSpace(item.Value))
            .ToDictionary(
                item => item.Key.Trim().ToLowerInvariant(),
                item => item.Value.Trim(),
                StringComparer.OrdinalIgnoreCase);

        var hasCommonCollection = mappedCollections.ContainsKey("au-common");
        var enabledStates = hasCommonCollection
            ? SupportedStates
                .Where(state => mappedCollections.ContainsKey(ToCollectionKey(state)))
                .ToArray()
            : [];

        return new EnabledStatesConfigurationResponse(
            defaultState,
            SupportedStates,
            enabledStates);
    }

    private static string NormalizeState(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToUpperInvariant();
        return SupportedStates.Contains(normalized, StringComparer.OrdinalIgnoreCase)
            ? normalized
            : "ACT";
    }

    private static string ToCollectionKey(string stateOrTerritory)
    {
        return $"au-{NormalizeState(stateOrTerritory).ToLowerInvariant()}";
    }
}

