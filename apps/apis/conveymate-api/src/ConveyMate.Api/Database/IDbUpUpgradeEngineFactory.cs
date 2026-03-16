using DbUp.Engine;
using DbUp.Engine.Output;

namespace ConveyMate.Api.Database;

/// <summary>
/// Abstraction for executing DbUp upgrade operations.
/// </summary>
public interface IDbUpUpgradeEngine
{
    DatabaseUpgradeResult PerformUpgrade();
}

/// <summary>
/// Factory abstraction for constructing DbUp engine instances.
/// </summary>
public interface IDbUpUpgradeEngineFactory
{
    IDbUpUpgradeEngine Create(
        string connectionString,
        IReadOnlyList<SqlScript> scripts,
        string journalSchema,
        string journalTable,
        IUpgradeLog upgradeLog);
}
