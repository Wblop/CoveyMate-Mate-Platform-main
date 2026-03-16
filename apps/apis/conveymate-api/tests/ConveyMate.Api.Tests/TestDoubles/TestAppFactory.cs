using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ErrorOr;
using ConveyMate.Api.Application.Auth.Abstractions;
using ConveyMate.Api.Application.Conveyancers.Abstractions;
using ConveyMate.Api.Application.Notifications.Abstractions;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Configuration;
using ConveyMate.Api.Database;

namespace ConveyMate.Api.Tests.TestDoubles;

/// <summary>
/// Test host factory that swaps external dependencies for deterministic in-memory doubles.
/// </summary>
public sealed class TestAppFactory : WebApplicationFactory<Program>
{
    public InMemoryUserRepository UserRepository { get; } = new();
    public InMemoryConveyancerDirectoryRepository ConveyancerDirectoryRepository { get; } = new();
    public InMemoryNotificationRepository NotificationRepository { get; } = new();
    public TestCognitoSignUpService CognitoSignUpService { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        builder.ConfigureAppConfiguration((_, configBuilder) =>
        {
            configBuilder.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Postgres"] = "Host=localhost;Port=54329;Database=conveymate;Username=conveymate_app;Password=not-used",
                ["Cognito:Region"] = "ap-southeast-2",
                ["Cognito:UserPoolId"] = "ap-southeast-2_testpool",
                ["Cognito:AppClientId"] = "test-client-id",
                ["Cognito:Issuer"] = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_testpool",
                ["Cognito:Scopes:0"] = "openid",
                ["Cognito:Scopes:1"] = "email",
                ["Cognito:Scopes:2"] = "profile",
                ["Cognito:HostedUiDomain"] = "https://conveymate-test.auth.ap-southeast-2.amazoncognito.com",
                ["Cognito:RedirectSignIn"] = "https://app.conveymate.com.au/google/callback",
                ["Cognito:RedirectSignOut"] = "https://app.conveymate.com.au/signin",
                ["Cognito:SupportedIdentityProviders:0"] = "COGNITO",
                ["Cognito:SupportedIdentityProviders:1"] = "Google",
                ["PublicMetadata:ApiBaseUrl"] = "https://api.testing.local",
                ["PublicMetadata:CacheTtlSeconds"] = "300",
                ["PublicMetadata:GoogleAnalyticsMeasurementId"] = "G-TEST123456",
                ["Stripe:SecretKey"] = "sk_test_not_used",
                ["Stripe:WebhookSecret"] = "whsec_not_used",
                ["Stripe:PublishableKey"] = "pk_test_not_used",
                ["Stripe:PriceAudCents"] = "1999",
                ["ReviewPipeline:AppBaseUrl"] = "https://app.testing.local",
                ["ReviewPipeline:ReportsBucketName"] = "conveymate-test-bucket",
                ["ReviewPipeline:TextractEnabled"] = "true",
                ["ReviewPipeline:PresignedUrlTtlSeconds"] = "900",
                ["Grok:ApiKey"] = "grok-test-key",
                ["Grok:ApiUrl"] = "https://api.x.ai/v1/chat/completions",
                ["Grok:Model"] = "grok-4-1-fast-reasoning",
                ["Grok:Temperature"] = "0.1",
                ["Grok:Collections:au-common"] = "collection_test_common",
                ["Grok:Collections:au-act"] = "collection_test_act",
                ["Cors:AllowedOrigins:0"] = "http://localhost:4200"
            });
        });

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<IDatabaseMigrator>();
            services.AddSingleton<IDatabaseMigrator, NoOpDatabaseMigrator>();

            services.RemoveAll<IUserRepository>();
            services.AddSingleton<IUserRepository>(UserRepository);
            services.RemoveAll<IConveyancerDirectoryRepository>();
            services.AddSingleton<IConveyancerDirectoryRepository>(ConveyancerDirectoryRepository);
            services.RemoveAll<INotificationRepository>();
            services.AddSingleton<INotificationRepository>(NotificationRepository);
            services.RemoveAll<ICognitoSignUpService>();
            services.AddSingleton(CognitoSignUpService);
            services.AddSingleton<ICognitoSignUpService>(CognitoSignUpService);

            services.AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });

            services.PostConfigure<AuthenticationOptions>(options =>
            {
                options.DefaultAuthenticateScheme = "Test";
                options.DefaultChallengeScheme = "Test";
                options.DefaultScheme = "Test";
            });
        });
    }

    private sealed class NoOpDatabaseMigrator : IDatabaseMigrator
    {
        public Task MigrateAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}

public sealed class TestCognitoSignUpService : ICognitoSignUpService
{
    public ErrorOr<CognitoSignUpResult> NextResult { get; set; } = new CognitoSignUpResult(false);

    public string? LastFullName { get; private set; }

    public string? LastEmail { get; private set; }

    public string? LastPassword { get; private set; }

    public Task<ErrorOr<CognitoSignUpResult>> SignUpAsync(string fullName, string email, string password, CancellationToken cancellationToken)
    {
        LastFullName = fullName;
        LastEmail = email;
        LastPassword = password;
        return Task.FromResult(NextResult);
    }

    public void Reset()
    {
        NextResult = new CognitoSignUpResult(false);
        LastFullName = null;
        LastEmail = null;
        LastPassword = null;
    }
}
