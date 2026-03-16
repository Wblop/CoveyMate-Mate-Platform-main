using System.Security.Claims;

namespace ConveyMate.Api.Application.Users.Queries.GetUserInfo;

/// <summary>
/// Resolves the caller identity into a persisted application user profile.
/// </summary>
public interface IGetUserInfoQueryHandler
{
    Task<UserInfoQueryResult> HandleAsync(ClaimsPrincipal principal, CancellationToken cancellationToken);
}
