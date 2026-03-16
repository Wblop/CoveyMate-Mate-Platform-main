using Carter;
using MediatR;
using ConveyMate.Api.Application.Notifications;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

public sealed class NotificationEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/notifications", async (
                string? surface,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new ListSiteNotificationsQuery(surface), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(validationTitle: "Invalid notification surface."));
            })
            .AllowAnonymous()
            .WithName("ListSiteNotifications");
    }
}
