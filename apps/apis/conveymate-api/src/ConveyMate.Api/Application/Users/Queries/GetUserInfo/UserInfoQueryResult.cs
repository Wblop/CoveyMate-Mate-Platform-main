using ConveyMate.Api.Application.Users.Contracts;

namespace ConveyMate.Api.Application.Users.Queries.GetUserInfo;

/// <summary>
/// Application-layer outcome for resolving an authenticated user profile.
/// </summary>
public sealed record UserInfoQueryResult(UserInfoDto? User, string? ClaimsError)
{
    public bool HasClaimsError => !string.IsNullOrWhiteSpace(ClaimsError);
}
