using Npgsql;
using NpgsqlTypes;
using ConveyMate.Api.Application.Reviews;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Domain.Reviews;

namespace ConveyMate.Api.Infrastructure.Persistence.Reviews;

/// <summary>
/// PostgreSQL persistence adapter for review job and document orchestration state.
/// </summary>
public sealed class ReviewJobRepository(NpgsqlDataSource dataSource) : IReviewJobRepository
{
    private const string JobSelectProjection = """
                                              id,
                                              user_id,
                                              property_address,
                                              buyer_type,
                                              buyer_context_json::text,
                                              state_or_territory,
                                              local_government_area,
                                              property_tenure_type,
                                              pack_type,
                                              status,
                                              payment_status,
                                              stripe_payment_intent_id,
                                              amount_aud_cents,
                                              created_at,
                                              updated_at,
                                              started_at,
                                              completed_at,
                                              error_message,
                                              report_s3_key,
                                              disclaimer_version,
                                              disclaimer_accepted_at,
                                              progress_json::text,
                                              summary_json::text,
                                              archived_at
                                              """;

    public async Task<ReviewJobRecord> CreateJobAsync(
        Guid jobId,
        Guid userId,
        string propertyAddress,
        string buyerType,
        string? buyerContextJson,
        string stateOrTerritory,
        string? localGovernmentArea,
        string propertyTenureType,
        string packType,
        string status,
        string paymentStatus,
        string progressJson,
        CancellationToken cancellationToken)
    {
        var sql = $"""
                    INSERT INTO app.review_jobs
                    (
                        id,
                        user_id,
                        property_address,
                        buyer_type,
                        buyer_context_json,
                        state_or_territory,
                        local_government_area,
                        property_tenure_type,
                        pack_type,
                        status,
                        payment_status,
                        progress_json
                    )
                    VALUES
                    (
                        @id,
                        @user_id,
                        @property_address,
                        @buyer_type,
                        CAST(@buyer_context_json AS jsonb),
                        @state_or_territory,
                        @local_government_area,
                        @property_tenure_type,
                        @pack_type,
                        @status,
                        @payment_status,
                        CAST(@progress_json AS jsonb)
                    )
                    RETURNING {JobSelectProjection};
                    """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", jobId);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("property_address", propertyAddress);
        command.Parameters.AddWithValue("buyer_type", buyerType);
        command.Parameters.AddWithValue("buyer_context_json", (object?)buyerContextJson ?? DBNull.Value);
        command.Parameters.AddWithValue("state_or_territory", stateOrTerritory);
        command.Parameters.AddWithValue("local_government_area", (object?)localGovernmentArea ?? DBNull.Value);
        command.Parameters.AddWithValue("property_tenure_type", propertyTenureType);
        command.Parameters.AddWithValue("pack_type", packType);
        command.Parameters.AddWithValue("status", status);
        command.Parameters.AddWithValue("payment_status", paymentStatus);
        command.Parameters.AddWithValue("progress_json", progressJson);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        var created = Map(reader);
        await reader.CloseAsync();

        await AppendProgressEventAsync(
            jobId,
            status,
            ReviewPipelineCatalog.ToStageState(status),
            "info",
            "Started: Upload",
            0,
            "job_created",
            null,
            null,
            cancellationToken);

        return created;
    }

    public async Task<ReviewJobRecord?> GetJobForUserAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
    {
        var sql = $"""
                    SELECT {JobSelectProjection}
                    FROM app.review_jobs
                    WHERE id = @job_id
                      AND user_id = @user_id
                    LIMIT 1;
                    """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("user_id", userId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var updated = Map(reader);
        await reader.CloseAsync();
        return updated;
    }

    public async Task<IReadOnlyList<ReviewJobRecord>> ListJobsForUserAsync(Guid userId, bool includeArchived, CancellationToken cancellationToken)
    {
        var sql = $"""
                    SELECT {JobSelectProjection}
                    FROM app.review_jobs
                    WHERE user_id = @user_id
                      AND (@include_archived OR archived_at IS NULL)
                    ORDER BY CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END,
                             created_at DESC;
                    """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("include_archived", includeArchived);

        var rows = new List<ReviewJobRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(Map(reader));
        }

        return rows;
    }

