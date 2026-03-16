using ConveyMate.Api.Database;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Unit tests for migration script discovery and ordering.
/// </summary>
public sealed class MigrationScriptProviderTests
{
    [Fact]
    public void Loads_Scripts_In_Deterministic_Lexical_Order()
    {
        var tempDirectory = Path.Combine(Path.GetTempPath(), $"conveymate-migrations-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDirectory);

        try
        {
            File.WriteAllText(Path.Combine(tempDirectory, "0003_last.sql"), "SELECT 3;");
            File.WriteAllText(Path.Combine(tempDirectory, "0001_first.sql"), "SELECT 1;");
            File.WriteAllText(Path.Combine(tempDirectory, "0002_middle.sql"), "SELECT 2;");

            var provider = new MigrationScriptProvider();

            var scripts = provider.LoadScripts(tempDirectory);
            var names = scripts.Select(script => script.Name).ToArray();

            Assert.Equal(["0001_first.sql", "0002_middle.sql", "0003_last.sql"], names);
        }
        finally
        {
            Directory.Delete(tempDirectory, recursive: true);
        }
    }
}
