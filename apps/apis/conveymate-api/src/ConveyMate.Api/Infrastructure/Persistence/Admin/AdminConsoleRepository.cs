using Npgsql;
using NpgsqlTypes;
using ConveyMate.Api.Application.Admin.Abstractions;
using ConveyMate.Api.Application.Reviews;
using ConveyMate.Api.Domain.Reviews;

namespace ConveyMate.Api.Infrastructure.Persistence.Admin;

public sealed class AdminConsoleRepository(NpgsqlDataSource dataSource) : IAdminConsoleRepository
{
    Task<AdminDeleteQuoteWorkflowCandidateRecord?> IAdminConsoleRepository.GetQuoteWorkflowDeleteCandidateAsync(
        Guid jobId,
        CancellationToken cancellationToken)
        => GetQuoteWorkflowDeleteCandidateAsync(jobId, cancellationToken);

    Task<int> IAdminConsoleRepository.DeleteQuoteWorkflowsAsync(Guid jobId, CancellationToken cancellationToken)
        => DeleteQuoteWorkflowsAsync(jobId, cancellationToken);

    public async Task<AdminJobListRecord> ListJobsAsync(
        int page,
        int pageSize,
        string? search,
        string? status,
        CancellationToken cancellationToken)
    {
        var normalizedPage = Math.Max(1, page);
        var normalizedPageSize = Math.Clamp(pageSize <= 0 ? 25 : pageSize, 1, 100);
        var offset = (normalizedPage - 1) * normalizedPageSize;
        var searchPattern = BuildSearchPattern(search);
        var normalizedStatus = string.IsNullOrWhiteSpace(status) ? null : status.Trim();

        const string countSql = """
                                SELECT COUNT(*)
                                FROM app.review_jobs jobs
                                JOIN app.users users ON users.id = jobs.user_id
                                WHERE (@search_pattern IS NULL OR jobs.property_address ILIKE @search_pattern
                                       OR users.email ILIKE @search_pattern
                                       OR users.full_name ILIKE @search_pattern
                                       OR CAST(jobs.id AS text) ILIKE @search_pattern)
                                  AND (@status IS NULL OR jobs.status = @status);
                                """;

        int totalCount;
        await using (var countCommand = dataSource.CreateCommand(countSql))
        {
            countCommand.Parameters.Add("search_pattern", NpgsqlDbType.Text).Value = (object?)searchPattern ?? DBNull.Value;
            countCommand.Parameters.Add("status", NpgsqlDbType.Text).Value = (object?)normalizedStatus ?? DBNull.Value;
            var scalar = await countCommand.ExecuteScalarAsync(cancellationToken);
            totalCount = scalar is null || scalar is DBNull ? 0 : Convert.ToInt32(scalar);
        }

        const string sql = """
                           SELECT jobs.id,
                                  jobs.user_id,
                                  users.email,
                                  users.full_name,
                                  jobs.property_address,
                                  jobs.status,
                                  jobs.payment_status,
                                  jobs.amount_aud_cents,
                                  jobs.created_at,
                                  jobs.updated_at,
                                  jobs.started_at,
                                  jobs.completed_at,
                                  jobs.error_message,
                                  EXISTS(
                                      SELECT 1
                                      FROM app.quote_requests quote_requests
                                      WHERE quote_requests.review_job_id = jobs.id
                                  ) AS has_quote_workflow
                           FROM app.review_jobs jobs
                           JOIN app.users users ON users.id = jobs.user_id
                           WHERE (@search_pattern IS NULL OR jobs.property_address ILIKE @search_pattern
                                  OR users.email ILIKE @search_pattern
                                  OR users.full_name ILIKE @search_pattern
                                  OR CAST(jobs.id AS text) ILIKE @search_pattern)
                             AND (@status IS NULL OR jobs.status = @status)
                           ORDER BY jobs.created_at DESC, jobs.id DESC
                           LIMIT @limit
                           OFFSET @offset;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.Add("search_pattern", NpgsqlDbType.Text).Value = (object?)searchPattern ?? DBNull.Value;
        command.Parameters.Add("status", NpgsqlDbType.Text).Value = (object?)normalizedStatus ?? DBNull.Value;
        command.Parameters.AddWithValue("limit", normalizedPageSize);
        command.Parameters.AddWithValue("offset", offset);

        var jobs = new List<AdminJobSummaryRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            jobs.Add(new AdminJobSummaryRecord(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                reader.GetInt32(7),
                reader.GetFieldValue<DateTimeOffset>(8),
                reader.GetFieldValue<DateTimeOffset>(9),
                reader.IsDBNull(11) ? null : reader.GetFieldValue<DateTimeOffset>(11),
                reader.IsDBNull(10) ? null : reader.GetFieldValue<DateTimeOffset>(10),
                reader.IsDBNull(12) ? null : reader.GetString(12),
                reader.GetBoolean(13)));
        }

        return new AdminJobListRecord(jobs, totalCount);
    }

    public async Task<AdminJobDetailRecord?> GetJobByIdAsync(Guid jobId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT jobs.id,
                                  jobs.user_id,
                                  users.email,
                                  users.full_name,
                                  jobs.property_address,
                                  jobs.buyer_type,
                                  jobs.buyer_context_json::text,
                                  jobs.state_or_territory,
                                  jobs.local_government_area,
                                  jobs.property_tenure_type,
                                  jobs.pack_type,
                                  jobs.status,
                                  jobs.payment_status,
                                  jobs.amount_aud_cents,
                                  jobs.stripe_payment_intent_id,
                                  jobs.report_s3_key,
                                  jobs.error_message,
                                  jobs.created_at,
                                  jobs.updated_at,
                                  jobs.started_at,
                                  jobs.completed_at,
                                  jobs.progress_json::text,
                                  jobs.summary_json::text,
                                  EXISTS(
                                      SELECT 1
                                      FROM app.quote_requests quote_requests
                                      WHERE quote_requests.review_job_id = jobs.id
                                  ) AS has_quote_workflow,
                                  (
                                      SELECT quote_requests.status
                                      FROM app.quote_requests quote_requests
                                      WHERE quote_requests.review_job_id = jobs.id
                                      ORDER BY quote_requests.created_at DESC, quote_requests.id DESC
                                      LIMIT 1
                                  ) AS quote_workflow_status,
                                  (
                                      SELECT COUNT(*)::INTEGER
                                      FROM app.quote_request_targets quote_request_targets
                                      INNER JOIN app.quote_requests quote_requests
                                          ON quote_requests.id = quote_request_targets.quote_request_id
                                      WHERE quote_requests.review_job_id = jobs.id
                                  ) AS quote_workflow_target_count,
                                  (
                                      SELECT COUNT(*)::INTEGER
                                      FROM app.quote_request_responses quote_request_responses
                                      INNER JOIN app.quote_request_targets quote_request_targets
                                          ON quote_request_targets.id = quote_request_responses.target_id
                                      INNER JOIN app.quote_requests quote_requests
                                          ON quote_requests.id = quote_request_targets.quote_request_id
                                      WHERE quote_requests.review_job_id = jobs.id
                                  ) AS quote_workflow_response_count
                           FROM app.review_jobs jobs
                           JOIN app.users users ON users.id = jobs.user_id
                           WHERE jobs.id = @job_id
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new AdminJobDetailRecord(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.GetString(7),
            reader.IsDBNull(8) ? null : reader.GetString(8),
            reader.GetString(9),
            reader.GetString(10),
            reader.GetString(11),
            reader.GetString(12),
            reader.GetInt32(13),
            reader.IsDBNull(14) ? null : reader.GetString(14),
            reader.IsDBNull(15) ? null : reader.GetString(15),
            reader.IsDBNull(16) ? null : reader.GetString(16),
            reader.GetFieldValue<DateTimeOffset>(17),
            reader.GetFieldValue<DateTimeOffset>(18),
            reader.IsDBNull(19) ? null : reader.GetFieldValue<DateTimeOffset>(19),
            reader.IsDBNull(20) ? null : reader.GetFieldValue<DateTimeOffset>(20),
            reader.GetString(21),
            reader.IsDBNull(22) ? null : reader.GetString(22),
            reader.GetBoolean(23),
            reader.IsDBNull(24) ? null : reader.GetString(24),
            reader.GetInt32(25),
            reader.GetInt32(26));
    }

    public async Task<IReadOnlyList<AdminJobDocumentRecord>> ListJobDocumentsAsync(Guid jobId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  job_id,
                                  user_id,
                                  s3_key_raw,
                                  filename,
                                  content_type,
                                  doc_type,
                                  uploaded_at
                           FROM app.job_documents
                           WHERE job_id = @job_id
                           ORDER BY uploaded_at DESC, id DESC;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        var rows = new List<AdminJobDocumentRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new AdminJobDocumentRecord(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                reader.GetFieldValue<DateTimeOffset>(7)));
        }

        return rows;
    }

    public async Task<AdminJobDocumentRecord?> GetJobDocumentAsync(Guid jobId, Guid documentId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  job_id,
                                  user_id,
                                  s3_key_raw,
                                  filename,
                                  content_type,
                                  doc_type,
                                  uploaded_at
                           FROM app.job_documents
                           WHERE job_id = @job_id
                             AND id = @document_id
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("document_id", documentId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new AdminJobDocumentRecord(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetGuid(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetFieldValue<DateTimeOffset>(7));
    }

    public async Task<AdminDeleteJobCandidateRecord?> GetJobDeleteCandidateAsync(Guid jobId, CancellationToken cancellationToken)
    {
        const string jobSql = """
                              SELECT user_id,
                                     report_s3_key
                              FROM app.review_jobs
                              WHERE id = @job_id
                              LIMIT 1;
                              """;

        Guid? userId = null;
        string? reportPdfS3Key = null;
        await using (var jobCommand = dataSource.CreateCommand(jobSql))
        {
            jobCommand.Parameters.AddWithValue("job_id", jobId);
            await using var reader = await jobCommand.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }

            userId = reader.GetGuid(0);
            reportPdfS3Key = reader.IsDBNull(1) ? null : reader.GetString(1);
        }

        const string documentsSql = """
                                    SELECT s3_key_raw
                                    FROM app.job_documents
                                    WHERE job_id = @job_id;
                                    """;

        var uploadedDocumentKeys = new List<string>();
        await using (var documentCommand = dataSource.CreateCommand(documentsSql))
        {
            documentCommand.Parameters.AddWithValue("job_id", jobId);
            await using var reader = await documentCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                if (!reader.IsDBNull(0))
                {
                    uploadedDocumentKeys.Add(reader.GetString(0));
                }
            }
        }

        if (userId is null || userId == Guid.Empty)
        {
            return null;
        }

        return new AdminDeleteJobCandidateRecord(
            jobId,
            userId.Value,
            reportPdfS3Key,
            BuildReportJsonS3Key(jobId),
            uploadedDocumentKeys);
    }

    public async Task<bool> DeleteJobAsync(Guid jobId, CancellationToken cancellationToken)
    {
        // Delete extracted chunks first (no FK constraint), then the job row.
        // Using a CTE ensures both deletions are atomic within a single round-trip.
        const string sql = """
                           WITH deleted_chunks AS (
                               DELETE FROM app.extracted_chunks
                               WHERE job_id = @job_id
                           )
                           DELETE FROM app.review_jobs
                           WHERE id = @job_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        var rows = await command.ExecuteNonQueryAsync(cancellationToken);
        return rows > 0;
    }

