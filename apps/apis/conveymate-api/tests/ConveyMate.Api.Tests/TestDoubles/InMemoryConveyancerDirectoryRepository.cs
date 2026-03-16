using ConveyMate.Api.Application.Conveyancers.Abstractions;

namespace ConveyMate.Api.Tests.TestDoubles;

/// <summary>
/// Deterministic in-memory conveyancer directory used by endpoint integration tests.
/// </summary>
public sealed class InMemoryConveyancerDirectoryRepository : IConveyancerDirectoryRepository
{
    private readonly List<ConveyancerDirectoryRecord> rows = CreateSeedRows();

    public Task<IReadOnlyList<ConveyancerDirectoryRecord>> ListActiveByJurisdictionAsync(
        string jurisdiction,
        CancellationToken cancellationToken)
    {
        var filtered = rows
            .Where(row => row.IsActive)
            .Where(row => string.Equals(row.Jurisdiction, jurisdiction, StringComparison.OrdinalIgnoreCase))
            .OrderBy(row => row.OrganizationName ?? row.Name, StringComparer.Ordinal)
            .ThenBy(row => row.ContactName ?? row.Name, StringComparer.Ordinal)
            .ThenBy(row => row.SourceIdentifier, StringComparer.Ordinal)
            .ToArray();

        return Task.FromResult<IReadOnlyList<ConveyancerDirectoryRecord>>(filtered);
    }

