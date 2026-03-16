using System.Security.Claims;
using ConveyMate.Api.Application.Users.Contracts;

namespace ConveyMate.Api.Application.Users.Abstractions;

/// <summary>
/// Resolves the authenticated principal into a persisted app user.
/// </summary>
public interface ICurrentUserAccessor
{
    Task<UserInfoDto> GetCurrentUserAsync(ClaimsPrincipal principal, CancellationToken cancellationToken);
}
