namespace ConveyMate.Api.Application.Notifications.Abstractions;

public interface INotificationRepository
{
    Task<IReadOnlyList<SiteNotificationRecord>> ListActiveAsync(
        string surface,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<SiteNotificationRecord>> ListAllAsync(CancellationToken cancellationToken);

    Task<SiteNotificationRecord> InsertAsync(
        Guid notificationId,
        string message,
        string tone,
        string audience,
        bool isEnabled,
        CancellationToken cancellationToken);

    Task<SiteNotificationRecord?> SetEnabledAsync(
        Guid notificationId,
        bool isEnabled,
        CancellationToken cancellationToken);

    Task<bool> DeleteAsync(Guid notificationId, CancellationToken cancellationToken);
}

public sealed record SiteNotificationRecord(
    Guid Id,
    string Message,
    string Tone,
    string Audience,
    bool IsEnabled,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
