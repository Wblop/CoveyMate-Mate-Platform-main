using ConveyMate.Api.Domain.Users;

namespace ConveyMate.Api.Application.Users.Abstractions;

/// <summary>
/// Persistence port for user read/upsert operations.
/// </summary>
public interface IUserRepository
{
    Task<AppUser?> GetByIdAsync(Guid userId, CancellationToken cancellationToken);

    Task<AppUser?> GetByCognitoSubAsync(string cognitoSub, CancellationToken cancellationToken);

    Task<AppUser?> TouchLastLoginAsync(Guid userId, CancellationToken cancellationToken);

    Task<AppUser> UpsertFromClaimsAsync(
        string cognitoSub,
        string email,
        string fullName,
        CancellationToken cancellationToken);
}
