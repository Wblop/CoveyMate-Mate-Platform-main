using Carter;
using MediatR;
using ConveyMate.Api.Application.Configuration.Queries;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Public configuration endpoints used by the SPA for dynamic capability flags.
/// </summary>
public sealed class ConfigurationEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/config/enabled-states", async (
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new GetEnabledStatesQuery(), cancellationToken);
                return result.Match(
                    value => Results.Ok(value),
                    errors => errors.ToHttpResult());
            })
            .AllowAnonymous()
            .WithName("GetEnabledStates");
    }
}