    public async Task<AdminDeleteQuoteWorkflowCandidateRecord?> GetQuoteWorkflowDeleteCandidateAsync(
        Guid jobId,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT jobs.user_id,
                                  COUNT(quote_requests.id)::INTEGER AS workflow_count
                           FROM app.review_jobs jobs
                           LEFT JOIN app.quote_requests quote_requests
                               ON quote_requests.review_job_id = jobs.id
                           WHERE jobs.id = @job_id
                           GROUP BY jobs.user_id
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var workflowCount = reader.GetInt32(1);
        if (workflowCount <= 0)
        {
            return null;
        }

        return new AdminDeleteQuoteWorkflowCandidateRecord(
            jobId,
            reader.GetGuid(0),
            workflowCount);
    }

    public async Task<int> DeleteQuoteWorkflowsAsync(Guid jobId, CancellationToken cancellationToken)
    {
        const string sql = """
                           DELETE FROM app.quote_requests
                           WHERE review_job_id = @job_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<AdminFeedbackListRecord> ListFeedbackAsync(
        int page,
        int pageSize,
        string? type,
        CancellationToken cancellationToken)
    {
        var normalizedPage = Math.Max(1, page);
        var normalizedPageSize = Math.Clamp(pageSize <= 0 ? 25 : pageSize, 1, 100);
        var offset = (normalizedPage - 1) * normalizedPageSize;
        var normalizedType = string.IsNullOrWhiteSpace(type) ? null : type.Trim().ToLowerInvariant();

        const string countSql = """
                                SELECT COUNT(*)
                                FROM app.feedback feedback
                                WHERE (@type IS NULL OR feedback.type = @type);
                                """;

        int totalCount;
        await using (var countCommand = dataSource.CreateCommand(countSql))
        {
            countCommand.Parameters.Add("type", NpgsqlDbType.Text).Value = (object?)normalizedType ?? DBNull.Value;
            var scalar = await countCommand.ExecuteScalarAsync(cancellationToken);
            totalCount = scalar is null || scalar is DBNull ? 0 : Convert.ToInt32(scalar);
        }

        const string sql = """
                           SELECT feedback.id,
                                  feedback.user_id,
                                  users.email,
                                  users.full_name,
                                  feedback.type,
                                  feedback.message,
                                  feedback.page_url,
                                  feedback.user_agent,
                                  feedback.created_at
                           FROM app.feedback feedback
                           JOIN app.users users ON users.id = feedback.user_id
                           WHERE (@type IS NULL OR feedback.type = @type)
                           ORDER BY feedback.created_at DESC, feedback.id DESC
                           LIMIT @limit
                           OFFSET @offset;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.Add("type", NpgsqlDbType.Text).Value = (object?)normalizedType ?? DBNull.Value;
        command.Parameters.AddWithValue("limit", normalizedPageSize);
        command.Parameters.AddWithValue("offset", offset);

        var items = new List<AdminFeedbackRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new AdminFeedbackRecord(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetFieldValue<DateTimeOffset>(8)));
        }

        return new AdminFeedbackListRecord(items, totalCount);
    }

    public async Task<AdminUserListRecord> ListUsersAsync(
        int page,
        int pageSize,
        string? search,
        CancellationToken cancellationToken)
    {
        var normalizedPage = Math.Max(1, page);
        var normalizedPageSize = Math.Clamp(pageSize <= 0 ? 25 : pageSize, 1, 100);
        var offset = (normalizedPage - 1) * normalizedPageSize;
        var searchPattern = BuildSearchPattern(search);

        const string countSql = """
                                SELECT COUNT(*)
                                FROM app.users users
                                WHERE (@search_pattern IS NULL OR users.email ILIKE @search_pattern
                                       OR users.full_name ILIKE @search_pattern);
                                """;

        int totalCount;
        await using (var countCommand = dataSource.CreateCommand(countSql))
        {
            countCommand.Parameters.Add("search_pattern", NpgsqlDbType.Text).Value = (object?)searchPattern ?? DBNull.Value;
            var scalar = await countCommand.ExecuteScalarAsync(cancellationToken);
            totalCount = scalar is null || scalar is DBNull ? 0 : Convert.ToInt32(scalar);
        }

        const string sql = """
                           SELECT users.id,
                                  users.full_name,
                                  users.email,
                                  users.is_admin,
                                  users.is_suspended,
                                  users.created_at,
                                  users.last_login_at,
                                  COUNT(jobs.id)::INTEGER AS jobs_run_count,
                                  COALESCE(
                                      SUM(
                                          CASE
                                              WHEN jobs.payment_status = 'Paid' THEN jobs.amount_aud_cents
                                              ELSE 0
                                          END
                                      ),
                                      0
                                  )::BIGINT AS total_spent_aud_cents
                           FROM app.users users
                           LEFT JOIN app.review_jobs jobs ON jobs.user_id = users.id
                           WHERE (@search_pattern IS NULL OR users.email ILIKE @search_pattern
                                  OR users.full_name ILIKE @search_pattern)
                           GROUP BY users.id,
                                    users.full_name,
                                    users.email,
                                    users.is_admin,
                                    users.is_suspended,
                                    users.created_at,
                                    users.last_login_at
                           ORDER BY users.created_at DESC, users.id DESC
                           LIMIT @limit
                           OFFSET @offset;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.Add("search_pattern", NpgsqlDbType.Text).Value = (object?)searchPattern ?? DBNull.Value;
        command.Parameters.AddWithValue("limit", normalizedPageSize);
        command.Parameters.AddWithValue("offset", offset);

        var users = new List<AdminUserRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            users.Add(MapAdminUser(reader));
        }

        return new AdminUserListRecord(users, totalCount);
    }

    public async Task<AdminUserRecord?> SetUserSuspensionAsync(Guid userId, bool isSuspended, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.users
                           SET is_suspended = @is_suspended,
                               suspended_at = CASE
                                                  WHEN @is_suspended THEN COALESCE(suspended_at, NOW())
                                                  ELSE NULL
                                              END,
                               updated_at = NOW()
                           WHERE id = @user_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("is_suspended", isSuspended);
        var rows = await command.ExecuteNonQueryAsync(cancellationToken);
        if (rows <= 0)
        {
            return null;
        }

        return await GetUserByIdAsync(userId, cancellationToken);
    }

    public async Task<AdminUserRecord?> GetUserByIdAsync(Guid userId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT users.id,
                                  users.full_name,
                                  users.email,
                                  users.is_admin,
                                  users.is_suspended,
                                  users.created_at,
                                  users.last_login_at,
                                  COUNT(jobs.id)::INTEGER AS jobs_run_count,
                                  COALESCE(
                                      SUM(
                                          CASE
                                              WHEN jobs.payment_status = 'Paid' THEN jobs.amount_aud_cents
                                              ELSE 0
                                          END
                                      ),
                                      0
                                  )::BIGINT AS total_spent_aud_cents
                           FROM app.users users
                           LEFT JOIN app.review_jobs jobs ON jobs.user_id = users.id
                           WHERE users.id = @user_id
                           GROUP BY users.id,
                                    users.full_name,
                                    users.email,
                                    users.is_admin,
                                    users.is_suspended,
                                    users.created_at,
                                    users.last_login_at
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("user_id", userId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return MapAdminUser(reader);
    }

    private static AdminUserRecord MapAdminUser(NpgsqlDataReader reader)
    {
        return new AdminUserRecord(
            reader.GetGuid(0),
            reader.GetString(2),
            reader.GetString(1),
            reader.GetBoolean(3),
            reader.GetBoolean(4),
            reader.GetFieldValue<DateTimeOffset>(5),
            reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
            reader.GetInt32(7),
            reader.GetInt64(8));
    }

    private static string? BuildSearchPattern(string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
        {
            return null;
        }

        return $"%{search.Trim()}%";
    }

    private static string BuildReportJsonS3Key(Guid jobId)
    {
        return $"reports/{jobId}/report.json";
    }

    private static async Task AppendProgressEventAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid jobId,
        string stageId,
        string stageState,
        string severity,
        string message,
        int? percent,
        string? detailCode,
        int? attempt,
        int? maxAttempts,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           INSERT INTO app.review_job_progress_events
                           (
                               job_id,
                               stage_id,
                               stage_state,
                               severity,
                               message,
                               percent,
                               detail_code,
                               attempt,
                               max_attempts
                           )
                           VALUES
                           (
                               @job_id,
                               @stage_id,
                               @stage_state,
                               @severity,
                               @message,
                               @percent,
                               @detail_code,
                               @attempt,
                               @max_attempts
                           );
                           """;

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.Add("job_id", NpgsqlDbType.Uuid).Value = jobId;
        command.Parameters.Add("stage_id", NpgsqlDbType.Text).Value = string.IsNullOrWhiteSpace(stageId) ? ReviewJobStatus.Queued : stageId.Trim();
        command.Parameters.Add("stage_state", NpgsqlDbType.Text).Value = string.IsNullOrWhiteSpace(stageState) ? "queued" : stageState.Trim().ToLowerInvariant();
        command.Parameters.Add("severity", NpgsqlDbType.Text).Value = string.IsNullOrWhiteSpace(severity) ? "info" : severity.Trim().ToLowerInvariant();
        command.Parameters.Add("message", NpgsqlDbType.Text).Value = string.IsNullOrWhiteSpace(message) ? "Progress updated." : Truncate(message, 600) ?? "Progress updated.";
        command.Parameters.Add("percent", NpgsqlDbType.Integer).Value = (object?)percent ?? DBNull.Value;
        command.Parameters.Add("detail_code", NpgsqlDbType.Text).Value = (object?)detailCode ?? DBNull.Value;
        command.Parameters.Add("attempt", NpgsqlDbType.Integer).Value = (object?)attempt ?? DBNull.Value;
        command.Parameters.Add("max_attempts", NpgsqlDbType.Integer).Value = (object?)maxAttempts ?? DBNull.Value;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length <= maxLength)
        {
            return value;
        }

        return value[..maxLength];
    }
}
