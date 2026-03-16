using ConveyMate.Api.Application.Notifications.Abstractions;

namespace ConveyMate.Api.Tests.TestDoubles;

public sealed class InMemoryNotificationRepository : INotificationRepository
{
    private readonly Dictionary<Guid, SiteNotificationRecord> notifications = new();

    public Task<IReadOnlyList<SiteNotificationRecord>> ListActiveAsync(
        string surface,
        CancellationToken cancellationToken)
    {
        var items = notifications.Values
            .Where(notification =>
                notification.IsEnabled &&
                (string.Equals(notification.Audience, surface, StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(notification.Audience, "both", StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(notification => notification.CreatedAt)
            .ThenByDescending(notification => notification.Id)
            .ToArray();

        return Task.FromResult<IReadOnlyList<SiteNotificationRecord>>(items);
    }

    public Task<IReadOnlyList<SiteNotificationRecord>> ListAllAsync(CancellationToken cancellationToken)
    {
        var items = notifications.Values
            .OrderByDescending(notification => notification.IsEnabled)
            .ThenByDescending(notification => notification.CreatedAt)
            .ThenByDescending(notification => notification.Id)
            .ToArray();

        return Task.FromResult<IReadOnlyList<SiteNotificationRecord>>(items);
    }

    public Task<SiteNotificationRecord> InsertAsync(
        Guid notificationId,
        string message,
        string tone,
        string audience,
        bool isEnabled,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var created = new SiteNotificationRecord(
            notificationId,
            message,
            tone,
            audience,
            isEnabled,
            now,
            now);
        notifications[notificationId] = created;
        return Task.FromResult(created);
    }

    public Task<SiteNotificationRecord?> SetEnabledAsync(
        Guid notificationId,
        bool isEnabled,
        CancellationToken cancellationToken)
    {
        if (!notifications.TryGetValue(notificationId, out var existing))
        {
            return Task.FromResult<SiteNotificationRecord?>(null);
        }

        var updated = existing with
        {
            IsEnabled = isEnabled,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        notifications[notificationId] = updated;
        return Task.FromResult<SiteNotificationRecord?>(updated);
    }

    public Task<bool> DeleteAsync(Guid notificationId, CancellationToken cancellationToken)
    {
        return Task.FromResult(notifications.Remove(notificationId));
    }

    public void Seed(params SiteNotificationRecord[] items)
    {
        foreach (var item in items)
        {
            notifications[item.Id] = item;
        }
    }

    public void Reset()
    {
        notifications.Clear();
    }
}
