using Microsoft.AspNetCore.Mvc;
using ConveyMate.Api.Application.Users.Abstractions;

namespace ConveyMate.Api.Security;

public static class SuspensionGateExtensions
{
    /// <summary>
    /// Blocks all authenticated requests when the resolved user is suspended.
    /// </summary>
    public static IApplicationBuilder UseConveyMateSuspensionGate(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
                await next();
                return;
            }

            var cognitoSub = context.User.FindFirst("sub")?.Value?.Trim();
            if (string.IsNullOrWhiteSpace(cognitoSub))
            {
                await next();
                return;
            }

            var userRepository = context.RequestServices.GetRequiredService<IUserRepository>();
            var user = await userRepository.GetByCognitoSubAsync(cognitoSub, context.RequestAborted);
            if (user?.IsSuspended == true)
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new ProblemDetails
                {
                    Status = StatusCodes.Status403Forbidden,
                    Title = "Account suspended.",
                    Detail = "This account is suspended. Contact support for assistance."
                }, context.RequestAborted);
                return;
            }

            await next();
        });
    }
}
