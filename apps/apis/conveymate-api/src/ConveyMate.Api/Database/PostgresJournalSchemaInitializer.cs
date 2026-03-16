using Npgsql;

namespace ConveyMate.Api.Database;

/// <summary>
/// Ensures the PostgreSQL schema used by the DbUp journal table exists.
/// </summary>
public sealed class PostgresJournalSchemaInitializer : IJournalSchemaInitializer
{
    public async Task EnsureAsync(string connectionString, string journalSchema, CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        await using var command = connection.CreateCommand();
        command.CommandText = $"CREATE SCHEMA IF NOT EXISTS {journalSchema};";

        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
