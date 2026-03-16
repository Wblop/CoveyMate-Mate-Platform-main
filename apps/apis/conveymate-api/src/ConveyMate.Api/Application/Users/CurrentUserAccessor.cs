using System.Security.Claims;
using MediatR;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Application.Users.Contracts;
using ConveyMate.Api.Application.Users.Queries.GetUserInfo;

namespace ConveyMate.Api.Application.Users;

/// <summary>
/// Bridges authentication claims to persisted user records via the user-info query handler.
/// </summary>
public sealed class CurrentUserAccessor(ISender sender) : ICurrentUserAccessor
{
    public async Task<UserInfoDto> GetCurrentUserAsync(ClaimsPrincipal principal, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new GetUserInfoQuery(principal), cancellationToken);
        if (result.IsError)
        {
            throw new UnauthorizedAccessException(result.FirstError.Description);
        }

        return result.Value;
    }
}
