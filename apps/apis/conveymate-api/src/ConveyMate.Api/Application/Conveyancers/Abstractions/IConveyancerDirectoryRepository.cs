namespace ConveyMate.Api.Application.Conveyancers.Abstractions;

/// <summary>
/// Persistence abstraction for jurisdiction-scoped active conveyancer directory records.
/// </summary>
public interface IConveyancerDirectoryRepository
{
    Task<IReadOnlyList<ConveyancerDirectoryRecord>> ListActiveByJurisdictionAsync(
        string jurisdiction,
        CancellationToken cancellationToken);

    Task<ConveyancerDirectoryAdminListRecord> ListForAdminAsync(
        int page,
        int pageSize,
        string? search,
        string? jurisdiction,
        CancellationToken cancellationToken);

    Task<ConveyancerDirectoryRecord> CreateManualAsync(
        ConveyancerDirectoryCreateRecord record,
        CancellationToken cancellationToken);

    Task<ConveyancerDirectoryRecord?> UpdateAsync(
        Guid conveyancerId,
        ConveyancerDirectoryUpdateRecord record,
        CancellationToken cancellationToken);

    Task<ConveyancerDirectoryRecord?> SetActiveAsync(
        Guid conveyancerId,
        bool isActive,
        CancellationToken cancellationToken);

    Task<ConveyancerDirectoryRecord?> SetQuoteRequestsEnabledAsync(
        Guid conveyancerId,
        bool isEnabled,
        CancellationToken cancellationToken);

    Task<ConveyancerDirectoryRecord?> SetQuoteRequestsEnabledBySourceAsync(
        string jurisdiction,
        string regulatorType,
        string sourceIdentifier,
        bool isEnabled,
        CancellationToken cancellationToken);
}

/// <summary>
/// Normalized conveyancer row persisted in PostgreSQL.
/// </summary>
public sealed record ConveyancerDirectoryRecord(
    Guid Id,
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
    bool IsActive,
    bool QuoteRequestsEnabled,
    DateTimeOffset? QuoteRequestsDisabledAtUtc,
    DateTimeOffset LastSeenUtc);

public sealed record ConveyancerDirectoryAdminListRecord(
    IReadOnlyList<ConveyancerDirectoryRecord> Conveyancers,
    int TotalCount);

public sealed record ConveyancerDirectoryCreateRecord(
    Guid Id,
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
    bool IsActive,
    bool QuoteRequestsEnabled,
    DateTimeOffset LastSeenUtc,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ConveyancerDirectoryUpdateRecord(
    string Name,
    string? ContactName,
    string? OrganizationName,
    string? Address,
    string? Phone,
    string? Email,
    string? Website,
    IReadOnlyList<string> AreasOfPractice,
    bool QuoteRequestsEnabled);
