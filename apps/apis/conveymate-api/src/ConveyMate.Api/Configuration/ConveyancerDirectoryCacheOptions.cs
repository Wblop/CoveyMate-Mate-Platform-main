using System.ComponentModel.DataAnnotations;

namespace ConveyMate.Api.Configuration;

/// <summary>
/// Runtime caching controls for conveyancer directory reads.
/// </summary>
public sealed class ConveyancerDirectoryCacheOptions
{
    public const string SectionName = "ConveyancerDirectoryCache";

    /// <summary>
    /// Enables in-memory caching for directory rows.
    /// </summary>
    public bool Enabled { get; init; } = true;

    /// <summary>
    /// Absolute cache TTL in hours. Set to 0 to cache until process restart.
    /// </summary>
    [Range(0, 720)]
    public int AbsoluteTtlHours { get; init; } = 24;
}
