using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.Conveyancers.Abstractions;
using ConveyMate.Api.Application.Conveyancers.Queries;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Unit tests for conveyancer query handler caching behavior.
/// </summary>
public sealed class GetConveyancersQueryHandlerTests
{
    [Fact]
    public async Task Caches_Jurisdiction_Dataset_When_Enabled()
    {
        var repository = new CountingRepository();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var handler = new GetConveyancersQueryHandler(
            repository,
            cache,
            Options.Create(new ConveyancerDirectoryCacheOptions
            {
                Enabled = true,
                AbsoluteTtlHours = 24
            }),
            NullLogger<GetConveyancersQueryHandler>.Instance);

        await handler.HandleAsync(new GetConveyancersQuery("ACT", null, null, 1, 24), CancellationToken.None);
        await handler.HandleAsync(new GetConveyancersQuery("ACT", "Alpha", null, 1, 24), CancellationToken.None);
        await handler.HandleAsync(new GetConveyancersQuery("ACT", null, "law_society", 1, 24), CancellationToken.None);

        Assert.Equal(1, repository.ListActiveCalls);
    }

    [Fact]
    public async Task Bypasses_Cache_When_Disabled()
    {
        var repository = new CountingRepository();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var handler = new GetConveyancersQueryHandler(
            repository,
            cache,
            Options.Create(new ConveyancerDirectoryCacheOptions
            {
                Enabled = false,
                AbsoluteTtlHours = 24
            }),
            NullLogger<GetConveyancersQueryHandler>.Instance);

        await handler.HandleAsync(new GetConveyancersQuery("ACT", null, null, 1, 24), CancellationToken.None);
        await handler.HandleAsync(new GetConveyancersQuery("ACT", null, null, 1, 24), CancellationToken.None);

        Assert.Equal(2, repository.ListActiveCalls);
    }

    private sealed class CountingRepository : IConveyancerDirectoryRepository
    {
        public int ListActiveCalls { get; private set; }

        public Task<IReadOnlyList<ConveyancerDirectoryRecord>> ListActiveByJurisdictionAsync(
            string jurisdiction,
            CancellationToken cancellationToken)
        {
            ListActiveCalls += 1;
            IReadOnlyList<ConveyancerDirectoryRecord> rows =
            [
                new(
                    Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                    jurisdiction,
                    "law_society",
                    "Alpha Conveyancing",
                    null,
                    "Alpha Conveyancing",
                    "1 Main Street",
                    "(02) 1111 1111",
                    "alpha@example.com",
                    "https://alpha.example.com",
                    ["Conveyancing"],
                    "https://example.com/alpha",
                    "alpha-1",
                    true,
                    true,
                    null,
                    DateTimeOffset.Parse("2026-02-25T00:00:00Z")),
                new(
                    Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
                    jurisdiction,
                    "licence_register",
                    "Beta Legal",
                    "Jordan Smith",
                    "Beta Legal",
                    "2 Main Street",
                    "(02) 2222 2222",
                    "beta@example.com",
                    "https://beta.example.com",
                    ["Property Law"],
                    "https://example.com/beta",
                    "beta-1",
                    true,
                    true,
                    null,
                    DateTimeOffset.Parse("2026-02-25T00:00:00Z"))
            ];

            return Task.FromResult(rows);
        }

        public Task<ConveyancerDirectoryAdminListRecord> ListForAdminAsync(
            int page,
            int pageSize,
            string? search,
            string? jurisdiction,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<ConveyancerDirectoryRecord> CreateManualAsync(
            ConveyancerDirectoryCreateRecord record,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<ConveyancerDirectoryRecord?> UpdateAsync(
            Guid conveyancerId,
            ConveyancerDirectoryUpdateRecord record,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<ConveyancerDirectoryRecord?> SetActiveAsync(Guid conveyancerId, bool isActive, CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<ConveyancerDirectoryRecord?> SetQuoteRequestsEnabledAsync(
            Guid conveyancerId,
            bool isEnabled,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public Task<ConveyancerDirectoryRecord?> SetQuoteRequestsEnabledBySourceAsync(
            string jurisdiction,
            string regulatorType,
            string sourceIdentifier,
            bool isEnabled,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }
    }
}
