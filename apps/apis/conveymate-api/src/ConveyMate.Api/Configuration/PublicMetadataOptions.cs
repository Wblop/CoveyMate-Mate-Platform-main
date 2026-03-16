using System.ComponentModel.DataAnnotations;

namespace ConveyMate.Api.Configuration;

/// <summary>
/// Public runtime metadata options exposed to the frontend at startup.
/// </summary>
public sealed class PublicMetadataOptions
{
    public const string SectionName = "PublicMetadata";

    public const string NominatimProvider = "nominatim-au";
    public const string PhotonProvider = "photon-au";

    [Required]
    public string ApiBaseUrl { get; init; } = string.Empty;

    [Range(60, 3600)]
    public int CacheTtlSeconds { get; init; } = 300;

    public string AddressAutocompleteProvider { get; init; } = NominatimProvider;

    public string GoogleAnalyticsMeasurementId { get; init; } = string.Empty;
}