    public async Task<ReviewJobArchiveRecord?> SetArchivedAsync(Guid jobId, Guid userId, bool archived, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.review_jobs
                           SET archived_at = CASE
                                                 WHEN @archived THEN COALESCE(archived_at, NOW())
                                                 ELSE NULL
                                             END,
                               updated_at = NOW()
                           WHERE id = @job_id
                             AND user_id = @user_id
                           RETURNING id,
                                     archived_at;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("archived", archived);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new ReviewJobArchiveRecord(
            reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1));
    }

    public async Task<ReviewJobDeleteCandidateRecord?> GetDeleteCandidateForUserAsync(
        Guid jobId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        const string jobSql = """
                              SELECT report_s3_key
                              FROM app.review_jobs
                              WHERE id = @job_id
                                AND user_id = @user_id
                              LIMIT 1;
                              """;

        string? reportPdfS3Key;
        await using (var jobCommand = dataSource.CreateCommand(jobSql))
        {
            jobCommand.Parameters.AddWithValue("job_id", jobId);
            jobCommand.Parameters.AddWithValue("user_id", userId);
            var value = await jobCommand.ExecuteScalarAsync(cancellationToken);
            if (value is null || value is DBNull)
            {
                reportPdfS3Key = null;
            }
            else
            {
                reportPdfS3Key = Convert.ToString(value);
            }

            if (value is null)
            {
                await using var existsCommand = dataSource.CreateCommand("""
                                                                         SELECT 1
                                                                         FROM app.review_jobs
                                                                         WHERE id = @job_id
                                                                           AND user_id = @user_id
                                                                         LIMIT 1;
                                                                         """);
                existsCommand.Parameters.AddWithValue("job_id", jobId);
                existsCommand.Parameters.AddWithValue("user_id", userId);
                var exists = await existsCommand.ExecuteScalarAsync(cancellationToken);
                if (exists is null)
                {
                    return null;
                }
            }
        }

        const string documentsSql = """
                                    SELECT s3_key_raw
                                    FROM app.job_documents
                                    WHERE job_id = @job_id
                                      AND user_id = @user_id;
                                    """;

        var uploadedDocumentKeys = new List<string>();
        await using (var documentCommand = dataSource.CreateCommand(documentsSql))
        {
            documentCommand.Parameters.AddWithValue("job_id", jobId);
            documentCommand.Parameters.AddWithValue("user_id", userId);
            await using var reader = await documentCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                if (!reader.IsDBNull(0))
                {
                    uploadedDocumentKeys.Add(reader.GetString(0));
                }
            }
        }

        return new ReviewJobDeleteCandidateRecord(
            jobId,
            reportPdfS3Key,
            BuildReportJsonS3Key(jobId),
            uploadedDocumentKeys);
    }

    public async Task<bool> DeleteJobForUserAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
    {
        const string sql = """
                           WITH deleted_chunks AS (
                               DELETE FROM app.extracted_chunks
                               WHERE job_id = @job_id
                           )
                           DELETE FROM app.review_jobs
                           WHERE id = @job_id
                             AND user_id = @user_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("user_id", userId);
        var rows = await command.ExecuteNonQueryAsync(cancellationToken);
        return rows < 0;
    }

    public async Task<int> CountDocumentsAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT COUNT(*)
                           FROM app.job_documents
                           WHERE job_id = @job_id
                             AND user_id = @user_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("user_id", userId);

        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is null ? 0 : Convert.ToInt32(result);
    }

    public async Task SaveUploadedDocumentsAsync(
        Guid jobId,
        Guid userId,
        IReadOnlyList<ReviewDocumentRecord> documents,
        CancellationToken cancellationToken)
    {
        if (documents.Count == 0)
        {
            return;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        const string sql = """
                           INSERT INTO app.job_documents
                           (
                               id,
                               job_id,
                               user_id,
                               s3_key_raw,
                               filename,
                               content_type,
                               doc_type,
                               uploaded_at
                           )
                           VALUES
                           (
                               @id,
                               @job_id,
                               @user_id,
                               @s3_key_raw,
                               @filename,
                               @content_type,
                               @doc_type,
                               @uploaded_at
                           )
                           ON CONFLICT (id) DO UPDATE
                               SET s3_key_raw = EXCLUDED.s3_key_raw,
                                   filename = EXCLUDED.filename,
                                   content_type = EXCLUDED.content_type,
                                   doc_type = EXCLUDED.doc_type,
                                   uploaded_at = EXCLUDED.uploaded_at;
                           """;

        foreach (var document in documents)
        {
            await using var command = new NpgsqlCommand(sql, connection, transaction);
            command.Parameters.AddWithValue("id", document.Id);
            command.Parameters.AddWithValue("job_id", jobId);
            command.Parameters.AddWithValue("user_id", userId);
            command.Parameters.AddWithValue("s3_key_raw", document.S3KeyRaw);
            command.Parameters.AddWithValue("filename", document.FileName);
            command.Parameters.AddWithValue("content_type", document.ContentType);
            command.Parameters.AddWithValue("doc_type", document.DocType);
            command.Parameters.AddWithValue("uploaded_at", document.UploadedAt);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<bool> TransitionToAwaitingPaymentAsync(Guid jobId, Guid userId, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.review_jobs
                           SET status = @status,
                               payment_status = CASE WHEN payment_status = @unpaid THEN @unpaid ELSE payment_status END,
                               progress_json = CAST(@progress_json AS jsonb),
                               updated_at = NOW()
                           WHERE id = @job_id
                             AND user_id = @user_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("status", ReviewJobStatus.AwaitingPayment);
        command.Parameters.AddWithValue("unpaid", ReviewPaymentStatus.Unpaid);
        command.Parameters.AddWithValue(
            "progress_json",
            ReviewProgress.BuildJson(15, ReviewJobStatus.AwaitingPayment, "Uploads finalised. Awaiting payment confirmation."));
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("user_id", userId);
        var rows = await command.ExecuteNonQueryAsync(cancellationToken);

        if (rows > 0)
        {
            await AppendProgressEventAsync(
                jobId,
                ReviewJobStatus.AwaitingPayment,
                ReviewPipelineCatalog.ToStageState(ReviewJobStatus.AwaitingPayment),
                "info",
                "Started: Payment",
                15,
                "awaiting_payment",
                null,
                null,
                cancellationToken);
        }

        return rows > 0;
    }

    public async Task<ReviewJobRecord?> SetPaymentIntentAsync(
        Guid jobId,
        Guid userId,
        string paymentIntentId,
        int amountAudCents,
        CancellationToken cancellationToken)
    {
        const string existingIntentSql = """
                                         SELECT stripe_payment_intent_id
                                         FROM app.review_jobs
                                         WHERE id = @job_id
                                           AND user_id = @user_id
                                         LIMIT 1;
                                         """;

        string? existingPaymentIntentId = null;
        await using (var existingCommand = dataSource.CreateCommand(existingIntentSql))
        {
            existingCommand.Parameters.AddWithValue("job_id", jobId);
            existingCommand.Parameters.AddWithValue("user_id", userId);
            var existingValue = await existingCommand.ExecuteScalarAsync(cancellationToken);
            existingPaymentIntentId = existingValue is null || existingValue is DBNull ? null : existingValue.ToString();
        }

        var sql = $"""
                    UPDATE app.review_jobs
                    SET stripe_payment_intent_id = @payment_intent_id,
                        payment_status = @payment_status,
                        amount_aud_cents = @amount_aud_cents,
                        status = CASE WHEN status = @awaiting_upload THEN @awaiting_payment ELSE status END,
                        progress_json = CASE
                                          WHEN status = @awaiting_upload THEN CAST(@progress_json AS jsonb)
                                          ELSE progress_json
                                        END,
                        updated_at = NOW()
                    WHERE id = @job_id
                      AND user_id = @user_id
                    RETURNING {JobSelectProjection};
                    """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("payment_intent_id", paymentIntentId);
        command.Parameters.AddWithValue("payment_status", ReviewPaymentStatus.Pending);
        command.Parameters.AddWithValue("amount_aud_cents", amountAudCents);
        command.Parameters.AddWithValue("awaiting_upload", ReviewJobStatus.AwaitingUpload);
        command.Parameters.AddWithValue("awaiting_payment", ReviewJobStatus.AwaitingPayment);
        command.Parameters.AddWithValue(
            "progress_json",
            ReviewProgress.BuildJson(15, ReviewJobStatus.AwaitingPayment, "Stripe PaymentIntent created."));
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("user_id", userId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var updated = Map(reader);
        await reader.CloseAsync();

        var paymentIntentChanged = !string.Equals(
            (existingPaymentIntentId ?? string.Empty).Trim(),
            paymentIntentId.Trim(),
            StringComparison.Ordinal);

        if (paymentIntentChanged)
        {
            var stageState = ReviewPipelineCatalog.ToStageState(
                string.IsNullOrWhiteSpace(updated.Status) ? ReviewJobStatus.AwaitingPayment : updated.Status);
            await AppendProgressEventAsync(
                jobId,
                ReviewJobStatus.AwaitingPayment,
                stageState,
                "info",
                "Payment session ready. Complete secure checkout to continue.",
                15,
                "payment_intent_created",
                null,
                null,
                cancellationToken);
        }

        return updated;
    }

    public async Task<ReviewJobPaymentTransition?> MarkPaidAndQueuedAsync(string paymentIntentId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        const string selectSql = """
                                 SELECT id,
                                        user_id,
                                        queued_at
                                 FROM app.review_jobs
                                 WHERE stripe_payment_intent_id = @payment_intent_id
                                 FOR UPDATE;
                                 """;

        Guid? jobId = null;
        Guid? userId = null;
        DateTimeOffset? queuedAt = null;

        await using (var selectCommand = new NpgsqlCommand(selectSql, connection, transaction))
        {
            selectCommand.Parameters.AddWithValue("payment_intent_id", paymentIntentId);
            await using var reader = await selectCommand.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            jobId = reader.GetGuid(0);
            userId = reader.GetGuid(1);
            queuedAt = reader.IsDBNull(2) ? null : reader.GetFieldValue<DateTimeOffset>(2);
        }

        if (jobId is null || userId is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        if (queuedAt is null)
        {
            const string updateSql = """
                                     UPDATE app.review_jobs
                                     SET payment_status = @payment_status,
                                         status = @status,
                                         payment_confirmed_at = COALESCE(payment_confirmed_at, NOW()),
                                         queued_at = NOW(),
                                         progress_json = CAST(@progress_json AS jsonb),
                                         updated_at = NOW()
                                     WHERE id = @job_id;
                                     """;

            await using var updateCommand = new NpgsqlCommand(updateSql, connection, transaction);
            updateCommand.Parameters.AddWithValue("payment_status", ReviewPaymentStatus.Paid);
            updateCommand.Parameters.AddWithValue("status", ReviewJobStatus.Queued);
            updateCommand.Parameters.AddWithValue(
                "progress_json",
                ReviewProgress.BuildJson(20, ReviewJobStatus.Queued, "Queued for processing."));
            updateCommand.Parameters.AddWithValue("job_id", jobId.Value);
            await updateCommand.ExecuteNonQueryAsync(cancellationToken);

            await AppendProgressEventAsync(
                jobId.Value,
                ReviewJobStatus.Queued,
                ReviewPipelineCatalog.ToStageState(ReviewJobStatus.Queued),
                "info",
                "Queued for processing.",
                20,
                "queued_for_processing",
                null,
                null,
                cancellationToken,
                connection,
                transaction);
        }
        else
        {
            const string updateSql = """
                                     UPDATE app.review_jobs
                                     SET payment_status = @payment_status,
                                         updated_at = NOW()
                                     WHERE id = @job_id;
                                     """;
            await using var updateCommand = new NpgsqlCommand(updateSql, connection, transaction);
            updateCommand.Parameters.AddWithValue("payment_status", ReviewPaymentStatus.Paid);
            updateCommand.Parameters.AddWithValue("job_id", jobId.Value);
            await updateCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return new ReviewJobPaymentTransition(jobId.Value, userId.Value, queuedAt is null);
    }

    public async Task<ReviewDisclaimerAcceptanceRecord?> RecordDisclaimerAcceptanceAsync(
        Guid jobId,
        Guid userId,
        string disclaimerVersion,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.review_jobs
                           SET disclaimer_version = @disclaimer_version,
                               disclaimer_accepted_at = NOW(),
                               updated_at = NOW()
                           WHERE id = @job_id
                             AND user_id = @user_id
                           RETURNING id,
                                     disclaimer_version,
                                     disclaimer_accepted_at,
                                     status,
                                     COALESCE((progress_json->>'percent')::INTEGER, 0);
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("disclaimer_version", disclaimerVersion);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var acceptedVersion = reader.GetString(1);
        var acceptedAtUtc = reader.GetFieldValue<DateTimeOffset>(2);
        var status = reader.GetString(3);
        var percent = reader.GetInt32(4);
        await reader.CloseAsync();

        await AppendProgressEventAsync(
            jobId,
            status,
            ReviewPipelineCatalog.ToStageState(status),
            "info",
            $"Disclaimer acknowledged (version {acceptedVersion}).",
            percent,
            "disclaimer_acknowledged",
            null,
            null,
            cancellationToken);

        return new ReviewDisclaimerAcceptanceRecord(jobId, acceptedVersion, acceptedAtUtc);
    }

    public async Task<IReadOnlyList<ReviewProgressEventRecord>> ListProgressEventsForUserAsync(
        Guid jobId,
        Guid userId,
        DateTimeOffset? sinceUtc,
        int limit,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT e.id,
                                  e.job_id,
                                  e.created_at,
                                  e.stage_id,
                                  e.stage_state,
                                  e.severity,
                                  e.message,
                                  e.percent,
                                  e.detail_code,
                                  e.attempt,
                                  e.max_attempts
                           FROM app.review_job_progress_events e
                           JOIN app.review_jobs j ON j.id = e.job_id
                           WHERE e.job_id = @job_id
                             AND j.user_id = @user_id
                             AND (@since_utc IS NULL OR e.created_at > @since_utc)
                           ORDER BY e.created_at ASC, e.id ASC
                           LIMIT @limit;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("since_utc", NpgsqlDbType.TimestampTz, (object?)sinceUtc ?? DBNull.Value);
        command.Parameters.AddWithValue("limit", Math.Clamp(limit, 1, 250));

        var rows = new List<ReviewProgressEventRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new ReviewProgressEventRecord(
                reader.GetInt64(0),
                reader.GetGuid(1),
                reader.GetFieldValue<DateTimeOffset>(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetInt32(7),
                reader.IsDBNull(8) ? null : reader.GetString(8),
                reader.IsDBNull(9) ? null : reader.GetInt32(9),
                reader.IsDBNull(10) ? null : reader.GetInt32(10)));
        }

        return rows;
    }

    public async Task<bool> RegisterWebhookEventAsync(
        string eventId,
        string paymentIntentId,
        string eventType,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           INSERT INTO app.stripe_webhook_events
                           (
                               event_id,
                               payment_intent_id,
                               event_type
                           )
                           VALUES
                           (
                               @event_id,
                               @payment_intent_id,
                               @event_type
                           )
                           ON CONFLICT (event_id) DO NOTHING;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("event_id", eventId);
        command.Parameters.AddWithValue("payment_intent_id", paymentIntentId);
        command.Parameters.AddWithValue("event_type", eventType);
        var rows = await command.ExecuteNonQueryAsync(cancellationToken);
        return rows > 0;
    }

    private async Task AppendProgressEventAsync(
        Guid jobId,
        string stageId,
        string stageState,
        string severity,
        string message,
        int? percent,
        string? detailCode,
        int? attempt,
        int? maxAttempts,
        CancellationToken cancellationToken,
        NpgsqlConnection? connection = null,
        NpgsqlTransaction? transaction = null)
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

        var normalizedStageId = string.IsNullOrWhiteSpace(stageId) ? ReviewJobStatus.Queued : stageId.Trim();
        var normalizedStageState = string.IsNullOrWhiteSpace(stageState) ? "queued" : stageState.Trim().ToLowerInvariant();
        var normalizedSeverity = string.IsNullOrWhiteSpace(severity) ? "info" : severity.Trim().ToLowerInvariant();
        var normalizedMessage = string.IsNullOrWhiteSpace(message) ? "Progress updated." : message.Trim();
        if (normalizedMessage.Length > 600)
        {
            normalizedMessage = normalizedMessage[..600];
        }

        if (connection is not null)
        {
            await using var txCommand = new NpgsqlCommand(sql, connection, transaction);
            txCommand.Parameters.AddWithValue("job_id", jobId);
            txCommand.Parameters.AddWithValue("stage_id", normalizedStageId);
            txCommand.Parameters.AddWithValue("stage_state", normalizedStageState);
            txCommand.Parameters.AddWithValue("severity", normalizedSeverity);
            txCommand.Parameters.AddWithValue("message", normalizedMessage);
            txCommand.Parameters.AddWithValue("percent", NpgsqlDbType.Integer, (object?)percent ?? DBNull.Value);
            txCommand.Parameters.AddWithValue("detail_code", NpgsqlDbType.Text, (object?)detailCode ?? DBNull.Value);
            txCommand.Parameters.AddWithValue("attempt", NpgsqlDbType.Integer, (object?)attempt ?? DBNull.Value);
            txCommand.Parameters.AddWithValue("max_attempts", NpgsqlDbType.Integer, (object?)maxAttempts ?? DBNull.Value);
            await txCommand.ExecuteNonQueryAsync(cancellationToken);
            return;
        }

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", jobId);
        command.Parameters.AddWithValue("stage_id", normalizedStageId);
        command.Parameters.AddWithValue("stage_state", normalizedStageState);
        command.Parameters.AddWithValue("severity", normalizedSeverity);
        command.Parameters.AddWithValue("message", normalizedMessage);
        command.Parameters.AddWithValue("percent", NpgsqlDbType.Integer, (object?)percent ?? DBNull.Value);
        command.Parameters.AddWithValue("detail_code", NpgsqlDbType.Text, (object?)detailCode ?? DBNull.Value);
        command.Parameters.AddWithValue("attempt", NpgsqlDbType.Integer, (object?)attempt ?? DBNull.Value);
        command.Parameters.AddWithValue("max_attempts", NpgsqlDbType.Integer, (object?)maxAttempts ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static ReviewJobRecord Map(NpgsqlDataReader reader)
    {
        return new ReviewJobRecord(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.GetString(7),
            reader.GetString(8),
            reader.GetString(9),
            reader.GetString(10),
            reader.IsDBNull(11) ? null : reader.GetString(11),
            reader.GetInt32(12),
            reader.GetFieldValue<DateTimeOffset>(13),
            reader.GetFieldValue<DateTimeOffset>(14),
            reader.IsDBNull(16) ? null : reader.GetFieldValue<DateTimeOffset>(16),
            reader.IsDBNull(15) ? null : reader.GetFieldValue<DateTimeOffset>(15),
            reader.IsDBNull(17) ? null : reader.GetString(17),
            reader.IsDBNull(18) ? null : reader.GetString(18),
            reader.IsDBNull(19) ? null : reader.GetString(19),
            reader.IsDBNull(20) ? null : reader.GetFieldValue<DateTimeOffset>(20),
            reader.GetString(21),
            reader.IsDBNull(22) ? null : reader.GetString(22),
            reader.IsDBNull(23) ? null : reader.GetFieldValue<DateTimeOffset>(23));
    }

    private static string BuildReportJsonS3Key(Guid jobId)
    {
        return $"reports/{jobId}/report.json";
    }
}
