using Microsoft.AspNetCore.Authentication;
using ErrorOr;
using MediatR;
using System.Security.Claims;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Application.Users.Contracts;
using ConveyMate.Api.Domain.Users;
using ConveyMate.Api.Security;

namespace ConveyMate.Api.Application.Users.Queries.GetUserInfo;

/// <summary>
/// Handles the authenticated user bootstrap flow by validating claims and upserting persistence.
/// </summary>
public sealed class GetUserInfoQueryHandler(IUserRepository userRepository)
    : IGetUserInfoQueryHandler,
      IRequestHandler<GetUserInfoQuery, ErrorOr<UserInfoDto>>
{
    public async Task<UserInfoQueryResult> HandleAsync(ClaimsPrincipal principal, CancellationToken cancellationToken)
    {
        try
        {
            var cognitoSub = principal.FindFirstValue("sub")?.Trim();
            if (string.IsNullOrWhiteSpace(cognitoSub))
            {
                throw new UserInfoClaimsException("Required claim 'sub' was not present.");
            }

            var email = principal.FindFirstValue("email")?.Trim();
            if (string.IsNullOrWhiteSpace(email))
            {
                throw new UserInfoClaimsException("Required claim 'email' was not present.");
            }

            var fullName = principal.FindFirstValue("name")?.Trim();
            if (string.IsNullOrWhiteSpace(fullName))
            {
                fullName = email;
            }

            var isAdminClaimPresent = AdminClaimEvaluator.HasAdminClaim(principal);
            var existing = await userRepository.GetByCognitoSubAsync(cognitoSub, cancellationToken);
            var persisted = existing is null
                ? await userRepository.UpsertFromClaimsAsync(cognitoSub, email, fullName, cancellationToken)
                : await UpdateIfChangedAsync(existing, cognitoSub, email, fullName, cancellationToken);

            if (persisted.IsSuspended)
            {
                return new UserInfoQueryResult(null, "This account is suspended.");
            }

            return new UserInfoQueryResult(
                new UserInfoDto(
                    persisted.Id,
                    persisted.FullName,
                    persisted.Email,
                    persisted.CreatedAt,
                    persisted.LastLoginAt,
                    persisted.IsAdmin && isAdminClaimPresent),
                null);
        }
        catch (UserInfoClaimsException error)
        {
            return new UserInfoQueryResult(null, error.Message);
        }
    }

    public async Task<ErrorOr<UserInfoDto>> Handle(GetUserInfoQuery request, CancellationToken cancellationToken)
    {
        var result = await HandleAsync(request.Principal, cancellationToken);
        if (result.HasClaimsError || result.User is null)
        {
            return Error.Unauthorized(description: result.ClaimsError ?? "Token claims are invalid.");
        }

        return result.User;
    }

    private async Task<AppUser> UpdateIfChangedAsync(
        AppUser existing,
        string cognitoSub,
        string email,
        string fullName,
        CancellationToken cancellationToken)
    {
        if (string.Equals(existing.Email, email, StringComparison.Ordinal) &&
            string.Equals(existing.FullName, fullName, StringComparison.Ordinal))
        {
            return await userRepository.TouchLastLoginAsync(existing.Id, cancellationToken)
                ?? existing;
        }

        return await userRepository.UpsertFromClaimsAsync(cognitoSub, email, fullName, cancellationToken);
    }
}
