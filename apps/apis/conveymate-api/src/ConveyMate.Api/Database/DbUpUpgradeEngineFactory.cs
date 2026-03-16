using DbUp;
using DbUp.Engine;
using DbUp.Engine.Output;

namespace ConveyMate.Api.Database;

/// <summary>
/// Creates DbUp upgrade engines configured for PostgreSQL journaling.
/// </summary>
public sealed class DbUpUpgradeEngineFactory : IDbUpUpgradeEngineFactory
{
    public IDbUpUpgradeEngine Create(
        string connectionString,
        IReadOnlyList<SqlScript> scripts,
        string journalSchema,
        string journalTable,
        IUpgradeLog upgradeLog)
    {
        var engine = DeployChanges
            .To
            .PostgresqlDatabase(connectionString)
            .WithScripts(scripts)
            .JournalToPostgresqlTable(journalSchema, journalTable)
            .LogTo(upgradeLog)
            .Build();

        return new DbUpUpgradeEngineAdapter(engine);
    }
}

/// <summary>
/// Thin adapter to isolate direct DbUp engine dependency behind an internal interface.
/// </summary>
public sealed class DbUpUpgradeEngineAdapter(UpgradeEngine engine) : IDbUpUpgradeEngine
{
    public DatabaseUpgradeResult PerformUpgrade() => engine.PerformUpgrade();
}
