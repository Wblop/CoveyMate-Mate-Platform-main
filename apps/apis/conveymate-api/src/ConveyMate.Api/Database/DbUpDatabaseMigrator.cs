using Microsoft.Extensions.Options;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Database;

/// <summary>
/// Executes DbUp SQL migrations and fails startup when migration execution fails.
/// </summary>
public sealed class DbUpDatabaseMigrator(
    IOptions<DatabaseOptions> databaseOptions,
    IHostEnvironment hostEnvironment,
    IMigrationScriptProvider migrationScriptProvider,
    IJournalSchemaInitializer journalSchemaInitializer,
    IDbUpUpgradeEngineFactory upgradeEngineFactory,
    ILogger<DbUpDatabaseMigrator> logger) : IDatabaseMigrator
{
    private const string JournalSchema = "schemaversion";
    private const string JournalTable = "journal";

    public async Task MigrateAsync(CancellationToken cancellationToken)
    {
        var connectionString = databaseOptions.Value.Postgres;
        var migrationsPath = Path.Combine(hostEnvironment.ContentRootPath, "Database", "Migrations");

        await journalSchemaInitializer.EnsureAsync(connectionString, JournalSchema, cancellationToken);

        var scripts = migrationScriptProvider.LoadScripts(migrationsPath);

        var upgrader = upgradeEngineFactory.Create(
            connectionString,
            scripts,
            JournalSchema,
            JournalTable,
            new DbUpLoggerAdapter(logger));

        logger.LogInformation("Running database migrations from {MigrationsPath} against journal {Schema}.{Table}", migrationsPath, JournalSchema, JournalTable);

        var result = upgrader.PerformUpgrade();
        if (!result.Successful)
        {
            throw new InvalidOperationException("Database migration failed. Check migration logs for the failing script.", result.Error);
        }

        logger.LogInformation("Database migrations completed successfully.");
    }
}
