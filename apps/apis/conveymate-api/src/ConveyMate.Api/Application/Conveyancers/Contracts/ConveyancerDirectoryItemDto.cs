namespace ConveyMate.Api.Application.Conveyancers.Contracts;

/// <summary>
/// API payload item returned for directory listings.
/// </summary>
public sealed record ConveyancerDirectoryItemDto(
    string Jurisdiction,
    string RegulatorType,
    string Name,
    string? ContactName,
    string? OrganizationName,
    string? Address,
    string? Phone,
    string? Email,
    string? Website,
    IReadOnlyList<string> AreasOfPractice,
    string SourceUrl,
    string SourceIdentifier,
    bool QuoteRequestsEnabled,
    DateTimeOffset LastSeenUtc);
