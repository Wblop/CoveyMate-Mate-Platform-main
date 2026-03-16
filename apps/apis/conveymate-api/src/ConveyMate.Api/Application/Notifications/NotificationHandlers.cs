using System.Security.Claims;
using ErrorOr;
using MediatR;
using Microsoft.Extensions.Logging;
using ConveyMate.Api.Application;
using ConveyMate.Api.Application.Audit;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.Notifications.Abstractions;
using ConveyMate.Api.Application.Notifications.Contracts;
using ConveyMate.Api.Application.Users.Abstractions;

namespace ConveyMate.Api.Application.Notifications;

public sealed record ListSiteNotificationsQuery(string? Surface) : IRequest<ErrorOr<IReadOnlyList<SiteNotificationDto>>>;

public sealed record ListAdminSiteNotificationsQuery(ClaimsPrincipal Principal) : IRequest<ErrorOr<IReadOnlyList<SiteNotificationDto>>>;

public sealed record CreateAdminSiteNotificationCommand(
    ClaimsPrincipal Principal,
    CreateSiteNotificationRequest Request) : IRequest<ErrorOr<SiteNotificationDto>>;

public sealed record SetAdminSiteNotificationEnabledCommand(
    ClaimsPrincipal Principal,
    Guid NotificationId,
    SetSiteNotificationEnabledRequest Request) : IRequest<ErrorOr<SiteNotificationDto>>;

public sealed record DeleteAdminSiteNotificationCommand(
    ClaimsPrincipal Principal,
    Guid NotificationId) : IRequest<ErrorOr<Success>>;

public sealed class ListSiteNotificationsQueryHandler(INotificationRepository notificationRepository)
    : IRequestHandler<ListSiteNotificationsQuery, ErrorOr<IReadOnlyList<SiteNotificationDto>>>
{
    public Task<ErrorOr<IReadOnlyList<SiteNotificationDto>>> Handle(
        ListSiteNotificationsQuery request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<IReadOnlyList<SiteNotificationDto>>(async () =>
        {
            var surface = SiteNotificationHandlerHelpers.NormalizeSurface(request.Surface);
            var notifications = await notificationRepository.ListActiveAsync(surface, cancellationToken);
            return notifications.Select(SiteNotificationHandlerHelpers.MapDto).ToArray();
        });
    }
}

public sealed class ListAdminSiteNotificationsQueryHandler(
    ICurrentUserAccessor currentUserAccessor,
    INotificationRepository notificationRepository)
    : IRequestHandler<ListAdminSiteNotificationsQuery, ErrorOr<IReadOnlyList<SiteNotificationDto>>>
{
    public Task<ErrorOr<IReadOnlyList<SiteNotificationDto>>> Handle(
        ListAdminSiteNotificationsQuery request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync<IReadOnlyList<SiteNotificationDto>>(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            SiteNotificationHandlerHelpers.EnsureAdmin(actor.IsAdmin);

            var notifications = await notificationRepository.ListAllAsync(cancellationToken);
            return notifications.Select(SiteNotificationHandlerHelpers.MapDto).ToArray();
        });
    }
}

public sealed class CreateAdminSiteNotificationCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    INotificationRepository notificationRepository,
    ILogger<CreateAdminSiteNotificationCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<CreateAdminSiteNotificationCommand, ErrorOr<SiteNotificationDto>>
{
    public Task<ErrorOr<SiteNotificationDto>> Handle(
        CreateAdminSiteNotificationCommand request,
        CancellationToken cancellationToken)
    {
        return ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            SiteNotificationHandlerHelpers.EnsureAdmin(actor.IsAdmin);

            var created = await notificationRepository.InsertAsync(
                Guid.NewGuid(),
                SiteNotificationHandlerHelpers.NormalizeMessage(request.Request.Message),
                SiteNotificationHandlerHelpers.NormalizeTone(request.Request.Tone),
                SiteNotificationHandlerHelpers.NormalizeAudience(request.Request.Audience),
                request.Request.IsEnabled,
                cancellationToken);

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) created site notification {NotificationId} for {Audience} (enabled: {IsEnabled}).",
                actor.Id,
                actor.Email,
                created.Id,
                created.Audience,
                created.IsEnabled);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.notification_created",
                    "Create notification",
                    $"Created a {created.Audience} notification.",
                    entityType: "site-notification",
                    entityId: created.Id.ToString(),
                    entityLabel: created.Message,
                    metadata: new
                    {
                        created.Audience,
                        created.Tone,
                        created.IsEnabled
                    }),
                cancellationToken);

            return SiteNotificationHandlerHelpers.MapDto(created);
        });
    }
}

