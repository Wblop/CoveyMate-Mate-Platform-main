namespace ConveyMate.Api.Database;

/// <summary>
/// Runs schema upgrades required before serving API traffic.
/// </summary>
public interface IDatabaseMigrator
{
    Task MigrateAsync(CancellationToken cancellationToken);
}
