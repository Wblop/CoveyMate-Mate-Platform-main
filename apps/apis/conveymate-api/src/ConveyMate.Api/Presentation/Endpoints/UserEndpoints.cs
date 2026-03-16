using System.Security.Claims;
using Carter;
using MediatR;
using ConveyMate.Api.Application.Users.Queries.GetUserInfo;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Authenticated endpoint mappings for caller-specific user profile APIs.
/// </summary>
public sealed class UserEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapGet("/user/userinfo", async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GetUserInfoQuery(principal), cancellationToken);
                return result.Match(
                    user => Results.Ok(user),
                    errors => errors.ToHttpResult(unauthorizedTitle: "Token claims are invalid."));
            })
            .RequireAuthorization()
            .WithName("GetUserInfo");
    }
}
