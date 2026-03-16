namespace ConveyMate.Api.Application.Notifications.Contracts;

public sealed record SiteNotificationDto(
    Guid Id,
    string Message,
    string Tone,
    string Audience,
    bool IsEnabled,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CreateSiteNotificationRequest(
    string Message,
    string Tone,
    string Audience,
    bool IsEnabled);

public sealed record SetSiteNotificationEnabledRequest(bool IsEnabled);
