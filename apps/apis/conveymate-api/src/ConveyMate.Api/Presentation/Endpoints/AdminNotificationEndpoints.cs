using System.Security.Claims;
using Carter;
using MediatR;
using ConveyMate.Api.Application.Notifications;
using ConveyMate.Api.Application.Notifications.Contracts;
using ConveyMate.Api.Presentation;
using ConveyMate.Api.Security;

namespace ConveyMate.Api.Presentation.Endpoints;

public sealed class AdminNotificationEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/notifications")
            .RequireAuthorization(AuthorizationPolicies.Admin);

        group.MapGet(string.Empty, async (
                ClaimsPrincipal principal,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new ListAdminSiteNotificationsQuery(principal), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminListSiteNotifications");

        group.MapPost(string.Empty, async (
                ClaimsPrincipal principal,
                CreateSiteNotificationRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new CreateAdminSiteNotificationCommand(principal, request), cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        validationTitle: "Invalid notification payload.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminCreateSiteNotification");

        group.MapPost("/{notificationId:guid}/enabled", async (
                ClaimsPrincipal principal,
                Guid notificationId,
                SetSiteNotificationEnabledRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(
                    new SetAdminSiteNotificationEnabledCommand(principal, notificationId, request),
                    cancellationToken);
                return result.Match(
                    payload => Results.Ok(payload),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Notification was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminSetSiteNotificationEnabled");

        group.MapDelete("/{notificationId:guid}", async (
                ClaimsPrincipal principal,
                Guid notificationId,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var result = await sender.Send(new DeleteAdminSiteNotificationCommand(principal, notificationId), cancellationToken);
                return result.Match(
                    _ => Results.NoContent(),
                    errors => errors.ToHttpResult(
                        notFoundTitle: "Notification was not found.",
                        unauthorizedTitle: "Admin access is required."));
            })
            .WithName("AdminDeleteSiteNotification");
    }
}
