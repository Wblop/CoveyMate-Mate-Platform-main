using Carter;
using MediatR;
using ConveyMate.Api.Application.Metadata.Queries;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Public endpoint mappings for frontend runtime metadata bootstrap.
/// </summary>
public sealed class MetadataEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapGet("/metadataconfiguration", async (
                HttpContext context,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new GetMetadataConfigurationQuery(context.Request.Headers.IfNoneMatch.ToString()),
                    cancellationToken);

                return result.Match<IResult>(
                    value =>
                    {
                        context.Response.Headers.ETag = value.ETag;
                        context.Response.Headers.CacheControl = value.CacheControl;
                        return value.NotModified
                            ? Results.StatusCode(StatusCodes.Status304NotModified)
                            : Results.Text(value.JsonPayload, "application/json");
                    },
                    errors => errors.ToHttpResult());
            })
            .AllowAnonymous()
            .WithName("GetMetadataConfiguration");
    }
}
