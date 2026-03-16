using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using ConveyMate.Api.Application.Conveyancers.Abstractions;

namespace ConveyMate.Api.Infrastructure.Persistence.Conveyancers;

/// <summary>
/// PostgreSQL read adapter for the active conveyancer directory.
/// </summary>
public sealed class ConveyancerDirectoryRepository(
    NpgsqlDataSource dataSource) : IConveyancerDirectoryRepository
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);
    private const string Projection = """
                                      id,
                                      jurisdiction,
                                      regulator_type,
                                      name,
                                      contact_name,
                                      organization_name,
                                      address,
                                      phone,
                                      email,
                                      website,
                                      areas_of_practice::text AS areas_of_practice_json,
                                      source_url,
                                      source_identifier,
                                      is_active,
                                      quote_requests_enabled,
                                      quote_requests_disabled_utc,
                                      last_seen_utc
                                      """;

    public async Task<IReadOnlyList<ConveyancerDirectoryRecord>> ListActiveByJurisdictionAsync(
        string jurisdiction,
        CancellationToken cancellationToken)
    {
        var sql = $"""
                           SELECT {Projection}
                           FROM app.conveyancers
                           WHERE jurisdiction = @jurisdiction
                             AND is_active = TRUE
                           ORDER BY COALESCE(NULLIF(organization_name, ''), name) ASC,
                                    COALESCE(NULLIF(contact_name, ''), name) ASC,
                                    source_identifier ASC;
                           """;

        await using var command = dataSource.CreateCommand(sql);
        command.Parameters.Add(new NpgsqlParameter("jurisdiction", NpgsqlDbType.Text)
        {
            Value = jurisdiction
        });

        return await ReadRowsAsync(command, cancellationToken);
    }

    public async Task<ConveyancerDirectoryAdminListRecord> ListForAdminAsync(
        int page,
        int pageSize,
        string? search,
        string? jurisdiction,
        CancellationToken cancellationToken)
    {
        var normalizedPage = Math.Max(1, page);
        var normalizedPageSize = Math.Clamp(pageSize <= 0 ? 25 : pageSize, 1, 10);
        var offset = (normalizedPage - 1) * normalizedPageSize;
        var searchPattern = BuildSearchPattern(search);
        var normalizedJurisdiction = NormalizeJurisdiction(jurisdiction);

        const string countSql = """
                                SELECT COUNT(*)
                                FROM app.conveyancers
                                WHERE (@jurisdiction IS NULL OR jurisdiction = @jurisdiction)
                                  AND (
                                        @search_pattern IS NULL
                                        OR COALESCE(NULLIF(organization_name, ''), name) ILIKE @search_pattern
                                        OR COALESCE(contact_name, '') ILIKE @search_pattern
                                        OR COALESCE(address, '') ILIKE @search_pattern
                                        OR COALESCE(phone, '') ILIKE @search_pattern
                                        OR COALESCE(email, '') ILIKE @search_pattern
                                        OR COALESCE(website, '') ILIKE @search_pattern
                                        OR COALESCE(source_identifier, '') ILIKE @search_pattern
                                      );
                                """;

        int totalCount;
        await using (var countCommand = dataSource.CreateCommand(countSql))
        {
            AddNullableTextParameter(countCommand, "jurisdiction", normalizedJurisdiction);
            AddNullableTextParameter(countCommand, "search_pattern", searchPattern);
            var scalar = await countCommand.ExecuteScalarAsync(cancellationToken);
            totalCount = scalar is null || scalar is DBNull ? 0 : Convert.ToInt32(scalar);
        }

        var sql = $"""
                   SELECT {Projection}
                   FROM app.conveyancers
                   WHERE (@jurisdiction IS NULL OR jurisdiction = @jurisdiction)
                     AND (
                           @search_pattern IS NULL
                           OR COALESCE(NULLIF(organization_name, ''), name) ILIKE @search_pattern
                           OR COALESCE(contact_name, '') ILIKE @search_pattern
                           OR COALESCE(address, '') ILIKE @search_pattern
                           OR COALESCE(phone, '') ILIKE @search_pattern
                           OR COALESCE(email, '') ILIKE @search_pattern
                           OR COALESCE(website, '') ILIKE @search_pattern
                           OR COALESCE(source_identifier, '') ILIKE @search_pattern
                         )
                   ORDER BY is_active DESC,
                            quote_requests_enabled DESC,
                            COALESCE(NULLIF(organization_name, ''), name) ASC,
                            COALESCE(NULLIF(contact_name, ''), name) ASC,
                            source_identifier ASC
                   LIMIT @limit
                   OFFSET @offset;
                   """;

        await using var command = dataSource.CreateCommand(sql);
        AddNullableTextParameter(command, "jurisdiction", normalizedJurisdiction);
        AddNullableTextParameter(command, "search_pattern", searchPattern);
        command.Parameters.AddWithValue("limit", normalizedPageSize);
        command.Parameters.AddWithValue("offset", offset);

        return new ConveyancerDirectoryAdminListRecord(
            await ReadRowsAsync(command, cancellationToken),
            totalCount);
    }

    public async Task<ConveyancerDirectoryRecord> CreateManualAsync(
        ConveyancerDirectoryCreateRecord record,
        CancellationToken cancellationToken)
    {
        var sql = $"""
                   INSERT INTO app.conveyancers
                   (
                       id,
                       jurisdiction,
                       regulator_type,
                       name,
                       contact_name,
                       organization_name,
                       address,
                       phone,
                       email,
                       website,
                       areas_of_practice,
                       source_url,
                       source_identifier,
                       is_active,
                       quote_requests_enabled,
                       quote_requests_disabled_utc,
                       last_seen_utc,
                       created_utc,
                       updated_utc
                   )
                   VALUES
                   (
                       @id,
                       @jurisdiction,
                       @regulator_type,
                       @name,
                       @contact_name,
                       @organization_name,
                       @address,
                       @phone,
                       @email,
                       @website,
                       CAST(@areas_of_practice AS jsonb),
                       @source_url,
                       @source_identifier,
                       @is_active,
                       @quote_requests_enabled,
                       @quote_requests_disabled_utc,
                       @last_seen_utc,
                       @created_utc,
                       @updated_utc
                   )
                   RETURNING {Projection};
                   """;

        await using var command = dataSource.CreateCommand(sql);
        AddCreateParameters(command, record);
        var created = await ReadSingleAsync(command, cancellationToken);
        return created ?? throw new InvalidOperationException("Conveyancer could not be created.");
    }

    public Task<ConveyancerDirectoryRecord?> UpdateAsync(
        Guid conveyancerId,
        ConveyancerDirectoryUpdateRecord record,
        CancellationToken cancellationToken)
    {
        var sql = $"""
                   UPDATE app.conveyancers
                   SET name = @name,
                       contact_name = @contact_name,
                       organization_name = @organization_name,
                       address = @address,
                       phone = @phone,
                       email = @email,
                       website = @website,
                       areas_of_practice = CAST(@areas_of_practice AS jsonb),
                       source_url = CASE
                           WHEN regulator_type = 'manual' AND @website IS NOT NULL AND BTRIM(@website) <> '' THEN
                               CASE
                           WHEN @website ILIKE 'http://%' OR @website ILIKE 'https://%' THEN @website
                                   ELSE 'https://' || @website
                               END
                           WHEN regulator_type = 'manual' THEN
                               'https://app.conveymate.com.au/conveyancers?source=manual:' || source_identifier
                           ELSE source_url
                       END,
                       quote_requests_enabled = @quote_requests_enabled,
                       quote_requests_disabled_utc = CASE
                           WHEN @quote_requests_enabled THEN NULL
                           WHEN quote_requests_enabled THEN NOW()
                           ELSE COALESCE(quote_requests_disabled_utc, NOW())
                       END,
                       updated_utc = NOW()
                   WHERE id = @id
                   RETURNING {Projection};
                   """;

        return UpdateSingleAsync(
            sql,
            (command) =>
            {
                command.Parameters.AddWithValue("id", conveyancerId);
                command.Parameters.AddWithValue("name", record.Name);
                AddNullableTextParameter(command, "contact_name", record.ContactName);
                AddNullableTextParameter(command, "organization_name", record.OrganizationName);
                AddNullableTextParameter(command, "address", record.Address);
                AddNullableTextParameter(command, "phone", record.Phone);
                AddNullableTextParameter(command, "email", record.Email);
                AddNullableTextParameter(command, "website", record.Website);
                command.Parameters.AddWithValue("areas_of_practice", JsonSerializer.Serialize(record.AreasOfPractice, SerializerOptions));
                command.Parameters.AddWithValue("quote_requests_enabled", record.QuoteRequestsEnabled);
            },
            cancellationToken);
    }

    public Task<ConveyancerDirectoryRecord?> SetActiveAsync(
        Guid conveyancerId,
        bool isActive,
        CancellationToken cancellationToken)
    {
        var sql = $"""
                   UPDATE app.conveyancers
                   SET is_active = @is_active,
                       updated_utc = NOW()
                   WHERE id = @id
                   RETURNING {Projection};
                   """;

        return UpdateSingleAsync(
            sql,
            (command) =>
            {
                command.Parameters.AddWithValue("id", conveyancerId);
                command.Parameters.AddWithValue("is_active", isActive);
            },
            cancellationToken);
    }

    public Task<ConveyancerDirectoryRecord?> SetQuoteRequestsEnabledAsync(
        Guid conveyancerId,
        bool isEnabled,
        CancellationToken cancellationToken)
    {
        var sql = $"""
                   UPDATE app.conveyancers
                   SET quote_requests_enabled = @is_enabled,
                       quote_requests_disabled_utc = CASE
                           WHEN @is_enabled THEN NULL
                           WHEN quote_requests_enabled THEN NOW()
                           ELSE COALESCE(quote_requests_disabled_utc, NOW())
                       END,
                       updated_utc = NOW()
                   WHERE id = @id
                   RETURNING {Projection};
                   """;

        return UpdateSingleAsync(
            sql,
            (command) =>
            {
                command.Parameters.AddWithValue("id", conveyancerId);
                command.Parameters.AddWithValue("is_enabled", isEnabled);
            },
            cancellationToken);
    }

    public Task<ConveyancerDirectoryRecord?> SetQuoteRequestsEnabledBySourceAsync(
        string jurisdiction,
        string regulatorType,
        string sourceIdentifier,
        bool isEnabled,
        CancellationToken cancellationToken)
    {
        var sql = $"""
                   UPDATE app.conveyancers
                   SET quote_requests_enabled = @is_enabled,
                       quote_requests_disabled_utc = CASE
                           WHEN @is_enabled THEN NULL
                           WHEN quote_requests_enabled THEN NOW()
                           ELSE COALESCE(quote_requests_disabled_utc, NOW())
                       END,
                       updated_utc = NOW()
                   WHERE jurisdiction = @jurisdiction
                     AND regulator_type = @regulator_type
                     AND source_identifier = @source_identifier
                   RETURNING {Projection};
                   """;

        return UpdateSingleAsync(
            sql,
            (command) =>
            {
                command.Parameters.AddWithValue("jurisdiction", jurisdiction);
                command.Parameters.AddWithValue("regulator_type", regulatorType);
                command.Parameters.AddWithValue("source_identifier", sourceIdentifier);
                command.Parameters.AddWithValue("is_enabled", isEnabled);
            },
            cancellationToken);
    }

    private static IReadOnlyList<string> ParseAreas(string json)
    {
        try
        {
            var parsed = JsonSerializer.Deserialize<string[]>(json, SerializerOptions);
            return parsed ?? [];
        }
        catch
        {
            return [];
        }
    }

    private async Task<IReadOnlyList<ConveyancerDirectoryRecord>> ReadRowsAsync(
        NpgsqlCommand command,
        CancellationToken cancellationToken)
    {
        var rows = new List<ConveyancerDirectoryRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(MapRecord(reader));
        }

        return rows;
    }

    private async Task<ConveyancerDirectoryRecord?> ReadSingleAsync(
        NpgsqlCommand command,
        CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return MapRecord(reader);
    }

    private async Task<ConveyancerDirectoryRecord?> UpdateSingleAsync(
        string sql,
        Action<NpgsqlCommand> configure,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(sql);
        configure(command);
        return await ReadSingleAsync(command, cancellationToken);
    }

    private static ConveyancerDirectoryRecord MapRecord(NpgsqlDataReader reader)
    {
        return new ConveyancerDirectoryRecord(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.IsDBNull(7) ? null : reader.GetString(7),
            reader.IsDBNull(8) ? null : reader.GetString(8),
            reader.IsDBNull(9) ? null : reader.GetString(9),
            ParseAreas(reader.IsDBNull(10) ? "[]" : reader.GetString(10)),
            reader.GetString(11),
            reader.GetString(12),
            reader.GetBoolean(13),
            reader.GetBoolean(14),
            reader.IsDBNull(15) ? null : reader.GetFieldValue<DateTimeOffset>(15),
            reader.GetFieldValue<DateTimeOffset>(16));
    }

    private static void AddCreateParameters(NpgsqlCommand command, ConveyancerDirectoryCreateRecord record)
    {
        command.Parameters.AddWithValue("id", record.Id);
        command.Parameters.AddWithValue("jurisdiction", record.Jurisdiction);
        command.Parameters.AddWithValue("regulator_type", record.RegulatorType);
        command.Parameters.AddWithValue("name", record.Name);
        AddNullableTextParameter(command, "contact_name", record.ContactName);
        AddNullableTextParameter(command, "organization_name", record.OrganizationName);
        AddNullableTextParameter(command, "address", record.Address);
        AddNullableTextParameter(command, "phone", record.Phone);
        AddNullableTextParameter(command, "email", record.Email);
        AddNullableTextParameter(command, "website", record.Website);
        command.Parameters.AddWithValue("areas_of_practice", JsonSerializer.Serialize(record.AreasOfPractice, SerializerOptions));
        command.Parameters.AddWithValue("source_url", record.SourceUrl);
        command.Parameters.AddWithValue("source_identifier", record.SourceIdentifier);
        command.Parameters.AddWithValue("is_active", record.IsActive);
        command.Parameters.AddWithValue("quote_requests_enabled", record.QuoteRequestsEnabled);
        AddNullableTimestampTzParameter(
            command,
            "quote_requests_disabled_utc",
            record.QuoteRequestsEnabled ? null : record.UpdatedUtc);
        command.Parameters.AddWithValue("last_seen_utc", record.LastSeenUtc);
        command.Parameters.AddWithValue("created_utc", record.CreatedUtc);
        command.Parameters.AddWithValue("updated_utc", record.UpdatedUtc);
    }

    private static void AddNullableTextParameter(NpgsqlCommand command, string name, string? value)
    {
        command.Parameters.Add(new NpgsqlParameter(name, NpgsqlDbType.Text)
        {
            Value = (object?)value ?? DBNull.Value
        });
    }

    private static void AddNullableTimestampTzParameter(NpgsqlCommand command, string name, DateTimeOffset? value)
    {
        command.Parameters.Add(new NpgsqlParameter(name, NpgsqlDbType.TimestampTz)
        {
            Value = (object?)value ?? DBNull.Value
        });
    }

    private static string? NormalizeJurisdiction(string? jurisdiction)
    {
        var normalized = (jurisdiction ?? string.Empty).Trim().ToUpperInvariant();
        return normalized.Length == 0 ? null : normalized;
    }

    private static string? BuildSearchPattern(string? search)
    {
        var normalized = (search ?? string.Empty).Trim();
        return normalized.Length == 0 ? null : $"%{normalized}%";
    }
}
