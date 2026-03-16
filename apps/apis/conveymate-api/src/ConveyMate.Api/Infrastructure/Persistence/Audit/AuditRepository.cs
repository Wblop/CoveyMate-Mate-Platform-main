using Npgsql;
using NpgsqlTypes;
using ConveyMate.Api.Application.Audit.Abstractions;

namespace ConveyMate.Api.Infrastructure.Persistence.Audit;

public sealed class AuditRepository(NpgsqlDataSource dataSource) : IAuditRepository
{
    public async Task InsertAsync(AuditEventCreateRecord record, CancellationToken cancellationToken)
    {
        const string sql = """
                           INSERT INTO app.audit_events
                           (
                               occurred_at,
                               action_code,
                               action_group,
                               action_label,
                               description,
                               source,
                               actor_type,
                               actor_user_id,
                               actor_email,
                               actor_name,
                               subject_user_id,
                               subject_email,
                               subject_name,
                               entity_type,
                               entity_id,
                               entity_label,
                               request_path,
                               request_method,
                               ip_address,
                               user_agent,
                               metadata_json
                           )
                           VALUES
                           (
                               @occurred_at,
                               @action_code,
                               @action_group,
                               @action_label,
                               @description,
                               @source,
                               @actor_type,
                               @actor_user_id,
                               @actor_email,
                               @actor_name,
                               @subject_user_id,
                               @subject_email,
                               @subject_name,
                               @entity_type,
                               @entity_id,
                               @entity_label,
                               @request_path,
                               @request_method,
                               @ip_address,
                               @user_agent,
                               CAST(@metadata_json AS jsonb)
                           );
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("occurred_at", record.OccurredAt);
        command.Parameters.AddWithValue("action_code", record.ActionCode);
        command.Parameters.AddWithValue("action_group", record.ActionGroup);
        command.Parameters.AddWithValue("action_label", record.ActionLabel);
        command.Parameters.Add("description", NpgsqlDbType.Text).Value = (object?)record.Description ?? DBNull.Value;
        command.Parameters.AddWithValue("source", record.Source);
        command.Parameters.AddWithValue("actor_type", record.ActorType);
        command.Parameters.Add("actor_user_id", NpgsqlDbType.Uuid).Value = (object?)record.ActorUserId ?? DBNull.Value;
        command.Parameters.Add("actor_email", NpgsqlDbType.Text).Value = (object?)record.ActorEmail ?? DBNull.Value;
        command.Parameters.Add("actor_name", NpgsqlDbType.Text).Value = (object?)record.ActorName ?? DBNull.Value;
        command.Parameters.Add("subject_user_id", NpgsqlDbType.Uuid).Value = (object?)record.SubjectUserId ?? DBNull.Value;
        command.Parameters.Add("subject_email", NpgsqlDbType.Text).Value = (object?)record.SubjectEmail ?? DBNull.Value;
        command.Parameters.Add("subject_name", NpgsqlDbType.Text).Value = (object?)record.SubjectName ?? DBNull.Value;
        command.Parameters.Add("entity_type", NpgsqlDbType.Text).Value = (object?)record.EntityType ?? DBNull.Value;
        command.Parameters.Add("entity_id", NpgsqlDbType.Text).Value = (object?)record.EntityId ?? DBNull.Value;
        command.Parameters.Add("entity_label", NpgsqlDbType.Text).Value = (object?)record.EntityLabel ?? DBNull.Value;
        command.Parameters.Add("request_path", NpgsqlDbType.Text).Value = (object?)record.RequestPath ?? DBNull.Value;
        command.Parameters.Add("request_method", NpgsqlDbType.Text).Value = (object?)record.RequestMethod ?? DBNull.Value;
        command.Parameters.Add("ip_address", NpgsqlDbType.Text).Value = (object?)record.IpAddress ?? DBNull.Value;
        command.Parameters.Add("user_agent", NpgsqlDbType.Text).Value = (object?)record.UserAgent ?? DBNull.Value;
        command.Parameters.AddWithValue("metadata_json", record.MetadataJson);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<AdminAuditEventListRecord> ListForAdminAsync(
        int page,
        int pageSize,
        string? search,
        string? actionCode,
        string? actorType,
        CancellationToken cancellationToken)
    {
        var normalizedPage = Math.Max(1, page);
        var normalizedPageSize = Math.Clamp(pageSize <= 0 ? 25 : pageSize, 1, 100);
        var offset = (normalizedPage - 1) * normalizedPageSize;
        var searchPattern = BuildSearchPattern(search);
        var normalizedActionCode = string.IsNullOrWhiteSpace(actionCode) ? null : actionCode.Trim().ToLowerInvariant();
        var normalizedActorType = string.IsNullOrWhiteSpace(actorType) ? null : actorType.Trim().ToLowerInvariant();

        const string countSql = """
                                SELECT COUNT(*)
                                FROM app.audit_events audit_events
                                WHERE (@search_pattern IS NULL
                                       OR COALESCE(audit_events.actor_email, '') ILIKE @search_pattern
                                       OR COALESCE(audit_events.actor_name, '') ILIKE @search_pattern
                                       OR COALESCE(audit_events.subject_email, '') ILIKE @search_pattern
                                       OR COALESCE(audit_events.subject_name, '') ILIKE @search_pattern
                                       OR COALESCE(audit_events.entity_id, '') ILIKE @search_pattern
                                       OR COALESCE(audit_events.entity_label, '') ILIKE @search_pattern
                                       OR COALESCE(audit_events.description, '') ILIKE @search_pattern
                                       OR audit_events.action_label ILIKE @search_pattern
                                       OR audit_events.action_code ILIKE @search_pattern)
                                  AND (@action_code IS NULL OR audit_events.action_code = @action_code)
                                  AND (@actor_type IS NULL OR audit_events.actor_type = @actor_type);
                                """;

        int totalCount;
        await using (var countCommand = dataSource.CreateCommand(countSql))
        {
            countCommand.Parameters.Add("search_pattern", NpgsqlDbType.Text).Value = (object?)searchPattern ?? DBNull.Value;
            countCommand.Parameters.Add("action_code", NpgsqlDbType.Text).Value = (object?)normalizedActionCode ?? DBNull.Value;
            countCommand.Parameters.Add("actor_type", NpgsqlDbType.Text).Value = (object?)normalizedActorType ?? DBNull.Value;
            var scalar = await countCommand.ExecuteScalarAsync(cancellationToken);
            totalCount = scalar is null || scalar is DBNull ? 0 : Convert.ToInt32(scalar);
        }

        const string sql = """
                           SELECT id,
                                  occurred_at,
                                  action_code,
                                  action_group,
                                  action_label,
                                  description,
                                  source,
                                  actor_type,
                                  actor_user_id,
                                  actor_email,
                                  actor_name,
                                  subject_user_id,
                                  subject_email,
                                  subject_name,
                                  entity_type,
                                  entity_id,
                                  entity_label,
                                  request_path,
                                  request_method,
                                  ip_address
                           FROM app.audit_events audit_events
                           WHERE (@search_pattern IS NULL
                                  OR COALESCE(audit_events.actor_email, '') ILIKE @search_pattern
                                  OR COALESCE(audit_events.actor_name, '') ILIKE @search_pattern
                                  OR COALESCE(audit_events.subject_email, '') ILIKE @search_pattern
                                  OR COALESCE(audit_events.subject_name, '') ILIKE @search_pattern
                                  OR COALESCE(audit_events.entity_id, '') ILIKE @search_pattern
                                  OR COALESCE(audit_events.entity_label, '') ILIKE @search_pattern
                                  OR COALESCE(audit_events.description, '') ILIKE @search_pattern
                                  OR audit_events.action_label ILIKE @search_pattern
                                  OR audit_events.action_code ILIKE @search_pattern)
                             AND (@action_code IS NULL OR audit_events.action_code = @action_code)
                             AND (@actor_type IS NULL OR audit_events.actor_type = @actor_type)
                           ORDER BY audit_events.occurred_at DESC, audit_events.id DESC
                           LIMIT @limit
                           OFFSET @offset;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.Add("search_pattern", NpgsqlDbType.Text).Value = (object?)searchPattern ?? DBNull.Value;
        command.Parameters.Add("action_code", NpgsqlDbType.Text).Value = (object?)normalizedActionCode ?? DBNull.Value;
        command.Parameters.Add("actor_type", NpgsqlDbType.Text).Value = (object?)normalizedActorType ?? DBNull.Value;
        command.Parameters.AddWithValue("limit", normalizedPageSize);
        command.Parameters.AddWithValue("offset", offset);

        var rows = new List<AdminAuditEventRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new AdminAuditEventRecord(
                reader.GetInt64(0),
                reader.GetFieldValue<DateTimeOffset>(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetString(6),
                reader.GetString(7),
                reader.IsDBNull(8) ? null : reader.GetGuid(8),
                reader.IsDBNull(12) ? null : reader.GetString(12),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetGuid(11),
                reader.IsDBNull(9) ? null : reader.GetString(9),
                reader.IsDBNull(13) ? null : reader.GetString(13),
                reader.IsDBNull(14) ? null : reader.GetString(14),
                reader.IsDBNull(15) ? null : reader.GetString(15),
                reader.IsDBNull(16) ? null : reader.GetString(16),
                reader.IsDBNull(17) ? null : reader.GetString(17),
                reader.IsDBNull(18) ? null : reader.GetString(18),
                reader.IsDBNull(19) ? null : reader.GetString(19)));
        }

