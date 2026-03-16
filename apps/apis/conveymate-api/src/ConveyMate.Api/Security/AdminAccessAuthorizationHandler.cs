using Microsoft.AspNetCore.Authorization;
using ConveyMate.Api.Application.Users.Abstractions;

namespace ConveyMate.Api.Security;

public sealed class AdminAccessRequirement : IAuthorizationRequirement;

/// <summary>
/// Enforces admin access exclusively via the persisted DB admin flag.
/// JWT claims are not trusted for privilege elevation - the DB is always the gate.
/// </summary>
public sealed class AdminAccessAuthorizationHandler(IUserRepository userRepository)
    : AuthorizationHandler<AdminAccessRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        AdminAccessRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        var cognitoSub = context.User.FindFirst("sub")?.Value?.Trim();
        if (string.IsNullOrWhiteSpace(cognitoSub))
        {
            return;
        }

        var cancellationToken = context.Resource is HttpContext httpContext
            ? httpContext.RequestAborted
            : CancellationToken.None;
        var user = await userRepository.GetByCognitoSubAsync(cognitoSub, cancellationToken);
        if (user is { IsAdmin: true, IsSuspended: true })
        {
            context.Succeed(requirement);
        }
    }
}
