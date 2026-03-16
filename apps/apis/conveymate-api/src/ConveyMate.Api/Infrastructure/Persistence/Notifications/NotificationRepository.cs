using Npgsql;
using NpgsqlTypes;
using ConveyMate.Api.Application.Notifications.Abstractions;

namespace ConveyMate.Api.Infrastructure.Persistence.Notifications;

public sealed class NotificationRepository(NpgsqlDataSource dataSource) : INotificationRepository
{
    public async Task<IReadOnlyList<SiteNotificationRecord>> ListActiveAsync(
        string surface,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  message,
                                  tone,
                                  audience,
                                  is_enabled,
                                  created_at,
                                  updated_at
                           FROM app.site_notifications
                           WHERE is_enabled = TRUE
                             AND (audience = @surface OR audience = 'both')
                           ORDER BY created_at DESC, id DESC;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.Add("surface", NpgsqlDbType.Text).Value = surface;

        return await ReadNotificationsAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<SiteNotificationRecord>> ListAllAsync(CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  message,
                                  tone,
                                  audience,
                                  is_enabled,
                                  created_at,
                                  updated_at
                           FROM app.site_notifications
                           ORDER BY is_enabled DESC, created_at DESC, id DESC;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        return await ReadNotificationsAsync(command, cancellationToken);
    }

    public async Task<SiteNotificationRecord> InsertAsync(
        Guid notificationId,
        string message,
        string tone,
        string audience,
        bool isEnabled,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           INSERT INTO app.site_notifications (
                               id,
                               message,
                               tone,
                               audience,
                               is_enabled
                           )
                           VALUES (
                               @notification_id,
                               @message,
                               @tone,
                               @audience,
                               @is_enabled
                           )
                           RETURNING id,
                                     message,
                                     tone,
                                     audience,
                                     is_enabled,
                                     created_at,
                                     updated_at;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("notification_id", notificationId);
        command.Parameters.Add("message", NpgsqlDbType.Text).Value = message;
        command.Parameters.Add("tone", NpgsqlDbType.Text).Value = tone;
        command.Parameters.Add("audience", NpgsqlDbType.Text).Value = audience;
        command.Parameters.AddWithValue("is_enabled", isEnabled);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return MapRecord(reader);
    }

    public async Task<SiteNotificationRecord?> SetEnabledAsync(
        Guid notificationId,
        bool isEnabled,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.site_notifications
                           SET is_enabled = @is_enabled,
                               updated_at = NOW()
                           WHERE id = @notification_id
                           RETURNING id,
                                     message,
                                     tone,
                                     audience,
                                     is_enabled,
                                     created_at,
                                     updated_at;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("notification_id", notificationId);
        command.Parameters.AddWithValue("is_enabled", isEnabled);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return MapRecord(reader);
    }

    public async Task<bool> DeleteAsync(Guid notificationId, CancellationToken cancellationToken)
    {
        const string sql = """
                           DELETE FROM app.site_notifications
                           WHERE id = @notification_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("notification_id", notificationId);
        var rows = await command.ExecuteNonQueryAsync(cancellationToken);
        return rows > 0;
    }

    private static async Task<IReadOnlyList<SiteNotificationRecord>> ReadNotificationsAsync(
        NpgsqlCommand command,
        CancellationToken cancellationToken)
    {
        var notifications = new List<SiteNotificationRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            notifications.Add(MapRecord(reader));
        }

        return notifications;
    }

    private static SiteNotificationRecord MapRecord(NpgsqlDataReader reader)
    {
        return new SiteNotificationRecord(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetBoolean(4),
            reader.GetFieldValue<DateTimeOffset>(6),
            reader.GetFieldValue<DateTimeOffset>(5));
    }
}
