using Carter;
using MediatR;
using ConveyMate.Api.Application.Auth.SignUp;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

public sealed class AuthEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/auth/sign-up", async (
                PublicSignUpRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new SignUpCommand(request),
                    cancellationToken);

                return result.Match<IResult>(
                    value => Results.Ok(value),
                    errors => errors.ToHttpResult(validationTitle: "Registration failed."));
            })
            .AllowAnonymous()
            .WithName("PublicSignUp");
    }
}
