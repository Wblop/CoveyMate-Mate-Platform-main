using DbUp.Engine.Output;

namespace ConveyMate.Api.Database;

/// <summary>
/// Bridges DbUp logging callbacks into the standard ASP.NET logging pipeline.
/// </summary>
public sealed class DbUpLoggerAdapter(ILogger<DbUpDatabaseMigrator> logger) : IUpgradeLog
{
    public void LogTrace(string format, params object[] args) => logger.LogTrace(format, args);

    public void LogDebug(string format, params object[] args) => logger.LogDebug(format, args);

    public void LogInformation(string format, params object[] args) => logger.LogInformation(format, args);

    public void LogWarning(string format, params object[] args) => logger.LogWarning(format, args);

    public void LogError(string format, params object[] args) => logger.LogError(format, args);

    public void LogError(Exception exception, string format, params object[] args) => logger.LogError(exception, format, args);
}
