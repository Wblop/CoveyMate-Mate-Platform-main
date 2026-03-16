using Carter;
using MediatR;
using ConveyMate.Api.Application.Conveyancers.Queries;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Authenticated endpoint mappings for conveyancer directory access.
/// </summary>
public sealed class ConveyancerEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/conveyancers", async (
                string? jurisdiction,
                string? q,
                string? regulatorType,
                int? page,
                int? pageSize,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new GetConveyancersQuery(
                        jurisdiction ?? "ACT",
                        q,
                        regulatorType,
                        page ?? 1,
                        pageSize ?? 24),
                    cancellationToken);

                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult());
            })
            .RequireAuthorization()
            .WithName("ListConveyancers");
    }
}