public sealed class SetAdminSiteNotificationEnabledCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    INotificationRepository notificationRepository,
    ILogger<SetAdminSiteNotificationEnabledCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<SetAdminSiteNotificationEnabledCommand, ErrorOr<SiteNotificationDto>>
{
    public async Task<ErrorOr<SiteNotificationDto>> Handle(
        SetAdminSiteNotificationEnabledCommand request,
        CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            SiteNotificationHandlerHelpers.EnsureAdmin(actor.IsAdmin);

            var updated = await notificationRepository.SetEnabledAsync(
                request.NotificationId,
                request.Request.IsEnabled,
                cancellationToken);

            if (updated is null)
            {
                return null;
            }

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) {Action} site notification {NotificationId}.",
                actor.Id,
                actor.Email,
                request.Request.IsEnabled ? "enabled" : "disabled",
                updated.Id);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.notification_enabled_changed",
                    request.Request.IsEnabled ? "Enable notification" : "Disable notification",
                    $"{(request.Request.IsEnabled ? "Enabled" : "Disabled")} notification {updated.Id}.",
                    entityType: "site-notification",
                    entityId: updated.Id.ToString(),
                    entityLabel: updated.Message,
                    metadata: new
                    {
                        updated.IsEnabled
                    }),
                cancellationToken);

            return SiteNotificationHandlerHelpers.MapDto(updated);
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value is null
            ? Error.NotFound(description: "Notification was not found.")
            : result.Value;
    }
}

public sealed class DeleteAdminSiteNotificationCommandHandler(
    ICurrentUserAccessor currentUserAccessor,
    INotificationRepository notificationRepository,
    ILogger<DeleteAdminSiteNotificationCommandHandler> logger,
    IAuditTrail auditTrail)
    : IRequestHandler<DeleteAdminSiteNotificationCommand, ErrorOr<Success>>
{
    public async Task<ErrorOr<Success>> Handle(
        DeleteAdminSiteNotificationCommand request,
        CancellationToken cancellationToken)
    {
        var result = await ErrorOrExecution.TryAsync(async () =>
        {
            var actor = await currentUserAccessor.GetCurrentUserAsync(request.Principal, cancellationToken);
            SiteNotificationHandlerHelpers.EnsureAdmin(actor.IsAdmin);

            var deleted = await notificationRepository.DeleteAsync(request.NotificationId, cancellationToken);
            if (!deleted)
            {
                return false;
            }

            logger.LogInformation(
                "AUDIT: Admin {ActorId} ({ActorEmail}) deleted site notification {NotificationId}.",
                actor.Id,
                actor.Email,
                request.NotificationId);

            await auditTrail.WriteAsync(
                AuditEventFactory.ForAuthenticatedUser(
                    actor,
                    "admin.notification_deleted",
                    "Delete notification",
                    $"Deleted notification {request.NotificationId}.",
                    entityType: "site-notification",
                    entityId: request.NotificationId.ToString(),
                    entityLabel: request.NotificationId.ToString()),
                cancellationToken);

            return true;
        });

        if (result.IsError)
        {
            return result.Errors;
        }

        return result.Value
            ? Result.Success
            : Error.NotFound(description: "Notification was not found.");
    }
}

internal static class SiteNotificationHandlerHelpers
{
    private const int MaxMessageLength = 600;

    private static readonly HashSet<string> AllowedTones = new(StringComparer.OrdinalIgnoreCase)
    {
        "info",
        "warning"
    };

    private static readonly HashSet<string> AllowedAudiences = new(StringComparer.OrdinalIgnoreCase)
    {
        "public",
        "dashboard",
        "both"
    };

    private static readonly HashSet<string> AllowedSurfaces = new(StringComparer.OrdinalIgnoreCase)
    {
        "public",
        "dashboard"
    };

    public static void EnsureAdmin(bool isAdmin)
    {
        if (!isAdmin)
        {
            throw new UnauthorizedAccessException("Admin access is required.");
        }
    }

    public static string NormalizeSurface(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "public";
        }

        var normalized = value.Trim().ToLowerInvariant();
        if (!AllowedSurfaces.Contains(normalized))
        {
            throw new ArgumentException("Notification surface must be one of: public, dashboard.");
        }

        return normalized;
    }

    public static string NormalizeTone(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalized) || !AllowedTones.Contains(normalized))
        {
            throw new ArgumentException("Notification tone must be one of: info, warning.");
        }

        return normalized;
    }

    public static string NormalizeAudience(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalized) || !AllowedAudiences.Contains(normalized))
        {
            throw new ArgumentException("Notification audience must be one of: public, dashboard, both.");
        }

        return normalized;
    }

    public static string NormalizeMessage(string? value)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException("Notification message is required.");
        }

        if (normalized.Length > MaxMessageLength)
        {
            throw new ArgumentException($"Notification message must be {MaxMessageLength} characters or fewer.");
        }

        return normalized;
    }

    public static SiteNotificationDto MapDto(SiteNotificationRecord record)
    {
        return new SiteNotificationDto(
            record.Id,
            record.Message,
            record.Tone,
            record.Audience,
            record.IsEnabled,
            record.CreatedAt,
            record.UpdatedAt);
    }
}
