using System.Text.Json;
using Npgsql;
using ConveyMate.Api.Application.QuoteRequests.Abstractions;
using ConveyMate.Api.Domain.QuoteRequests;

namespace ConveyMate.Api.Infrastructure.Persistence.QuoteRequests;

/// <summary>
/// PostgreSQL persistence adapter for quote-request workflows.
/// </summary>
public sealed class QuoteRequestRepository(NpgsqlDataSource dataSource) : IQuoteRequestRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private const string RequestProjection = """
                                             qr.id,
                                             qr.user_id,
                                             qr.review_job_id,
                                             qr.property_address,
                                             qr.state_or_territory,
                                             qr.service_need,
                                             qr.message,
                                             qr.share_report_pdf,
                                             qr.brief_json::text,
                                             qr.status,
                                             qr.created_at,
                                             qr.updated_at,
                                             qr.sent_at,
                                             qr.expires_at,
                                             qr.archived_at
                                             """;

    private const string TargetProjection = """
                                            t.id,
                                            t.quote_request_id,
                                            t.jurisdiction,
                                            t.regulator_type,
                                            t.source_identifier,
                                            t.name,
                                            t.contact_name,
                                            t.organization_name,
                                            t.email,
                                            t.phone,
                                            t.website,
                                            t.source_url,
                                            t.status,
                                            t.response_token_hash,
                                            t.created_at,
                                            t.updated_at,
                                            t.sent_at,
                                            t.opened_at,
                                            t.responded_at,
                                            t.delivery_error
                                            """;

    private const string ResponseProjection = """
                                              r.id,
                                              r.target_id,
                                              r.responder_name,
                                              r.responder_email,
                                              r.responder_phone,
                                              r.professional_fee_aud,
                                              r.includes_gst,
                                              r.disbursements_estimate_aud,
                                              r.turnaround_business_days,
                                              r.scope_notes,
                                              r.excluded_items_json::text,
                                              r.valid_until_utc,
                                              r.created_at,
                                              r.updated_at
                                              """;

    public async Task CreateAsync(
        QuoteRequestCreateRecord request,
        IReadOnlyList<QuoteRequestTargetCreateRecord> targets,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        const string insertRequestSql = """
                                        INSERT INTO app.quote_requests
                                        (
                                            id,
                                            user_id,
                                            review_job_id,
                                            property_address,
                                            state_or_territory,
                                            service_need,
                                            message,
                                            share_report_pdf,
                                            brief_json,
                                            status,
                                            created_at,
                                            updated_at,
                                            expires_at
                                        )
                                        VALUES
                                        (
                                            @id,
                                            @user_id,
                                            @review_job_id,
                                            @property_address,
                                            @state_or_territory,
                                            @service_need,
                                            @message,
                                            @share_report_pdf,
                                            CAST(@brief_json AS jsonb),
                                            @status,
                                            @created_at,
                                            @updated_at,
                                            @expires_at
                                        );
                                        """;

        await using (var requestCommand = new NpgsqlCommand(insertRequestSql, connection, transaction))
        {
            requestCommand.Parameters.AddWithValue("id", request.Id);
            requestCommand.Parameters.AddWithValue("user_id", request.UserId);
            requestCommand.Parameters.AddWithValue("review_job_id", request.ReviewJobId);
            requestCommand.Parameters.AddWithValue("property_address", request.PropertyAddress);
            requestCommand.Parameters.AddWithValue("state_or_territory", request.StateOrTerritory);
            requestCommand.Parameters.AddWithValue("service_need", request.ServiceNeed);
            requestCommand.Parameters.AddWithValue("message", (object?)request.Message ?? DBNull.Value);
            requestCommand.Parameters.AddWithValue("share_report_pdf", request.ShareReportPdf);
            requestCommand.Parameters.AddWithValue("brief_json", request.BriefJson);
            requestCommand.Parameters.AddWithValue("status", request.Status);
            requestCommand.Parameters.AddWithValue("created_at", request.CreatedAtUtc);
            requestCommand.Parameters.AddWithValue("updated_at", request.CreatedAtUtc);
            requestCommand.Parameters.AddWithValue("expires_at", request.ExpiresAtUtc);
            await requestCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        const string insertTargetSql = """
                                       INSERT INTO app.quote_request_targets
                                       (
                                           id,
                                           quote_request_id,
                                           jurisdiction,
                                           regulator_type,
                                           source_identifier,
                                           name,
                                           contact_name,
                                           organization_name,
                                           email,
                                           phone,
                                           website,
                                           source_url,
                                           response_token_hash,
                                           status,
                                           created_at,
                                           updated_at
                                       )
                                       VALUES
                                       (
                                           @id,
                                           @quote_request_id,
                                           @jurisdiction,
                                           @regulator_type,
                                           @source_identifier,
                                           @name,
                                           @contact_name,
                                           @organization_name,
                                           @email,
                                           @phone,
                                           @website,
                                           @source_url,
                                           @response_token_hash,
                                           @status,
                                           @created_at,
                                           @updated_at
                                       );
                                       """;

        foreach (var target in targets)
        {
            await using var targetCommand = new NpgsqlCommand(insertTargetSql, connection, transaction);
            targetCommand.Parameters.AddWithValue("id", target.Id);
            targetCommand.Parameters.AddWithValue("quote_request_id", target.QuoteRequestId);
            targetCommand.Parameters.AddWithValue("jurisdiction", target.Jurisdiction);
            targetCommand.Parameters.AddWithValue("regulator_type", target.RegulatorType);
            targetCommand.Parameters.AddWithValue("source_identifier", target.SourceIdentifier);
            targetCommand.Parameters.AddWithValue("name", target.Name);
            targetCommand.Parameters.AddWithValue("contact_name", (object?)target.ContactName ?? DBNull.Value);
            targetCommand.Parameters.AddWithValue("organization_name", (object?)target.OrganizationName ?? DBNull.Value);
            targetCommand.Parameters.AddWithValue("email", target.Email);
            targetCommand.Parameters.AddWithValue("phone", (object?)target.Phone ?? DBNull.Value);
            targetCommand.Parameters.AddWithValue("website", (object?)target.Website ?? DBNull.Value);
            targetCommand.Parameters.AddWithValue("source_url", target.SourceUrl);
            targetCommand.Parameters.AddWithValue("response_token_hash", target.ResponseTokenHash);
            targetCommand.Parameters.AddWithValue("status", target.Status);
            targetCommand.Parameters.AddWithValue("created_at", target.CreatedAtUtc);
            targetCommand.Parameters.AddWithValue("updated_at", target.CreatedAtUtc);
            await targetCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<QuoteRequestSummaryRecord>> ListForUserAsync(Guid userId, bool includeArchived, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT qr.id,
                                  qr.review_job_id,
                                  qr.property_address,
                                  qr.state_or_territory,
                                  qr.service_need,
                                  qr.status,
                                  qr.created_at,
                                  qr.sent_at,
                                  qr.expires_at,
                                  qr.archived_at,
                                  COUNT(t.id)::integer AS target_count,
                                  COUNT(r.id)::integer AS response_count
                           FROM app.quote_requests qr
                           LEFT JOIN app.quote_request_targets t
                               ON t.quote_request_id = qr.id
                           LEFT JOIN app.quote_request_responses r
                               ON r.target_id = t.id
                           WHERE qr.user_id = @user_id
                             AND (@include_archived OR qr.archived_at IS NULL)
                           GROUP BY qr.id
                           ORDER BY CASE WHEN qr.archived_at IS NULL THEN 0 ELSE 1 END,
                                    qr.created_at DESC;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("include_archived", includeArchived);

        var rows = new List<QuoteRequestSummaryRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new QuoteRequestSummaryRecord(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetFieldValue<DateTimeOffset>(6),
                reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
                reader.GetFieldValue<DateTimeOffset>(8),
                reader.GetInt32(11),
                reader.GetInt32(10),
                reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9)));
        }

        return rows;
    }

    public async Task<QuoteRequestSummaryRecord?> GetSummaryForUserByReviewJobAsync(
        Guid userId,
        Guid reviewJobId,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT qr.id,
                                  qr.review_job_id,
                                  qr.property_address,
                                  qr.state_or_territory,
                                  qr.service_need,
                                  qr.status,
                                  qr.created_at,
                                  qr.sent_at,
                                  qr.expires_at,
                                  qr.archived_at,
                                  COUNT(t.id)::integer AS target_count,
                                  COUNT(r.id)::integer AS response_count
                           FROM app.quote_requests qr
                           LEFT JOIN app.quote_request_targets t
                               ON t.quote_request_id = qr.id
                           LEFT JOIN app.quote_request_responses r
                               ON r.target_id = t.id
                           WHERE qr.user_id = @user_id
                             AND qr.review_job_id = @review_job_id
                           GROUP BY qr.id
                           ORDER BY qr.created_at DESC
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("review_job_id", reviewJobId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new QuoteRequestSummaryRecord(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetFieldValue<DateTimeOffset>(6),
            reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
            reader.GetFieldValue<DateTimeOffset>(8),
            reader.GetInt32(10),
            reader.GetInt32(11),
            reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9));
    }

    public async Task<QuoteRequestDetailRecord?> GetForUserAsync(Guid requestId, Guid userId, CancellationToken cancellationToken)
    {
        const string sql = $"""
                            SELECT {RequestProjection},
                                   {TargetProjection},
                                   {ResponseProjection}
                            FROM app.quote_requests qr
                            LEFT JOIN app.quote_request_targets t
                                ON t.quote_request_id = qr.id
                            LEFT JOIN app.quote_request_responses r
                                ON r.target_id = t.id
                            WHERE qr.id = @request_id
                              AND qr.user_id = @user_id
                            ORDER BY t.created_at ASC;
                            """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("request_id", requestId);
        command.Parameters.AddWithValue("user_id", userId);

        return await ReadDetailAsync(command, cancellationToken);
    }

    public async Task<QuoteRequestArchiveRecord?> SetArchivedAsync(Guid requestId, Guid userId, bool archived, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.quote_requests
                           SET archived_at = CASE
                                                 WHEN @archived THEN COALESCE(archived_at, NOW())
                                                 ELSE NULL
                                             END,
                               updated_at = NOW()
                           WHERE id = @request_id
                             AND user_id = @user_id
                           RETURNING id,
                                     archived_at;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("request_id", requestId);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("archived", archived);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new QuoteRequestArchiveRecord(
            reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1));
    }

    public async Task<bool> DeleteForUserAsync(Guid requestId, Guid userId, CancellationToken cancellationToken)
    {
        const string sql = """
                           DELETE FROM app.quote_requests
                           WHERE id = @request_id
                             AND user_id = @user_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("request_id", requestId);
        command.Parameters.AddWithValue("user_id", userId);
        var rows = await command.ExecuteNonQueryAsync(cancellationToken);
        return rows > 0;
    }

    public async Task ApplyDeliveryUpdatesAsync(
        Guid quoteRequestId,
        IReadOnlyList<QuoteRequestTargetDeliveryUpdate> updates,
        CancellationToken cancellationToken)
    {
        if (updates.Count == 0)
        {
            return;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        const string updateTargetSql = """
                                       UPDATE app.quote_request_targets
                                       SET status = @status,
                                           sent_at = @sent_at,
                                           delivery_error = @delivery_error,
                                           updated_at = NOW()
                                       WHERE id = @target_id
                                         AND quote_request_id = @quote_request_id;
                                       """;

        foreach (var update in updates)
        {
            await using var command = new NpgsqlCommand(updateTargetSql, connection, transaction);
            command.Parameters.AddWithValue("status", update.Status);
            command.Parameters.AddWithValue("sent_at", (object?)update.SentAtUtc ?? DBNull.Value);
            command.Parameters.AddWithValue("delivery_error", (object?)update.DeliveryError ?? DBNull.Value);
            command.Parameters.AddWithValue("target_id", update.TargetId);
            command.Parameters.AddWithValue("quote_request_id", quoteRequestId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        const string syncRequestSql = """
                                      UPDATE app.quote_requests
                                      SET sent_at = CASE
                                                        WHEN EXISTS (
                                                            SELECT 1
                                                            FROM app.quote_request_targets t
                                                            WHERE t.quote_request_id = @quote_request_id
                                                              AND t.sent_at IS NOT NULL
                                                        )
                                                        THEN COALESCE(sent_at, NOW())
                                                        ELSE sent_at
                                                    END,
                                          status = CASE
                                                       WHEN NOT EXISTS (
                                                           SELECT 1
                                                           FROM app.quote_request_targets t
                                                           WHERE t.quote_request_id = @quote_request_id
                                                             AND t.status NOT IN (@responded_status, @delivery_failed_status)
                                                       )
                                                       THEN @completed_status
                                                       ELSE status
                                                   END,
                                          updated_at = NOW()
                                      WHERE id = @quote_request_id;
                                      """;

        await using (var syncCommand = new NpgsqlCommand(syncRequestSql, connection, transaction))
        {
            syncCommand.Parameters.AddWithValue("quote_request_id", quoteRequestId);
            syncCommand.Parameters.AddWithValue("responded_status", QuoteRequestTargetStatus.Responded);
            syncCommand.Parameters.AddWithValue("delivery_failed_status", QuoteRequestTargetStatus.DeliveryFailed);
            syncCommand.Parameters.AddWithValue("completed_status", QuoteRequestStatus.Completed);
            await syncCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<QuoteRequestPublicTargetRecord?> GetPublicTargetByTokenHashAsync(string tokenHash, CancellationToken cancellationToken)
    {
        const string sql = $"""
                            SELECT {RequestProjection},
                                   {TargetProjection},
                                   {ResponseProjection},
                                   rj.report_s3_key
                            FROM app.quote_request_targets t
                            INNER JOIN app.quote_requests qr
                                ON qr.id = t.quote_request_id
                            INNER JOIN app.review_jobs rj
                                ON rj.id = qr.review_job_id
                            LEFT JOIN app.quote_request_responses r
                                ON r.target_id = t.id
                            WHERE t.response_token_hash = @token_hash
                            LIMIT 1;
                            """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("token_hash", tokenHash);
        return await ReadPublicTargetAsync(command, cancellationToken);
    }

    public async Task MarkTargetOpenedAsync(Guid targetId, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.quote_request_targets
                           SET status = CASE
                                            WHEN status = @prepared_status OR status = @sent_status THEN @opened_status
                                            ELSE status
                                        END,
                               opened_at = COALESCE(opened_at, NOW()),
                               updated_at = NOW()
                           WHERE id = @target_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("prepared_status", QuoteRequestTargetStatus.Prepared);
        command.Parameters.AddWithValue("sent_status", QuoteRequestTargetStatus.Sent);
        command.Parameters.AddWithValue("opened_status", QuoteRequestTargetStatus.Opened);
        command.Parameters.AddWithValue("target_id", targetId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task UpdateDocumentAccessOtpAsync(
        Guid targetId,
        string otpHash,
        DateTimeOffset requestedAtUtc,
        DateTimeOffset expiresAtUtc,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.quote_request_targets
                           SET document_access_otp_hash = @otp_hash,
                               document_access_otp_requested_at = @requested_at,
                               document_access_otp_expires_at = @expires_at,
                               document_access_otp_send_count = document_access_otp_send_count + 1,
                               updated_at = NOW()
                           WHERE id = @target_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("otp_hash", otpHash);
        command.Parameters.AddWithValue("requested_at", requestedAtUtc);
        command.Parameters.AddWithValue("expires_at", expiresAtUtc);
        command.Parameters.AddWithValue("target_id", targetId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task MarkDocumentAccessVerifiedAsync(Guid targetId, DateTimeOffset verifiedAtUtc, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.quote_request_targets
                           SET document_access_otp_hash = NULL,
                               document_access_otp_expires_at = NULL,
                               document_access_verified_at = @verified_at,
                               updated_at = NOW()
                           WHERE id = @target_id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("verified_at", verifiedAtUtc);
        command.Parameters.AddWithValue("target_id", targetId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task CreateDocumentAccessSessionAsync(
        QuoteRequestDocumentAccessSessionCreateRecord session,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           INSERT INTO app.quote_request_document_access_sessions
                           (
                               id,
                               target_id,
                               access_token_hash,
                               created_at,
                               expires_at
                           )
                           VALUES
                           (
                               @id,
                               @target_id,
                               @access_token_hash,
                               @created_at,
                               @expires_at
                           );
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", session.Id);
        command.Parameters.AddWithValue("target_id", session.TargetId);
        command.Parameters.AddWithValue("access_token_hash", session.AccessTokenHash);
        command.Parameters.AddWithValue("created_at", session.CreatedAtUtc);
        command.Parameters.AddWithValue("expires_at", session.ExpiresAtUtc);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<QuoteRequestDocumentAccessSessionRecord?> GetActiveDocumentAccessSessionAsync(
        Guid targetId,
        string accessTokenHash,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  target_id,
                                  access_token_hash,
                                  created_at,
                                  expires_at,
                                  revoked_at
                           FROM app.quote_request_document_access_sessions
                           WHERE target_id = @target_id
                             AND access_token_hash = @access_token_hash
                             AND revoked_at IS NULL
                             AND expires_at > NOW()
                           ORDER BY created_at DESC
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("target_id", targetId);
        command.Parameters.AddWithValue("access_token_hash", accessTokenHash);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new QuoteRequestDocumentAccessSessionRecord(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetFieldValue<DateTimeOffset>(3),
            reader.GetFieldValue<DateTimeOffset>(4),
            reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5));
    }

    public async Task RecordDocumentDownloadAsync(
        QuoteRequestDocumentDownloadUpsertRecord record,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           INSERT INTO app.quote_request_document_downloads
                           (
                               id,
                               target_id,
                               document_key,
                               document_kind,
                               document_id,
                               file_name,
                               first_downloaded_at,
                               last_downloaded_at,
                               download_count
                           )
                           VALUES
                           (
                               @id,
                               @target_id,
                               @document_key,
                               @document_kind,
                               @document_id,
                               @file_name,
                               @downloaded_at,
                               @downloaded_at,
                               1
                           )
                           ON CONFLICT (target_id, document_key)
                           DO UPDATE
                           SET document_kind = EXCLUDED.document_kind,
                               document_id = EXCLUDED.document_id,
                               file_name = EXCLUDED.file_name,
                               last_downloaded_at = EXCLUDED.last_downloaded_at,
                               download_count = app.quote_request_document_downloads.download_count + 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", record.Id);
        command.Parameters.AddWithValue("target_id", record.TargetId);
        command.Parameters.AddWithValue("document_key", record.DocumentKey);
        command.Parameters.AddWithValue("document_kind", record.DocumentKind);
        command.Parameters.AddWithValue("document_id", (object?)record.DocumentId ?? DBNull.Value);
        command.Parameters.AddWithValue("file_name", record.FileName);
        command.Parameters.AddWithValue("downloaded_at", record.DownloadedAtUtc);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<QuoteRequestPublicTargetRecord?> SubmitResponseAsync(
        Guid targetId,
        QuoteRequestResponseCreateRecord response,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        const string insertSql = """
                                 INSERT INTO app.quote_request_responses
                                 (
                                     id,
                                     target_id,
                                     responder_name,
                                     responder_email,
                                     responder_phone,
                                     professional_fee_aud,
                                     includes_gst,
                                     disbursements_estimate_aud,
                                     turnaround_business_days,
                                     scope_notes,
                                     excluded_items_json,
                                     valid_until_utc,
                                     created_at,
                                     updated_at
                                 )
                                 VALUES
                                 (
                                     @id,
                                     @target_id,
                                     @responder_name,
                                     @responder_email,
                                     @responder_phone,
                                     @professional_fee_aud,
                                     @includes_gst,
                                     @disbursements_estimate_aud,
                                     @turnaround_business_days,
                                     @scope_notes,
                                     CAST(@excluded_items_json AS jsonb),
                                     @valid_until_utc,
                                     @created_at,
                                     @updated_at
                                 );
                                 """;

        await using (var insertCommand = new NpgsqlCommand(insertSql, connection, transaction))
        {
            insertCommand.Parameters.AddWithValue("id", response.Id);
            insertCommand.Parameters.AddWithValue("target_id", response.TargetId);
            insertCommand.Parameters.AddWithValue("responder_name", response.ResponderName);
            insertCommand.Parameters.AddWithValue("responder_email", response.ResponderEmail);
            insertCommand.Parameters.AddWithValue("responder_phone", (object?)response.ResponderPhone ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("professional_fee_aud", response.ProfessionalFeeAud);
            insertCommand.Parameters.AddWithValue("includes_gst", response.IncludesGst);
            insertCommand.Parameters.AddWithValue("disbursements_estimate_aud", (object?)response.DisbursementsEstimateAud ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("turnaround_business_days", (object?)response.TurnaroundBusinessDays ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("scope_notes", response.ScopeNotes);
            insertCommand.Parameters.AddWithValue("excluded_items_json", JsonSerializer.Serialize(response.ExcludedItems, JsonOptions));
            insertCommand.Parameters.AddWithValue("valid_until_utc", (object?)response.ValidUntilUtc ?? DBNull.Value);
            insertCommand.Parameters.AddWithValue("created_at", response.CreatedAtUtc);
            insertCommand.Parameters.AddWithValue("updated_at", response.CreatedAtUtc);
            await insertCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        const string updateTargetSql = """
                                       UPDATE app.quote_request_targets
                                       SET status = @responded_status,
                                           responded_at = COALESCE(responded_at, NOW()),
                                           opened_at = COALESCE(opened_at, NOW()),
                                           updated_at = NOW()
                                       WHERE id = @target_id;
                                       """;

        Guid quoteRequestId;
        await using (var targetCommand = new NpgsqlCommand(updateTargetSql, connection, transaction))
        {
            targetCommand.Parameters.AddWithValue("responded_status", QuoteRequestTargetStatus.Responded);
            targetCommand.Parameters.AddWithValue("target_id", targetId);
            await targetCommand.ExecuteNonQueryAsync(cancellationToken);

            await using var quoteRequestLookup = new NpgsqlCommand(
                "SELECT quote_request_id FROM app.quote_request_targets WHERE id = @target_id LIMIT 1;",
                connection,
                transaction);
            quoteRequestLookup.Parameters.AddWithValue("target_id", targetId);
            var quoteRequestIdValue = await quoteRequestLookup.ExecuteScalarAsync(cancellationToken)
                ?? throw new InvalidOperationException("Quote request target was not found during response submission.");
            quoteRequestId = (Guid)quoteRequestIdValue;
        }

        const string syncRequestSql = """
                                      UPDATE app.quote_requests
                                      SET status = CASE
                                                       WHEN NOT EXISTS (
                                                           SELECT 1
                                                           FROM app.quote_request_targets t
                                                           WHERE t.quote_request_id = @quote_request_id
                                                             AND t.status NOT IN (@responded_status, @delivery_failed_status)
                                                       )
                                                       THEN @completed_status
                                                       ELSE @open_status
                                                   END,
                                          updated_at = NOW()
                                      WHERE id = @quote_request_id;
                                      """;

        await using (var syncCommand = new NpgsqlCommand(syncRequestSql, connection, transaction))
        {
            syncCommand.Parameters.AddWithValue("quote_request_id", quoteRequestId);
            syncCommand.Parameters.AddWithValue("responded_status", QuoteRequestTargetStatus.Responded);
            syncCommand.Parameters.AddWithValue("delivery_failed_status", QuoteRequestTargetStatus.DeliveryFailed);
            syncCommand.Parameters.AddWithValue("completed_status", QuoteRequestStatus.Completed);
            syncCommand.Parameters.AddWithValue("open_status", QuoteRequestStatus.Open);
            await syncCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return await GetPublicTargetByTargetIdAsync(targetId, cancellationToken);
    }

    private async Task<QuoteRequestDetailRecord?> ReadDetailAsync(
        NpgsqlCommand command,
        CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        QuoteRequestRecord? request = null;
        var targets = new Dictionary<Guid, QuoteRequestTargetDetailRecord>();

        while (await reader.ReadAsync(cancellationToken))
        {
            request ??= MapRequest(reader, 0);
            if (reader.IsDBNull(15))
            {
                continue;
            }

            var target = MapTarget(reader, 15, responseOffset: 35);
            targets[target.Id] = target;
        }

        if (request is null)
        {
            return null;
        }

        await reader.CloseAsync();

        var reportS3Key = await GetReportS3KeyAsync(request.ReviewJobId, cancellationToken);
        var sharedDocuments = await ListSharedDocumentsAsync(request.ReviewJobId, cancellationToken);
        var totalDocumentCount = sharedDocuments.Count + (string.IsNullOrWhiteSpace(reportS3Key) ? 0 : 1);
        var enrichedTargets = await EnrichTargetsWithDocumentAccessAsync(targets.Values.ToArray(), totalDocumentCount, cancellationToken);
        return new QuoteRequestDetailRecord(request, reportS3Key, sharedDocuments, enrichedTargets);
    }

    private async Task<QuoteRequestPublicTargetRecord?> ReadPublicTargetAsync(
        NpgsqlCommand command,
        CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var request = MapRequest(reader, 0);
        var target = MapTarget(reader, 15, responseOffset: 35);
        var reportS3Key = reader.IsDBNull(49) ? null : reader.GetString(49);
        await reader.CloseAsync();
        var sharedDocuments = await ListSharedDocumentsAsync(request.ReviewJobId, cancellationToken);
        var totalDocumentCount = sharedDocuments.Count + (string.IsNullOrWhiteSpace(reportS3Key) ? 0 : 1);
        var documentAccess = await GetDocumentAccessAsync(target.Id, totalDocumentCount, cancellationToken);
        return new QuoteRequestPublicTargetRecord(
            request,
            target with
            {
                DocumentAccess = documentAccess
            },
            reportS3Key,
            sharedDocuments);
    }

    private async Task<QuoteRequestPublicTargetRecord?> GetPublicTargetByTargetIdAsync(Guid targetId, CancellationToken cancellationToken)
    {
        const string sql = $"""
                            SELECT {RequestProjection},
                                   {TargetProjection},
                                   {ResponseProjection},
                                   rj.report_s3_key
                            FROM app.quote_request_targets t
                            INNER JOIN app.quote_requests qr
                                ON qr.id = t.quote_request_id
                            INNER JOIN app.review_jobs rj
                                ON rj.id = qr.review_job_id
                            LEFT JOIN app.quote_request_responses r
                                ON r.target_id = t.id
                            WHERE t.id = @target_id
                            LIMIT 1;
                            """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("target_id", targetId);
        return await ReadPublicTargetAsync(command, cancellationToken);
    }

    private async Task<IReadOnlyList<QuoteRequestSharedDocumentRecord>> ListSharedDocumentsAsync(Guid reviewJobId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  job_id,
                                  s3_key_raw,
                                  filename,
                                  content_type,
                                  doc_type,
                                  uploaded_at
                           FROM app.job_documents
                           WHERE job_id = @job_id
                           ORDER BY uploaded_at ASC, filename ASC;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("job_id", reviewJobId);

        var rows = new List<QuoteRequestSharedDocumentRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new QuoteRequestSharedDocumentRecord(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetFieldValue<DateTimeOffset>(6)));
        }

        return rows;
    }

    private async Task<string?> GetReportS3KeyAsync(Guid reviewJobId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT report_s3_key
                           FROM app.review_jobs
                           WHERE id = @review_job_id
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("review_job_id", reviewJobId);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return value is string reportS3Key && !string.IsNullOrWhiteSpace(reportS3Key)
            ? reportS3Key
            : null;
    }

    private async Task<IReadOnlyList<QuoteRequestTargetDetailRecord>> EnrichTargetsWithDocumentAccessAsync(
        IReadOnlyList<QuoteRequestTargetDetailRecord> targets,
        int totalDocumentCount,
        CancellationToken cancellationToken)
    {
        if (targets.Count == 0)
        {
            return targets;
        }

        var enrichedTargets = new QuoteRequestTargetDetailRecord[targets.Count];
        for (var index = 0; index < targets.Count; index += 1)
        {
            var target = targets[index];
            var documentAccess = await GetDocumentAccessAsync(target.Id, totalDocumentCount, cancellationToken);
            enrichedTargets[index] = target with
            {
                DocumentAccess = documentAccess
            };
        }

        return enrichedTargets;
    }

    private async Task<QuoteRequestTargetDocumentAccessRecord> GetDocumentAccessAsync(
        Guid targetId,
        int totalDocumentCount,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT t.document_access_otp_hash,
                                  t.document_access_otp_requested_at,
                                  t.document_access_otp_expires_at,
                                  t.document_access_otp_send_count,
                                  t.document_access_verified_at,
                                  COALESCE(BOOL_OR(d.document_kind = 'report'), FALSE),
                                  COUNT(*) FILTER (WHERE d.document_kind = 'job-document')::integer,
                                  MAX(d.last_downloaded_at)
                           FROM app.quote_request_targets t
                           LEFT JOIN app.quote_request_document_downloads d
                               ON d.target_id = t.id
                           WHERE t.id = @target_id
                           GROUP BY t.document_access_otp_hash,
                                    t.document_access_otp_requested_at,
                                    t.document_access_otp_expires_at,
                                    t.document_access_otp_send_count,
                                    t.document_access_verified_at;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("target_id", targetId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return QuoteRequestTargetDocumentAccessRecord.Empty(totalDocumentCount);
        }

        return new QuoteRequestTargetDocumentAccessRecord(
            reader.IsDBNull(0) ? null : reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1),
            reader.IsDBNull(2) ? null : reader.GetFieldValue<DateTimeOffset>(2),
            reader.GetInt32(3),
            reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4),
            reader.GetBoolean(5),
            reader.GetInt32(6),
            totalDocumentCount,
            reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7));
    }

    private static QuoteRequestRecord MapRequest(NpgsqlDataReader reader, int offset)
    {
        return new QuoteRequestRecord(
            reader.GetGuid(offset + 0),
            reader.GetGuid(offset + 1),
            reader.GetGuid(offset + 2),
            reader.GetString(offset + 3),
            reader.GetString(offset + 4),
            reader.GetString(offset + 5),
            reader.IsDBNull(offset + 6) ? null : reader.GetString(offset + 6),
            reader.GetBoolean(offset + 7),
            reader.GetString(offset + 8),
            reader.GetString(offset + 9),
            reader.GetFieldValue<DateTimeOffset>(offset + 10),
            reader.GetFieldValue<DateTimeOffset>(offset + 11),
            reader.IsDBNull(offset + 12) ? null : reader.GetFieldValue<DateTimeOffset>(offset + 12),
            reader.GetFieldValue<DateTimeOffset>(offset + 13),
            reader.IsDBNull(offset + 14) ? null : reader.GetFieldValue<DateTimeOffset>(offset + 14));
    }

    private static QuoteRequestTargetDetailRecord MapTarget(NpgsqlDataReader reader, int offset, int responseOffset)
    {
        return new QuoteRequestTargetDetailRecord(
            reader.GetGuid(offset + 0),
            reader.GetGuid(offset + 1),
            reader.GetString(offset + 2),
            reader.GetString(offset + 3),
            reader.GetString(offset + 4),
            reader.GetString(offset + 5),
            reader.IsDBNull(offset + 6) ? null : reader.GetString(offset + 6),
            reader.IsDBNull(offset + 7) ? null : reader.GetString(offset + 7),
            reader.GetString(offset + 8),
            reader.IsDBNull(offset + 9) ? null : reader.GetString(offset + 9),
            reader.IsDBNull(offset + 10) ? null : reader.GetString(offset + 10),
            reader.GetString(offset + 11),
            reader.GetString(offset + 12),
            reader.GetFieldValue<DateTimeOffset>(offset + 14),
            reader.GetFieldValue<DateTimeOffset>(offset + 15),
            reader.IsDBNull(offset + 16) ? null : reader.GetFieldValue<DateTimeOffset>(offset + 16),
            reader.IsDBNull(offset + 17) ? null : reader.GetFieldValue<DateTimeOffset>(offset + 17),
            reader.IsDBNull(offset + 18) ? null : reader.GetFieldValue<DateTimeOffset>(offset + 18),
            reader.IsDBNull(offset + 19) ? null : reader.GetString(offset + 19),
            reader.IsDBNull(responseOffset + 0) ? null : MapResponse(reader, responseOffset),
            QuoteRequestTargetDocumentAccessRecord.Empty(0));
    }

    private static QuoteRequestResponseRecord MapResponse(NpgsqlDataReader reader, int offset)
    {
        return new QuoteRequestResponseRecord(
            reader.GetGuid(offset + 0),
            reader.GetGuid(offset + 1),
            reader.GetString(offset + 2),
            reader.GetString(offset + 3),
            reader.IsDBNull(offset + 4) ? null : reader.GetString(offset + 4),
            reader.GetDecimal(offset + 5),
            reader.GetBoolean(offset + 6),
            reader.IsDBNull(offset + 7) ? null : reader.GetDecimal(offset + 7),
            reader.IsDBNull(offset + 8) ? null : reader.GetInt32(offset + 8),
            reader.GetString(offset + 9),
            ParseStringArray(reader.IsDBNull(offset + 10) ? "[]" : reader.GetString(offset + 10)),
            reader.IsDBNull(offset + 11) ? null : reader.GetFieldValue<DateTimeOffset>(offset + 11),
            reader.GetFieldValue<DateTimeOffset>(offset + 12),
            reader.GetFieldValue<DateTimeOffset>(offset + 13));
    }

    private static IReadOnlyList<string> ParseStringArray(string json)
    {
        try
        {
            var parsed = JsonSerializer.Deserialize<string[]>(json, JsonOptions);
            return parsed ?? [];
        }
        catch
        {
            return [];
        }
    }
}
