namespace ConveyMate.Api.Configuration;

/// <summary>
/// CORS policy options for browser access to the API.
/// </summary>
public sealed class CorsOptions
{
    public const string SectionName = "Cors";

    public string[] AllowedOrigins { get; init; } = [];
}
