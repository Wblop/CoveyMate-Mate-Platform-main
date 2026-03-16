using DbUp.Engine;
using DbUp.Engine.Output;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Configuration;
using ConveyMate.Api.Database;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Unit tests for migration orchestration behaviour around DbUp execution.
/// </summary>
public sealed class DbUpDatabaseMigratorTests
{
    [Fact]
    public async Task Executes_Upgrade_With_Journal_And_Sorted_Scripts()
    {
        var tempDirectory = Path.Combine(Path.GetTempPath(), $"conveymate-dbup-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDirectory);
        Directory.CreateDirectory(Path.Combine(tempDirectory, "Database", "Migrations"));

        try
        {
            var migrationsPath = Path.Combine(tempDirectory, "Database", "Migrations");
            File.WriteAllText(Path.Combine(migrationsPath, "0002_b.sql"), "SELECT 2;");
            File.WriteAllText(Path.Combine(migrationsPath, "0001_a.sql"), "SELECT 1;");

            var options = Options.Create(new DatabaseOptions
            {
                Postgres = "Host=localhost;Database=test;Username=test;Password=test"
            });

            var environment = new FakeHostEnvironment(tempDirectory);
            var provider = new MigrationScriptProvider();
            var schemaInitializer = new NoOpJournalSchemaInitializer();
            var engineFactory = new CapturingEngineFactory(success: true);

            var migrator = new DbUpDatabaseMigrator(
                options,
                environment,
                provider,
                schemaInitializer,
                engineFactory,
                NullLogger<DbUpDatabaseMigrator>.Instance);

            await migrator.MigrateAsync(CancellationToken.None);

            Assert.Equal("schemaversion", engineFactory.CapturedJournalSchema);
            Assert.Equal("journal", engineFactory.CapturedJournalTable);
            Assert.Equal(["0001_a.sql", "0002_b.sql"], engineFactory.CapturedScripts.Select(script => script.Name).ToArray());
            Assert.Equal(1, engineFactory.PerformUpgradeCalls);
        }
        finally
        {
            Directory.Delete(tempDirectory, recursive: true);
        }
    }

    [Fact]
    public async Task Fails_Fast_When_Upgrade_Fails()
    {
        var tempDirectory = Path.Combine(Path.GetTempPath(), $"conveymate-dbup-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDirectory);
        Directory.CreateDirectory(Path.Combine(tempDirectory, "Database", "Migrations"));

        try
        {
            var migrationsPath = Path.Combine(tempDirectory, "Database", "Migrations");
            File.WriteAllText(Path.Combine(migrationsPath, "0001_a.sql"), "SELECT 1;");

            var options = Options.Create(new DatabaseOptions
            {
                Postgres = "Host=localhost;Database=test;Username=test;Password=test"
            });

            var migrator = new DbUpDatabaseMigrator(
                options,
                new FakeHostEnvironment(tempDirectory),
                new MigrationScriptProvider(),
                new NoOpJournalSchemaInitializer(),
                new CapturingEngineFactory(success: false),
                NullLogger<DbUpDatabaseMigrator>.Instance);

            var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => migrator.MigrateAsync(CancellationToken.None));
            Assert.Contains("Database migration failed", exception.Message, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(tempDirectory, recursive: true);
        }
    }

    private sealed class FakeHostEnvironment(string contentRootPath) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "ConveyMate.Api.Tests";
        public string ContentRootPath { get; set; } = contentRootPath;
        public IFileProvider ContentRootFileProvider { get; set; } = new PhysicalFileProvider(contentRootPath);
    }

    private sealed class NoOpJournalSchemaInitializer : IJournalSchemaInitializer
    {
        public Task EnsureAsync(string connectionString, string journalSchema, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class CapturingEngineFactory(bool success) : IDbUpUpgradeEngineFactory
    {
        public IReadOnlyList<SqlScript> CapturedScripts { get; private set; } = [];
        public string CapturedJournalSchema { get; private set; } = string.Empty;
        public string CapturedJournalTable { get; private set; } = string.Empty;
        public int PerformUpgradeCalls { get; private set; }

        public IDbUpUpgradeEngine Create(
            string connectionString,
            IReadOnlyList<SqlScript> scripts,
            string journalSchema,
            string journalTable,
            IUpgradeLog upgradeLog)
        {
            CapturedScripts = scripts;
            CapturedJournalSchema = journalSchema;
            CapturedJournalTable = journalTable;

            return new FakeEngine(this, success);
        }

        private sealed class FakeEngine(CapturingEngineFactory owner, bool shouldSucceed) : IDbUpUpgradeEngine
        {
            public DatabaseUpgradeResult PerformUpgrade()
            {
                owner.PerformUpgradeCalls++;
                return shouldSucceed
                    ? new DatabaseUpgradeResult([], true, null!, new SqlScript("none", string.Empty))
                    : new DatabaseUpgradeResult([], false, new Exception("boom"), new SqlScript("0001_a.sql", "SELECT 1;"));
            }
        }
    }
}
