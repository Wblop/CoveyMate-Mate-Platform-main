using System.ComponentModel.DataAnnotations;

namespace ConveyMate.Api.Configuration;

/// <summary>
/// Database connectivity options used for application persistence and migrations.
/// </summary>
public sealed class DatabaseOptions
{
    public const string SectionName = "ConnectionStrings";

    [Required]
    public string Postgres { get; init; } = string.Empty;
}
