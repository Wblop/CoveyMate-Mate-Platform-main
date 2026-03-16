using ErrorOr;
using MediatR;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Conveyancers;
using ConveyMate.Api.Application.Conveyancers.Abstractions;
using ConveyMate.Api.Application.Conveyancers.Contracts;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Application.Conveyancers.Queries;

/// <summary>
/// Application query handler for active conveyancer directory rows.
/// </summary>
public sealed class GetConveyancersQueryHandler(
    IConveyancerDirectoryRepository repository,
    IMemoryCache cache,
    IOptions<ConveyancerDirectoryCacheOptions> cacheOptions,
    ILogger<GetConveyancersQueryHandler> logger)
    : IGetConveyancersQueryHandler,
      IRequestHandler<GetConveyancersQuery, ErrorOr<ConveyancerDirectoryPageDto>>
{
    private static readonly HashSet<string> SupportedJurisdictions =
    [
        "ACT", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT"
    ];

    public async Task<ConveyancerDirectoryPageDto> HandleAsync(
        GetConveyancersQuery query,
        CancellationToken cancellationToken)
    {
        var normalizedJurisdiction = NormalizeJurisdiction(query.Jurisdiction)
            ?? throw new InvalidOperationException("Jurisdiction must be one of ACT, NSW, VIC, QLD, WA, SA, TAS, NT.");
        var normalizedSearch = NormalizeSearchTerm(query.SearchTerm);
        var normalizedRegulatorType = NormalizeRegulatorType(query.RegulatorType);
        var normalizedPage = NormalizePage(query.Page);
        var normalizedPageSize = NormalizePageSize(query.PageSize);

        var rows = await ListRowsWithCachingAsync(normalizedJurisdiction, cancellationToken);
        var availableRegulatorTypes = rows
            .Select(row => row.RegulatorType?.Trim() ?? string.Empty)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();

        IEnumerable<ConveyancerDirectoryRecord> filteredRows = rows;
        if (!string.IsNullOrWhiteSpace(normalizedRegulatorType))
        {
            filteredRows = filteredRows.Where(row => string.Equals(
                row.RegulatorType,
                normalizedRegulatorType,
                StringComparison.OrdinalIgnoreCase));
        }

        if (!string.IsNullOrWhiteSpace(normalizedSearch))
        {
            filteredRows = filteredRows.Where(row => MatchesSearchTerm(row, normalizedSearch));
        }

        var totalCount = filteredRows.Count();
        var pageItems = filteredRows
            .Skip((normalizedPage - 1) * normalizedPageSize)
            .Take(normalizedPageSize)
            .ToArray();

        var items = pageItems
            .Select(row => new ConveyancerDirectoryItemDto(
                row.Jurisdiction,
                row.RegulatorType,
                row.Name,
                row.ContactName,
                row.OrganizationName,
                row.Address,
                row.Phone,
                row.Email,
                row.Website,
                row.AreasOfPractice,
                row.SourceUrl,
                row.SourceIdentifier,
                row.QuoteRequestsEnabled,
                row.LastSeenUtc))
            .ToArray();

        return new ConveyancerDirectoryPageDto(
            items,
            normalizedPage,
            normalizedPageSize,
            totalCount,
            availableRegulatorTypes);
    }

    public static string? NormalizeJurisdiction(string? jurisdiction)
    {
        var normalized = (jurisdiction ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return "NSW";
        }

        return SupportedJurisdictions.Contains(normalized)
            ? normalized
            : null;
    }

    public static string? NormalizeSearchTerm(string? searchTerm)
    {
        var normalized = (searchTerm ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        return normalized.Length <= 120
            ? normalized
            : normalized[..120];
    }

    public static string? NormalizeRegulatorType(string? regulatorType)
    {
        var normalized = (regulatorType ?? string.Empty).Trim().ToLowerInvariant();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    public static int NormalizePage(int page)
    {
        return page <= 0 ? 1 : page;
    }

    public static int NormalizePageSize(int pageSize)
    {
        if (pageSize <= 0)
        {
            return 24;
        }

        return Math.Clamp(pageSize, 1, 100);
    }

    private async Task<IReadOnlyList<ConveyancerDirectoryRecord>> ListRowsWithCachingAsync(
        string jurisdiction,
        CancellationToken cancellationToken)
    {
        var options = cacheOptions.Value;
        if (!options.Enabled)
        {
            logger.LogDebug("Conveyancer directory cache disabled. Querying database for {Jurisdiction}.", jurisdiction);
            return await repository.ListActiveByJurisdictionAsync(jurisdiction, cancellationToken);
        }

        var cacheKey = ConveyancerDirectoryCacheKeys.BuildJurisdictionKey(jurisdiction);
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<ConveyancerDirectoryRecord>? cachedRows) &&
            cachedRows is not null)
        {
            logger.LogDebug("Conveyancer directory cache hit for {Jurisdiction}.", jurisdiction);
            return cachedRows;
        }

        logger.LogInformation("Conveyancer directory cache miss for {Jurisdiction}; loading from database.", jurisdiction);
        var loadedRows = await repository.ListActiveByJurisdictionAsync(jurisdiction, cancellationToken);
        var immutableRows = loadedRows.ToArray();
        cache.Set(cacheKey, immutableRows, BuildCacheEntryOptions(options));
        return immutableRows;
    }

    private static MemoryCacheEntryOptions BuildCacheEntryOptions(ConveyancerDirectoryCacheOptions options)
    {
        var cacheEntryOptions = new MemoryCacheEntryOptions();
        if (options.AbsoluteTtlHours > 0)
        {
            cacheEntryOptions.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(options.AbsoluteTtlHours);
        }
        else
        {
            cacheEntryOptions.Priority = CacheItemPriority.NeverRemove;
        }

        return cacheEntryOptions;
    }

    private static bool MatchesSearchTerm(ConveyancerDirectoryRecord row, string searchTerm)
    {
        return ContainsIgnoreCase(row.Name, searchTerm)
            || ContainsIgnoreCase(row.OrganizationName, searchTerm)
            || ContainsIgnoreCase(row.ContactName, searchTerm)
            || ContainsIgnoreCase(row.Address, searchTerm)
            || ContainsIgnoreCase(row.Phone, searchTerm)
            || ContainsIgnoreCase(row.Email, searchTerm)
            || ContainsIgnoreCase(row.Website, searchTerm)
            || row.AreasOfPractice.Any(area => ContainsIgnoreCase(area, searchTerm));
    }

    private static bool ContainsIgnoreCase(string? value, string searchTerm)
    {
        return value?.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ?? false;
    }

    public Task<ErrorOr<ConveyancerDirectoryPageDto>> Handle(GetConveyancersQuery request, CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(() => HandleAsync(request, cancellationToken));
    }
}