    public Task<ConveyancerDirectoryAdminListRecord> ListForAdminAsync(
        int page,
        int pageSize,
        string? search,
        string? jurisdiction,
        CancellationToken cancellationToken)
    {
        var query = rows.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(jurisdiction))
        {
            query = query.Where(row => string.Equals(row.Jurisdiction, jurisdiction, StringComparison.OrdinalIgnoreCase));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(row =>
                row.Name.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                (row.OrganizationName?.Contains(search, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (row.ContactName?.Contains(search, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (row.Email?.Contains(search, StringComparison.OrdinalIgnoreCase) ?? false));
        }

        var filtered = query.ToArray();
        return Task.FromResult(new ConveyancerDirectoryAdminListRecord(filtered, filtered.Length));
    }

    public Task<ConveyancerDirectoryRecord> CreateManualAsync(
        ConveyancerDirectoryCreateRecord record,
        CancellationToken cancellationToken)
    {
        var created = new ConveyancerDirectoryRecord(
            record.Id,
            record.Jurisdiction,
            record.RegulatorType,
            record.Name,
            record.ContactName,
            record.OrganizationName,
            record.Address,
            record.Phone,
            record.Email,
            record.Website,
            record.AreasOfPractice,
            record.SourceUrl,
            record.SourceIdentifier,
            record.IsActive,
            record.QuoteRequestsEnabled,
            record.QuoteRequestsEnabled ? (DateTimeOffset?)null : record.UpdatedUtc,
            record.LastSeenUtc);
        rows.Add(created);
        return Task.FromResult(created);
    }

    public Task<ConveyancerDirectoryRecord?> UpdateAsync(
        Guid conveyancerId,
        ConveyancerDirectoryUpdateRecord record,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(UpdateRecord(
            conveyancerId,
            row =>
            {
                var website = NormalizeNullable(record.Website);
                var sourceUrl = row.RegulatorType == "manual"
                    ? ResolveManualSourceUrl(website, row.SourceIdentifier)
                    : row.SourceUrl;
                var quoteRequestsDisabledAtUtc = record.QuoteRequestsEnabled
                    ? (DateTimeOffset?)null
                    : row.QuoteRequestsEnabled
                        ? DateTimeOffset.UtcNow
                        : row.QuoteRequestsDisabledAtUtc ?? DateTimeOffset.UtcNow;

                return row with
                {
                    Name = record.Name,
                    ContactName = record.ContactName,
                    OrganizationName = record.OrganizationName,
                    Address = record.Address,
                    Phone = record.Phone,
                    Email = record.Email,
                    Website = website,
                    AreasOfPractice = record.AreasOfPractice,
                    SourceUrl = sourceUrl,
                    QuoteRequestsEnabled = record.QuoteRequestsEnabled,
                    QuoteRequestsDisabledAtUtc = quoteRequestsDisabledAtUtc
                };
            }));
    }

    public Task<ConveyancerDirectoryRecord?> SetActiveAsync(Guid conveyancerId, bool isActive, CancellationToken cancellationToken)
    {
        return Task.FromResult(UpdateRecord(conveyancerId, row => row with { IsActive = isActive }));
    }

    public Task<ConveyancerDirectoryRecord?> SetQuoteRequestsEnabledAsync(Guid conveyancerId, bool isEnabled, CancellationToken cancellationToken)
    {
        return Task.FromResult(UpdateRecord(
            conveyancerId,
            row => row with
            {
                QuoteRequestsEnabled = isEnabled,
                QuoteRequestsDisabledAtUtc = isEnabled ? (DateTimeOffset?)null : row.QuoteRequestsDisabledAtUtc ?? DateTimeOffset.UtcNow
            }));
    }

    public Task<ConveyancerDirectoryRecord?> SetQuoteRequestsEnabledBySourceAsync(
        string jurisdiction,
        string regulatorType,
        string sourceIdentifier,
        bool isEnabled,
        CancellationToken cancellationToken)
    {
        var existing = rows.FirstOrDefault(row =>
            string.Equals(row.Jurisdiction, jurisdiction, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(row.RegulatorType, regulatorType, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(row.SourceIdentifier, sourceIdentifier, StringComparison.OrdinalIgnoreCase));
        if (existing is null)
        {
            return Task.FromResult<ConveyancerDirectoryRecord?>(null);
        }

        return SetQuoteRequestsEnabledAsync(existing.Id, isEnabled, cancellationToken);
    }

    private ConveyancerDirectoryRecord? UpdateRecord(Guid id, Func<ConveyancerDirectoryRecord, ConveyancerDirectoryRecord> update)
    {
        var index = rows.FindIndex(row => row.Id == id);
        if (index < 0)
        {
            return null;
        }

        rows[index] = update(rows[index]);
        return rows[index];
    }

    private static string? NormalizeNullable(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    private static string ResolveManualSourceUrl(string? website, string sourceIdentifier)
    {
        if (!string.IsNullOrWhiteSpace(website))
        {
            if (website.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                website.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return website;
            }

            return $"https://{website}";
        }

        return $"https://app.conveymate.com.au/conveyancers?source=manual:{sourceIdentifier}";
    }

    public void Reset()
    {
        rows.Clear();
        rows.AddRange(CreateSeedRows());
    }

    private static List<ConveyancerDirectoryRecord> CreateSeedRows()
    {
        return
        [
            new(
                Guid.Parse("11111111-1111-1111-1111-111111111111"),
                "ACT",
                "law_society",
                "Alpha Conveyancing",
                null,
                "Alpha Conveyancing",
                "1 Main St, Canberra ACT",
                "(02) 1111 1111",
                "alpha@example.com",
                "https://alpha.example.com",
                ["Conveyancing"],
                "https://www.actlawsociety.asn.au/find-a-firm",
                "alpha-1",
                true,
                true,
                null,
                DateTimeOffset.Parse("2026-02-25T00:00:00Z")),
            new(
                Guid.Parse("22222222-2222-2222-2222-222222222222"),
                "ACT",
                "licence_register",
                "Beta Legal",
                null,
                "Beta Legal",
                "2 Main St, Canberra ACT",
                "(02) 2222 2222",
                "beta@example.com",
                "https://beta.example.com",
                ["Conveyancing"],
                "https://www.actlawsociety.asn.au/find-a-firm",
                "beta-1",
                true,
                true,
                null,
                DateTimeOffset.Parse("2026-02-25T00:00:00Z")),
            new(
                Guid.Parse("33333333-3333-3333-3333-333333333333"),
                "NSW",
                "law_society",
                "Sydney Conveyancers Pty Ltd",
                "Jordan Smith",
                "Sydney Conveyancers Pty Ltd",
                "3 George St, Sydney NSW",
                "(02) 3333 3333",
                "sydney@example.com",
                "https://sydney.example.com",
                ["Conveyancing"],
                "https://www.lawsociety.com.au",
                "sydney-1",
                true,
                true,
                null,
                DateTimeOffset.Parse("2026-02-25T00:00:00Z"))
        ];
    }
}
