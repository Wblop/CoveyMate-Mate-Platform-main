namespace ConveyMate.Api.Database;

/// <summary>
/// Ensures migration journal schema prerequisites exist before DbUp runs.
/// </summary>
public interface IJournalSchemaInitializer
{
    Task EnsureAsync(string connectionString, string journalSchema, CancellationToken cancellationToken);
}
