using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Domain.Users;

namespace ConveyMate.Api.Tests.TestDoubles;

/// <summary>
/// In-memory user repository used by endpoint tests.
/// </summary>
public sealed class InMemoryUserRepository : IUserRepository
{
    private readonly Dictionary<string, AppUser> usersBySub = new(StringComparer.Ordinal);

    public int UpsertCalls { get; private set; }

    public Task<AppUser?> GetByIdAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = usersBySub.Values.FirstOrDefault(item => item.Id == userId);
        return Task.FromResult(user);
    }

    public Task<AppUser?> GetByCognitoSubAsync(string cognitoSub, CancellationToken cancellationToken)
    {
        usersBySub.TryGetValue(cognitoSub, out var user);
        return Task.FromResult(user);
    }

    public Task<AppUser?> TouchLastLoginAsync(Guid userId, CancellationToken cancellationToken)
    {
        var updated = usersBySub.Values.FirstOrDefault(user => user.Id == userId);
        if (updated is null)
        {
            return Task.FromResult<AppUser?>(null);
        }

        var refreshed = updated with
        {
            LastLoginAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        usersBySub[refreshed.CognitoSub] = refreshed;
        return Task.FromResult<AppUser?>(refreshed);
    }

    public Task<AppUser> UpsertFromClaimsAsync(string cognitoSub, string email, string fullName, CancellationToken cancellationToken)
    {
        UpsertCalls++;

        if (!usersBySub.TryGetValue(cognitoSub, out var existing))
        {
            var created = new AppUser(
                Guid.NewGuid(),
                cognitoSub,
                email,
                fullName,
                IsAdmin: false,
                IsSuspended: false,
                LastLoginAt: DateTimeOffset.UtcNow,
                CreatedAt: DateTimeOffset.UtcNow,
                UpdatedAt: DateTimeOffset.UtcNow);
            usersBySub[cognitoSub] = created;
            return Task.FromResult(created);
        }

        var updated = existing with
        {
            Email = email,
            FullName = fullName,
            LastLoginAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        usersBySub[cognitoSub] = updated;

        return Task.FromResult(updated);
    }

    public void Seed(params AppUser[] users)
    {
        foreach (var user in users)
        {
            usersBySub[user.CognitoSub] = user;
        }
    }

    public void Reset()
    {
        usersBySub.Clear();
        UpsertCalls = 0;
    }
}
