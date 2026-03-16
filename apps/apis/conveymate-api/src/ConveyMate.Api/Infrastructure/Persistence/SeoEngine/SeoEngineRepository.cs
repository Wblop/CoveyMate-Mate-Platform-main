using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using ConveyMate.Api.Application.SeoEngine.Abstractions;

namespace ConveyMate.Api.Infrastructure.Persistence.SeoEngine;

public sealed class SeoEngineRepository(NpgsqlDataSource dataSource) : ISeoEngineRepository
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);
    private const string ActiveArticleSlugConstraintName = "ux_seo_engine_articles_slug_active";
    private const int MaxSlugSaveAttempts = 3;

    public async Task<SeoEngineOverviewRecord> GetOverviewAsync(CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT
                               COUNT(*) FILTER (WHERE status = 'draft')::INTEGER AS draft_count,
                               COUNT(*) FILTER (WHERE status = 'published')::INTEGER AS published_count,
                               (SELECT COUNT(*)::INTEGER FROM app.seo_engine_jobs WHERE status = 'running') AS running_job_count,
                               (SELECT COUNT(*)::INTEGER FROM app.seo_engine_jobs WHERE status = 'failed') AS failed_job_count
                           FROM app.seo_engine_articles
                           WHERE status <> 'deleted';
                           """;

        await using var command = dataSource.CreateCommand(sql);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);

        return new SeoEngineOverviewRecord(
            reader.GetInt32(0),
            reader.GetInt32(1),
            reader.GetInt32(2),
            reader.GetInt32(3));
    }

    public async Task<IReadOnlyList<SeoEngineJobRecord>> ListJobsAsync(int limit, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  job_type,
                                  status,
                                  requested_source,
                                  requested_by_email,
                                  requested_by_name,
                                  article_id,
                                  created_at,
                                  started_at,
                                  completed_at,
                                  error_message
                           FROM app.seo_engine_jobs
                           ORDER BY created_at DESC, id DESC
                           LIMIT @limit;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("limit", Math.Clamp(limit <= 0 ? 30 : limit, 1, 200));

        var jobs = new List<SeoEngineJobRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            jobs.Add(MapJob(reader));
        }

        return jobs;
    }

    public async Task<SeoEngineJobRecord?> GetJobAsync(Guid jobId, CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  job_type,
                                  status,
                                  requested_source,
                                  requested_by_email,
                                  requested_by_name,
                                  article_id,
                                  created_at,
                                  started_at,
                                  completed_at,
                                  error_message
                           FROM app.seo_engine_jobs
                           WHERE id = @id
                           LIMIT 1;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", jobId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? MapJob(reader)
            : null;
    }

    public async Task<IReadOnlyList<SeoEngineArticleListRecord>> ListArticlesAsync(
        string? status,
        int limit,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  status,
                                  title,
                                  slug,
                                  excerpt,
                                  meta_title,
                                  meta_description,
                                  tags_json::text,
                                  keywords_json::text,
                                  source_count,
                                  created_at,
                                  updated_at,
                                  published_at,
                                  duplicate_warnings_json::text
                           FROM app.seo_engine_articles
                           WHERE (@status IS NULL OR status = @status)
                             AND status <> 'deleted'
                           ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC
                           LIMIT @limit;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.Add("status", NpgsqlDbType.Text).Value = (object?)NormalizeStatus(status) ?? DBNull.Value;
        command.Parameters.AddWithValue("limit", Math.Clamp(limit <= 0 ? 100 : limit, 1, 200));

        var articles = new List<SeoEngineArticleListRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            articles.Add(new SeoEngineArticleListRecord(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                DeserializeStringArray(reader.GetString(7)),
                DeserializeStringArray(reader.GetString(8)),
                reader.GetInt32(9),
                reader.GetFieldValue<DateTimeOffset>(10),
                reader.GetFieldValue<DateTimeOffset>(11),
                reader.IsDBNull(12) ? null : reader.GetFieldValue<DateTimeOffset>(12),
                DeserializeWarnings(reader.GetString(13))));
        }

        return articles;
    }

    public async Task<SeoEngineArticleRecord?> GetArticleAsync(Guid articleId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await GetArticleAsync(connection, null, articleId, cancellationToken);
    }

    public async Task<SeoEngineJobRecord> CreateJobAsync(
        string jobType,
        string requestedSource,
        Guid? requestedByUserId,
        string? requestedByEmail,
        string? requestedByName,
        CancellationToken cancellationToken)
    {
        var jobId = Guid.NewGuid();
        return await EnsureJobAsync(
            jobId,
            jobType,
            requestedSource,
            requestedByUserId,
            requestedByEmail,
            requestedByName,
            cancellationToken);
    }

    public async Task<SeoEngineJobRecord> EnsureJobAsync(
        Guid jobId,
        string jobType,
        string requestedSource,
        Guid? requestedByUserId,
        string? requestedByEmail,
        string? requestedByName,
        CancellationToken cancellationToken)
    {
        const string insertSql = """
                                 INSERT INTO app.seo_engine_jobs
                                 (
                                     id,
                                     job_type,
                                     status,
                                     requested_source,
                                     requested_by_user_id,
                                     requested_by_email,
                                     requested_by_name
                                 )
                                 VALUES
                                 (
                                     @id,
                                     @job_type,
                                     'pending',
                                     @requested_source,
                                     @requested_by_user_id,
                                     @requested_by_email,
                                     @requested_by_name
                                 )
                                 ON CONFLICT (id) DO NOTHING;
                                 """;

        await using (var insertCommand = dataSource.CreateCommand(insertSql))
        {
            insertCommand.Parameters.AddWithValue("id", jobId);
            insertCommand.Parameters.AddWithValue("job_type", NormalizeJobType(jobType));
            insertCommand.Parameters.AddWithValue("requested_source", NormalizeRequestedSource(requestedSource));
            insertCommand.Parameters.Add("requested_by_user_id", NpgsqlDbType.Uuid).Value = (object?)requestedByUserId ?? DBNull.Value;
            insertCommand.Parameters.Add("requested_by_email", NpgsqlDbType.Text).Value = (object?)TrimOrNull(requestedByEmail) ?? DBNull.Value;
            insertCommand.Parameters.Add("requested_by_name", NpgsqlDbType.Text).Value = (object?)TrimOrNull(requestedByName) ?? DBNull.Value;
            await insertCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        const string selectSql = """
                                 SELECT id,
                                        job_type,
                                        status,
                                        requested_source,
                                        requested_by_email,
                                        requested_by_name,
                                        article_id,
                                        created_at,
                                        started_at,
                                        completed_at,
                                        error_message
                                 FROM app.seo_engine_jobs
                                 WHERE id = @id
                                 LIMIT 1;
                                 """;

        await using var selectCommand = dataSource.CreateCommand(selectSql);
        selectCommand.Parameters.AddWithValue("id", jobId);
        await using var reader = await selectCommand.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new InvalidOperationException("SEO Engine job could not be loaded after creation.");
        }

        return MapJob(reader);
    }

    public async Task UpdateJobStatusAsync(
        Guid jobId,
        string status,
        Guid? articleId,
        string? errorMessage,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.seo_engine_jobs
                           SET status = @status,
                               article_id = COALESCE(@article_id, article_id),
                               error_message = @error_message,
                               started_at = CASE
                                   WHEN @status = 'running' THEN COALESCE(started_at, NOW())
                                   ELSE started_at
                               END,
                               completed_at = CASE
                                   WHEN @status IN ('completed', 'failed') THEN NOW()
                                   ELSE NULL
                               END,
                               updated_at = NOW()
                           WHERE id = @id;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", jobId);
        command.Parameters.AddWithValue("status", NormalizeJobStatus(status));
        command.Parameters.Add("article_id", NpgsqlDbType.Uuid).Value = (object?)articleId ?? DBNull.Value;
        command.Parameters.Add("error_message", NpgsqlDbType.Text).Value = (object?)TrimOrNull(errorMessage) ?? DBNull.Value;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> DeleteTerminalJobAsync(Guid jobId, CancellationToken cancellationToken)
    {
        const string sql = """
                           DELETE FROM app.seo_engine_jobs
                           WHERE id = @id
                             AND status IN ('completed', 'failed');
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", jobId);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<int> ClearTerminalJobsAsync(CancellationToken cancellationToken)
    {
        const string sql = """
                           DELETE FROM app.seo_engine_jobs
                           WHERE status IN ('completed', 'failed');
                           """;

        await using var command = dataSource.CreateCommand(sql);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<SeoEngineArticleRecord> SaveArticleAsync(SeoEngineArticleSaveRecord record, CancellationToken cancellationToken)
    {
        PostgresException? lastSlugConflict = null;

        for (var attempt = 0; attempt < MaxSlugSaveAttempts; attempt++)
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

            try
            {
                const string upsertSql = """
                                         INSERT INTO app.seo_engine_articles AS articles
                                         (
                                             id,
                                             status,
                                             title,
                                             slug,
                                             excerpt,
                                             body_markdown,
                                             body_html,
                                             body_plain_text,
                                             body_fingerprint_sha256,
                                             meta_title,
                                             meta_description,
                                             tags_json,
                                             keywords_json,
                                             duplicate_warnings_json,
                                             source_count,
                                             last_generated_at,
                                             created_by_user_id,
                                             updated_by_user_id
                                         )
                                         VALUES
                                         (
                                             @id,
                                             @status,
                                             @title,
                                             @slug,
                                             @excerpt,
                                             @body_markdown,
                                             @body_html,
                                             @body_plain_text,
                                             @body_fingerprint_sha256,
                                             @meta_title,
                                             @meta_description,
                                             CAST(@tags_json AS jsonb),
                                             CAST(@keywords_json AS jsonb),
                                             CAST(@duplicate_warnings_json AS jsonb),
                                             @source_count,
                                             @last_generated_at,
                                             @created_by_user_id,
                                             @updated_by_user_id
                                         )
                                         ON CONFLICT (id)
                                         DO UPDATE
                                         SET status = EXCLUDED.status,
                                             title = EXCLUDED.title,
                                             slug = EXCLUDED.slug,
                                             excerpt = EXCLUDED.excerpt,
                                             body_markdown = EXCLUDED.body_markdown,
                                             body_html = EXCLUDED.body_html,
                                             body_plain_text = EXCLUDED.body_plain_text,
                                             body_fingerprint_sha256 = EXCLUDED.body_fingerprint_sha256,
                                             meta_title = EXCLUDED.meta_title,
                                             meta_description = EXCLUDED.meta_description,
                                             tags_json = EXCLUDED.tags_json,
                                             keywords_json = EXCLUDED.keywords_json,
                                             duplicate_warnings_json = EXCLUDED.duplicate_warnings_json,
                                             source_count = EXCLUDED.source_count,
                                             last_generated_at = EXCLUDED.last_generated_at,
                                             deleted_at = CASE WHEN EXCLUDED.status = 'deleted' THEN COALESCE(articles.deleted_at, NOW()) ELSE NULL END,
                                             updated_by_user_id = COALESCE(EXCLUDED.updated_by_user_id, articles.updated_by_user_id),
                                             created_by_user_id = COALESCE(articles.created_by_user_id, EXCLUDED.created_by_user_id);
                                         """;

                var normalizedStatus = NormalizeArticleStatus(record.Status);
                var resolvedSlug = NormalizeSlug(record.Slug);
                if (!string.Equals(normalizedStatus, "deleted", StringComparison.Ordinal))
                {
                    resolvedSlug = await ResolveAvailableSlugAsync(connection, transaction, record.Id, resolvedSlug, cancellationToken);
                }

                var duplicateWarnings = string.Equals(normalizedStatus, "deleted", StringComparison.Ordinal)
                    ? record.DuplicateWarnings
                    : await FindDuplicateWarningsAsync(
                        connection,
                        transaction,
                        record.Id,
                        resolvedSlug,
                        record.Title,
                        record.BodyPlainText,
                        record.BodyFingerprintSha256,
                        record.Sources.Select(source => source.SourceUrl).ToArray(),
                        cancellationToken);

                await using (var upsertCommand = new NpgsqlCommand(upsertSql, connection, transaction))
                {
                    upsertCommand.Parameters.AddWithValue("id", record.Id);
                    upsertCommand.Parameters.AddWithValue("status", normalizedStatus);
                    upsertCommand.Parameters.AddWithValue("title", record.Title.Trim());
                    upsertCommand.Parameters.AddWithValue("slug", resolvedSlug);
                    upsertCommand.Parameters.AddWithValue("excerpt", record.Excerpt);
                    upsertCommand.Parameters.AddWithValue("body_markdown", record.BodyMarkdown);
                    upsertCommand.Parameters.AddWithValue("body_html", record.BodyHtml);
                    upsertCommand.Parameters.AddWithValue("body_plain_text", record.BodyPlainText);
                    upsertCommand.Parameters.AddWithValue("body_fingerprint_sha256", record.BodyFingerprintSha256);
                    upsertCommand.Parameters.AddWithValue("meta_title", record.MetaTitle);
                    upsertCommand.Parameters.AddWithValue("meta_description", record.MetaDescription);
                    upsertCommand.Parameters.AddWithValue("tags_json", JsonSerializer.Serialize(record.Tags, SerializerOptions));
                    upsertCommand.Parameters.AddWithValue("keywords_json", JsonSerializer.Serialize(record.Keywords, SerializerOptions));
                    upsertCommand.Parameters.AddWithValue("duplicate_warnings_json", JsonSerializer.Serialize(duplicateWarnings, SerializerOptions));
                    upsertCommand.Parameters.AddWithValue("source_count", record.SourceCount);
                    upsertCommand.Parameters.Add("last_generated_at", NpgsqlDbType.TimestampTz).Value = (object?)record.LastGeneratedAt ?? DBNull.Value;
                    upsertCommand.Parameters.Add("created_by_user_id", NpgsqlDbType.Uuid).Value = (object?)record.CreatedByUserId ?? DBNull.Value;
                    upsertCommand.Parameters.Add("updated_by_user_id", NpgsqlDbType.Uuid).Value = (object?)record.UpdatedByUserId ?? DBNull.Value;
                    await upsertCommand.ExecuteNonQueryAsync(cancellationToken);
                }

                await ReplaceSectionsAsync(connection, transaction, record.Id, record.Sections, cancellationToken);
                await ReplaceSourcesAsync(connection, transaction, record.Id, record.Sources, cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                return await GetArticleAsync(connection, null, record.Id, cancellationToken)
                    ?? throw new InvalidOperationException("SEO Engine article could not be loaded after save.");
            }
            catch (PostgresException error) when (IsActiveArticleSlugConflict(error) && attempt < MaxSlugSaveAttempts - 1)
            {
                lastSlugConflict = error;
                await transaction.RollbackAsync(cancellationToken);
            }
        }

        if (lastSlugConflict is not null)
        {
            throw lastSlugConflict;
        }

        throw new InvalidOperationException("SEO Engine article could not be saved.");
    }

    public async Task<SeoEngineArticleRecord?> PublishArticleAsync(Guid articleId, Guid publishedByUserId, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.seo_engine_articles
                           SET status = 'published',
                               published_at = COALESCE(published_at, NOW()),
                               deleted_at = NULL,
                               published_by_user_id = @published_by_user_id,
                               updated_by_user_id = @published_by_user_id,
                               updated_at = NOW()
                           WHERE id = @id
                             AND status <> 'deleted';
                           """;

        await using (var command = dataSource.CreateCommand(sql))
        {
            command.Parameters.AddWithValue("id", articleId);
            command.Parameters.AddWithValue("published_by_user_id", publishedByUserId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        return await GetArticleAsync(articleId, cancellationToken);
    }

    public async Task<bool> DeleteArticleAsync(Guid articleId, Guid deletedByUserId, CancellationToken cancellationToken)
    {
        const string sql = """
                           UPDATE app.seo_engine_articles
                           SET status = 'deleted',
                               deleted_at = NOW(),
                               updated_by_user_id = @deleted_by_user_id,
                               updated_at = NOW()
                           WHERE id = @id
                             AND status <> 'deleted';
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.AddWithValue("id", articleId);
        command.Parameters.AddWithValue("deleted_by_user_id", deletedByUserId);
        var changed = await command.ExecuteNonQueryAsync(cancellationToken);
        return changed > 0;
    }

    public async Task<IReadOnlyList<SeoEngineDuplicateWarningRecord>> FindDuplicateWarningsAsync(
        Guid? excludeArticleId,
        string slug,
        string title,
        string bodyPlainText,
        string bodyFingerprintSha256,
        IReadOnlyList<string> sourceUrls,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await FindDuplicateWarningsAsync(
            connection,
            null,
            excludeArticleId,
            slug,
            title,
            bodyPlainText,
            bodyFingerprintSha256,
            sourceUrls,
            cancellationToken);
    }

    private static async Task<IReadOnlyList<SeoEngineDuplicateWarningRecord>> FindDuplicateWarningsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid? excludeArticleId,
        string slug,
        string title,
        string bodyPlainText,
        string bodyFingerprintSha256,
        IReadOnlyList<string> sourceUrls,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT articles.id,
                                  articles.title,
                                  articles.slug,
                                  LOWER(articles.slug) = LOWER(@slug) AS slug_match,
                                  articles.body_fingerprint_sha256 = @body_fingerprint_sha256 AS fingerprint_match,
                                  EXISTS (
                                      SELECT 1
                                      FROM app.seo_engine_article_sources article_sources
                                      WHERE article_sources.article_id = articles.id
                                        AND LOWER(article_sources.source_url) = ANY(@source_urls)
                                  ) AS source_overlap,
                                  similarity(LOWER(articles.title), LOWER(@title)) AS title_similarity,
                                  similarity(LOWER(articles.body_plain_text), LOWER(@body_plain_text)) AS body_similarity
                           FROM app.seo_engine_articles articles
                           WHERE articles.status <> 'deleted'
                             AND (@exclude_article_id IS NULL OR articles.id <> @exclude_article_id)
                             AND (
                                 LOWER(articles.slug) = LOWER(@slug)
                                 OR articles.body_fingerprint_sha256 = @body_fingerprint_sha256
                                 OR similarity(LOWER(articles.title), LOWER(@title)) >= 0.75
                                 OR similarity(LOWER(articles.body_plain_text), LOWER(@body_plain_text)) >= 0.70
                                 OR EXISTS (
                                     SELECT 1
                                     FROM app.seo_engine_article_sources article_sources
                                     WHERE article_sources.article_id = articles.id
                                       AND LOWER(article_sources.source_url) = ANY(@source_urls)
                                 )
                             )
                           ORDER BY GREATEST(
                               similarity(LOWER(articles.title), LOWER(@title)),
                               similarity(LOWER(articles.body_plain_text), LOWER(@body_plain_text))
                           ) DESC,
                           articles.updated_at DESC
                           LIMIT 12;
                           """;

        var normalizedSourceUrls = sourceUrls
            .Select(url => url.Trim().ToLowerInvariant())
            .Where(url => !string.IsNullOrWhiteSpace(url))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.Add("exclude_article_id", NpgsqlDbType.Uuid).Value = (object?)excludeArticleId ?? DBNull.Value;
        command.Parameters.AddWithValue("slug", slug.Trim());
        command.Parameters.AddWithValue("title", title.Trim());
        command.Parameters.AddWithValue("body_plain_text", bodyPlainText);
        command.Parameters.AddWithValue("body_fingerprint_sha256", bodyFingerprintSha256);
        command.Parameters.Add("source_urls", NpgsqlDbType.Array | NpgsqlDbType.Text).Value = normalizedSourceUrls;

        var warnings = new List<SeoEngineDuplicateWarningRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var articleId = reader.GetGuid(0);
            var articleTitle = reader.GetString(1);
            var articleSlug = reader.GetString(2);
            var slugMatch = reader.GetBoolean(3);
            var fingerprintMatch = reader.GetBoolean(4);
            var sourceOverlap = reader.GetBoolean(5);
            var titleSimilarity = ReadSimilarityScore(reader, 6);
            var bodySimilarity = ReadSimilarityScore(reader, 7);

            if (slugMatch)
            {
                warnings.Add(new SeoEngineDuplicateWarningRecord(
                    "block",
                    "slug",
                    $"Slug matches existing article '{articleTitle}'.",
                    articleId,
                    articleTitle,
                    articleSlug,
                    1m));
            }

            if (fingerprintMatch)
            {
                warnings.Add(new SeoEngineDuplicateWarningRecord(
                    "block",
                    "body",
                    $"Body content matches existing article '{articleTitle}'.",
                    articleId,
                    articleTitle,
                    articleSlug,
                    1m));
            }

            if (sourceOverlap)
            {
                warnings.Add(new SeoEngineDuplicateWarningRecord(
                    "warn",
                    "source",
                    $"Draft shares source coverage with '{articleTitle}'.",
                    articleId,
                    articleTitle,
                    articleSlug,
                    0.60m));
            }

            if (titleSimilarity >= 0.90m || bodySimilarity >= 0.90m)
            {
                warnings.Add(new SeoEngineDuplicateWarningRecord(
                    "block",
                    titleSimilarity >= bodySimilarity ? "title" : "body",
                    $"Draft is highly similar to existing article '{articleTitle}'.",
                    articleId,
                    articleTitle,
                    articleSlug,
                    Math.Max(titleSimilarity, bodySimilarity)));
            }
            else if (titleSimilarity >= 0.75m || bodySimilarity >= 0.70m)
            {
                warnings.Add(new SeoEngineDuplicateWarningRecord(
                    "warn",
                    titleSimilarity >= bodySimilarity ? "title" : "body",
                    $"Draft appears similar to existing article '{articleTitle}'.",
                    articleId,
                    articleTitle,
                    articleSlug,
                    Math.Max(titleSimilarity, bodySimilarity)));
            }
        }

        return warnings
            .GroupBy(warning => new
            {
                warning.MatchType,
                warning.ExistingArticleId,
                warning.ExistingArticleSlug
            })
            .Select(group => group
                .OrderByDescending(warning => string.Equals(warning.Severity, "block", StringComparison.OrdinalIgnoreCase))
                .ThenByDescending(warning => warning.SimilarityScore)
                .First())
            .ToArray();
    }

    private static async Task<string> ResolveAvailableSlugAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid articleId,
        string desiredSlug,
        CancellationToken cancellationToken)
    {
        desiredSlug = NormalizeSlug(desiredSlug);
        await AcquireSlugReservationAsync(connection, transaction, desiredSlug, cancellationToken);

        const string sql = """
                           SELECT LOWER(slug)
                           FROM app.seo_engine_articles
                           WHERE status <> 'deleted'
                             AND id <> @article_id
                             AND LOWER(slug) LIKE @slug_prefix;
                           """;

        var usedSlugs = new HashSet<string>(StringComparer.Ordinal);
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("article_id", articleId);
        command.Parameters.AddWithValue("slug_prefix", $"{desiredSlug}%");

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var existingSlug = reader.GetString(0);
            if (string.Equals(existingSlug, desiredSlug, StringComparison.Ordinal) || IsSlugVariant(desiredSlug, existingSlug))
            {
                usedSlugs.Add(existingSlug);
            }
        }

        if (!usedSlugs.Contains(desiredSlug))
        {
            return desiredSlug;
        }

        var suffix = 2;
        while (usedSlugs.Contains($"{desiredSlug}-{suffix}"))
        {
            suffix++;
        }

        return $"{desiredSlug}-{suffix}";
    }

    private static async Task AcquireSlugReservationAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string slug,
        CancellationToken cancellationToken)
    {
        const string sql = "SELECT pg_advisory_xact_lock(hashtextextended(@lock_key, 0));";
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("lock_key", $"seo-engine-article-slug:{slug}");
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static bool IsActiveArticleSlugConflict(PostgresException error)
    {
        return string.Equals(error.SqlState, PostgresErrorCodes.UniqueViolation, StringComparison.Ordinal)
            && string.Equals(error.ConstraintName, ActiveArticleSlugConstraintName, StringComparison.Ordinal);
    }

    private static string NormalizeSlug(string value)
    {
        var normalized = value.Trim().ToLowerInvariant();
        return string.IsNullOrWhiteSpace(normalized) ? "insight" : normalized;
    }

    private static bool IsSlugVariant(string baseSlug, string candidateSlug)
    {
        if (!candidateSlug.StartsWith(baseSlug, StringComparison.Ordinal) || candidateSlug.Length <= baseSlug.Length + 1)
        {
            return false;
        }

        if (candidateSlug[baseSlug.Length] != '-')
        {
            return false;
        }

        for (var index = baseSlug.Length + 1; index < candidateSlug.Length; index++)
        {
            if (!char.IsDigit(candidateSlug[index]))
            {
                return false;
            }
        }

        return true;
    }

    public async Task<IReadOnlyList<PublishedInsightArticleRecord>> ListPublishedArticlesAsync(CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  title,
                                  slug,
                                  excerpt,
                                  body_html,
                                  meta_title,
                                  meta_description,
                                  tags_json::text,
                                  keywords_json::text,
                                  published_at,
                                  updated_at
                           FROM app.seo_engine_articles
                           WHERE status = 'published'
                           ORDER BY published_at DESC, updated_at DESC, id DESC;
                           """;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(sql, connection);
        var rows = new List<PublishedInsightArticleRow>();
        {
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(new PublishedInsightArticleRow(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    reader.GetString(6),
                    DeserializeStringArray(reader.GetString(7)),
                    DeserializeStringArray(reader.GetString(8)),
                    reader.GetFieldValue<DateTimeOffset>(9),
                    reader.GetFieldValue<DateTimeOffset>(10)));
            }
        }

        var records = new List<PublishedInsightArticleRecord>(rows.Count);
        foreach (var row in rows)
        {
            records.Add(new PublishedInsightArticleRecord(
                row.Id,
                row.Title,
                row.Slug,
                row.Excerpt,
                row.BodyHtml,
                row.MetaTitle,
                row.MetaDescription,
                row.Tags,
                row.Keywords,
                row.PublishedAt,
                row.UpdatedAt,
                await GetSectionsAsync(connection, null, row.Id, cancellationToken),
                await GetSourcesAsync(connection, null, row.Id, cancellationToken)));
        }

        return records;
    }

    private sealed record PublishedInsightArticleRow(
        Guid Id,
        string Title,
        string Slug,
        string Excerpt,
        string BodyHtml,
        string MetaTitle,
        string MetaDescription,
        string[] Tags,
        string[] Keywords,
        DateTimeOffset PublishedAt,
        DateTimeOffset UpdatedAt);

    private async Task<SeoEngineArticleRecord?> GetArticleAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid articleId,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT id,
                                  status,
                                  title,
                                  slug,
                                  excerpt,
                                  body_markdown,
                                  body_html,
                                  body_plain_text,
                                  meta_title,
                                  meta_description,
                                  tags_json::text,
                                  keywords_json::text,
                                  source_count,
                                  created_at,
                                  updated_at,
                                  last_generated_at,
                                  published_at,
                                  duplicate_warnings_json::text
                           FROM app.seo_engine_articles
                           WHERE id = @id
                           LIMIT 1;
                           """;

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("id", articleId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var record = new SeoEngineArticleRecord(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetString(7),
            reader.GetString(8),
            reader.GetString(9),
            DeserializeStringArray(reader.GetString(10)),
            DeserializeStringArray(reader.GetString(11)),
            reader.GetInt32(12),
            reader.GetFieldValue<DateTimeOffset>(13),
            reader.GetFieldValue<DateTimeOffset>(14),
            reader.IsDBNull(15) ? null : reader.GetFieldValue<DateTimeOffset>(15),
            reader.IsDBNull(16) ? null : reader.GetFieldValue<DateTimeOffset>(16),
            DeserializeWarnings(reader.GetString(17)),
            Array.Empty<SeoEngineArticleSectionRecord>(),
            Array.Empty<SeoEngineArticleSourceRecord>());

        await reader.DisposeAsync();

        return record with
        {
            Sections = await GetSectionsAsync(connection, transaction, articleId, cancellationToken),
            Sources = await GetSourcesAsync(connection, transaction, articleId, cancellationToken)
        };
    }

    private static SeoEngineJobRecord MapJob(NpgsqlDataReader reader)
    {
        return new SeoEngineJobRecord(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetGuid(6),
            reader.GetFieldValue<DateTimeOffset>(7),
            reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
            reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8),
            reader.IsDBNull(10) ? null : reader.GetString(10));
    }

    private static async Task ReplaceSectionsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid articleId,
        IReadOnlyList<SeoEngineArticleSectionRecord> sections,
        CancellationToken cancellationToken)
    {
        const string deleteSql = "DELETE FROM app.seo_engine_article_sections WHERE article_id = @article_id;";
        await using (var deleteCommand = new NpgsqlCommand(deleteSql, connection, transaction))
        {
            deleteCommand.Parameters.AddWithValue("article_id", articleId);
            await deleteCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        const string insertSql = """
                                 INSERT INTO app.seo_engine_article_sections
                                 (
                                     article_id,
                                     position,
                                     section_id,
                                     heading,
                                     paragraphs_json,
                                     bullets_json
                                 )
                                 VALUES
                                 (
                                     @article_id,
                                     @position,
                                     @section_id,
                                     @heading,
                                     CAST(@paragraphs_json AS jsonb),
                                     CAST(@bullets_json AS jsonb)
                                 );
                                 """;

        foreach (var section in sections.OrderBy(section => section.Position))
        {
            await using var insertCommand = new NpgsqlCommand(insertSql, connection, transaction);
            insertCommand.Parameters.AddWithValue("article_id", articleId);
            insertCommand.Parameters.AddWithValue("position", section.Position);
            insertCommand.Parameters.AddWithValue("section_id", section.SectionId);
            insertCommand.Parameters.AddWithValue("heading", section.Heading);
            insertCommand.Parameters.AddWithValue("paragraphs_json", JsonSerializer.Serialize(section.Paragraphs, SerializerOptions));
            insertCommand.Parameters.AddWithValue("bullets_json", JsonSerializer.Serialize(section.Bullets, SerializerOptions));
            await insertCommand.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task ReplaceSourcesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid articleId,
        IReadOnlyList<SeoEngineArticleSourceRecord> sources,
        CancellationToken cancellationToken)
    {
        const string deleteSql = "DELETE FROM app.seo_engine_article_sources WHERE article_id = @article_id;";
        await using (var deleteCommand = new NpgsqlCommand(deleteSql, connection, transaction))
        {
            deleteCommand.Parameters.AddWithValue("article_id", articleId);
            await deleteCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        const string insertSql = """
                                 INSERT INTO app.seo_engine_article_sources
                                 (
                                     article_id,
                                     position,
                                     source_name,
                                     publisher,
                                     headline,
                                     source_url,
                                     published_at,
                                     summary
                                 )
                                 VALUES
                                 (
                                     @article_id,
                                     @position,
                                     @source_name,
                                     @publisher,
                                     @headline,
                                     @source_url,
                                     @published_at,
                                     @summary
                                 );
                                 """;

        foreach (var source in sources.OrderBy(source => source.Position))
        {
            await using var insertCommand = new NpgsqlCommand(insertSql, connection, transaction);
            insertCommand.Parameters.AddWithValue("article_id", articleId);
            insertCommand.Parameters.AddWithValue("position", source.Position);
            insertCommand.Parameters.AddWithValue("source_name", source.SourceName);
            insertCommand.Parameters.AddWithValue("publisher", source.Publisher);
            insertCommand.Parameters.AddWithValue("headline", source.Headline);
            insertCommand.Parameters.AddWithValue("source_url", source.SourceUrl);
            insertCommand.Parameters.Add("published_at", NpgsqlDbType.TimestampTz).Value = (object?)source.PublishedAt ?? DBNull.Value;
            insertCommand.Parameters.AddWithValue("summary", source.Summary);
            await insertCommand.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task<IReadOnlyList<SeoEngineArticleSectionRecord>> GetSectionsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid articleId,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT section_id,
                                  heading,
                                  paragraphs_json::text,
                                  bullets_json::text,
                                  position
                           FROM app.seo_engine_article_sections
                           WHERE article_id = @article_id
                           ORDER BY position ASC, id ASC;
                           """;

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("article_id", articleId);
        var rows = new List<SeoEngineArticleSectionRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new SeoEngineArticleSectionRecord(
                reader.GetString(0),
                reader.GetString(1),
                DeserializeStringArray(reader.GetString(2)),
                DeserializeStringArray(reader.GetString(3)),
                reader.GetInt32(4)));
        }

        return rows;
    }

    private static async Task<IReadOnlyList<SeoEngineArticleSourceRecord>> GetSourcesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid articleId,
        CancellationToken cancellationToken)
    {
        const string sql = """
                           SELECT source_name,
                                  publisher,
                                  headline,
                                  source_url,
                                  published_at,
                                  summary,
                                  position
                           FROM app.seo_engine_article_sources
                           WHERE article_id = @article_id
                           ORDER BY position ASC, id ASC;
                           """;

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("article_id", articleId);
        var rows = new List<SeoEngineArticleSourceRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new SeoEngineArticleSourceRecord(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4),
                reader.GetString(5),
                reader.GetInt32(6)));
        }

        return rows;
    }

    private static IReadOnlyList<SeoEngineDuplicateWarningRecord> DeserializeWarnings(string? json)
    {
        return JsonSerializer.Deserialize<IReadOnlyList<SeoEngineDuplicateWarningRecord>>(json ?? "[]", SerializerOptions)
               ?? Array.Empty<SeoEngineDuplicateWarningRecord>();
    }

    private static string[] DeserializeStringArray(string? json)
    {
        return JsonSerializer.Deserialize<string[]>(json ?? "[]", SerializerOptions)
               ?? Array.Empty<string>();
    }

    private static decimal ReadSimilarityScore(NpgsqlDataReader reader, int ordinal)
    {
        if (reader.IsDBNull(ordinal))
        {
            return 0m;
        }

        return reader.GetValue(ordinal) switch
        {
            decimal value => value,
            float value => (decimal)value,
            double value => (decimal)value,
            _ => Convert.ToDecimal(reader.GetValue(ordinal))
        };
    }

    private static string NormalizeStatus(string? status)
    {
        var normalized = TrimOrNull(status)?.ToLowerInvariant();
        return normalized switch
        {
            null or "" => null!,
            "draft" or "published" => normalized,
            _ => throw new InvalidOperationException("SEO Engine article status filter is invalid.")
        };
    }

    private static string NormalizeArticleStatus(string status)
    {
        var normalized = TrimOrNull(status)?.ToLowerInvariant();
        return normalized switch
        {
            "draft" or "published" or "deleted" => normalized,
            _ => throw new InvalidOperationException("SEO Engine article status is invalid.")
        };
    }

    private static string NormalizeJobType(string jobType)
    {
        var normalized = TrimOrNull(jobType)?.ToLowerInvariant();
        return normalized switch
        {
            "generate-article" or "refresh-sitemap" => normalized,
            _ => throw new InvalidOperationException("SEO Engine job type is invalid.")
        };
    }

    private static string NormalizeRequestedSource(string requestedSource)
    {
        var normalized = TrimOrNull(requestedSource)?.ToLowerInvariant();
        return normalized switch
        {
            "admin" or "scheduler" or "system" => normalized,
            _ => throw new InvalidOperationException("SEO Engine requested source is invalid.")
        };
    }

    private static string NormalizeJobStatus(string status)
    {
        var normalized = TrimOrNull(status)?.ToLowerInvariant();
        return normalized switch
        {
            "pending" or "running" or "completed" or "failed" => normalized,
            _ => throw new InvalidOperationException("SEO Engine job status is invalid.")
        };
    }

    private static string? TrimOrNull(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }
}