        return new AdminAuditEventListRecord(rows, totalCount);
    }

    public async Task<AdminAuditSummaryRecord> GetAdminSummaryAsync(CancellationToken cancellationToken)
    {
        const string summarySql = """
                                  SELECT
                                      COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '24 hours')::INTEGER AS events_last_24_hours,
                                      COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '7 days')::INTEGER AS events_last_7_days,
                                      COUNT(DISTINCT CASE
                                          WHEN occurred_at >= NOW() - INTERVAL '7 days'
                                              THEN COALESCE(actor_user_id::text, LOWER(actor_email), actor_type || ':' || COALESCE(actor_name, 'unknown'))
                                          ELSE NULL
                                      END)::INTEGER AS unique_actors_last_7_days,
                                      COUNT(*) FILTER (
                                          WHERE occurred_at >= NOW() - INTERVAL '7 days'
                                            AND action_code = 'auth.sign_in_succeeded'
                                      )::INTEGER AS sign_ins_last_7_days,
                                      COUNT(*) FILTER (
                                          WHERE occurred_at >= NOW() - INTERVAL '7 days'
                                            AND action_code = 'review.started'
                                      )::INTEGER AS reports_started_last_7_days,
                                      COUNT(*) FILTER (
                                          WHERE occurred_at >= NOW() - INTERVAL '7 days'
                                            AND action_group = 'quote'
                                      )::INTEGER AS quote_interactions_last_7_days,
                                      COUNT(*) FILTER (
                                          WHERE occurred_at >= NOW() - INTERVAL '7 days'
                                            AND action_code IN (
                                                'review.download_requested',
                                                'quote.shared_report_downloaded',
                                                'quote.shared_document_downloaded',
                                                'admin.job_artifact_download_requested',
                                                'admin.job_document_download_requested'
                                            )
                                      )::INTEGER AS document_downloads_last_7_days
                                  FROM app.audit_events;
                                  """;

        int eventsLast24Hours;
        int eventsLast7Days;
        int uniqueActorsLast7Days;
        int signInsLast7Days;
        int reportsStartedLast7Days;
        int quoteInteractionsLast7Days;
        int documentDownloadsLast7Days;

        await using (var command = dataSource.CreateCommand(summarySql))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            eventsLast24Hours = reader.GetInt32(0);
            eventsLast7Days = reader.GetInt32(1);
            uniqueActorsLast7Days = reader.GetInt32(2);
            signInsLast7Days = reader.GetInt32(3);
            reportsStartedLast7Days = reader.GetInt32(4);
            quoteInteractionsLast7Days = reader.GetInt32(5);
            documentDownloadsLast7Days = reader.GetInt32(6);
        }

        const string topActionsSql = """
                                     SELECT action_code,
                                            action_label,
                                            COUNT(*)::INTEGER AS count
                                     FROM app.audit_events
                                     WHERE occurred_at >= NOW() - INTERVAL '7 days'
                                     GROUP BY action_code, action_label
                                     ORDER BY count DESC, action_label ASC
                                     LIMIT 5;
                                     """;

        var topActions = new List<AdminAuditActionMetricRecord>();
        await using (var command = dataSource.CreateCommand(topActionsSql))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                topActions.Add(new AdminAuditActionMetricRecord(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetInt32(2)));
            }
        }

        return new AdminAuditSummaryRecord(
            eventsLast24Hours,
            eventsLast7Days,
            uniqueActorsLast7Days,
            signInsLast7Days,
            reportsStartedLast7Days,
            quoteInteractionsLast7Days,
            documentDownloadsLast7Days,
            topActions);
    }

    private static string? BuildSearchPattern(string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
        {
            return null;
        }

        return $"%{search.Trim()}%";
    }
}
