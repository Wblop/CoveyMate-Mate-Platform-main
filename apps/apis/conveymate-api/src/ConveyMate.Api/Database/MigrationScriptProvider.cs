using DbUp.Engine;

namespace ConveyMate.Api.Database;

/// <summary>
/// Loads SQL migration scripts from disk in deterministic lexical order.
/// </summary>
public interface IMigrationScriptProvider
{
    IReadOnlyList<SqlScript> LoadScripts(string migrationsDirectory);
}

/// <summary>
/// File-system implementation for discovering DbUp SQL script inputs.
/// </summary>
public sealed class MigrationScriptProvider : IMigrationScriptProvider
{
    public IReadOnlyList<SqlScript> LoadScripts(string migrationsDirectory)
    {
        if (!Directory.Exists(migrationsDirectory))
        {
            throw new DirectoryNotFoundException($"Migration directory not found: {migrationsDirectory}");
        }

        var scripts = Directory
            .EnumerateFiles(migrationsDirectory, "*.sql", SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .OrderBy(file => file.Name, StringComparer.Ordinal)
            .Select(file => new SqlScript(file.Name, File.ReadAllText(file.FullName)))
            .ToList();

        if (scripts.Count == 0)
        {
            throw new InvalidOperationException($"No SQL migrations were found in: {migrationsDirectory}");
        }

        return scripts;
    }
}
