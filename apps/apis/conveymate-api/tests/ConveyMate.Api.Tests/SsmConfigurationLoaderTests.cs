using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Unit tests for SSM-derived Cognito configuration normalization behaviour.
/// </summary>
public sealed class SsmConfigurationLoaderTests
{
    [Fact]
    public void EnsureDerivedCognitoIssuer_Derives_Issuer_From_Region_And_UserPool_When_Missing()
    {
        var overrides = new Dictionary<string, string?>
        {
            ["Cognito:UserPoolId"] = "ap-southeast-2_abc123"
        };

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cognito:Region"] = "ap-southeast-2"
            })
            .Build();

        SsmConfigurationLoader.EnsureDerivedCognitoIssuer(overrides, config);

        Assert.Equal(
            "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_abc123",
            overrides["Cognito:Issuer"]);
    }

    [Fact]
    public void EnsureDerivedCognitoIssuer_Does_Not_Override_Explicit_Issuer()
    {
        var overrides = new Dictionary<string, string?>
        {
            ["Cognito:UserPoolId"] = "ap-southeast-2_abc123",
            ["Cognito:Issuer"] = "https://custom.example/issuer"
        };

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cognito:Region"] = "ap-southeast-2"
            })
            .Build();

        SsmConfigurationLoader.EnsureDerivedCognitoIssuer(overrides, config);

        Assert.Equal("https://custom.example/issuer", overrides["Cognito:Issuer"]);
    }

    [Fact]
    public void MapParameters_Maps_HostedUi_Fields_And_Supported_Providers()
    {
        var loaderType = typeof(SsmConfigurationLoader);
        var mapParameters = loaderType.GetMethod("MapParameters", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Could not find MapParameters.");

        var configuration = new ConfigurationBuilder().Build();
        var configurationManager = new ConfigurationManager();
        var loggerFactory = LoggerFactory.Create(_ => { });
        var logger = loggerFactory.CreateLogger<SsmConfigurationLoader>();
        var environment = new FakeHostEnvironment();
        var loader = Activator.CreateInstance(
            loaderType,
            configuration,
            configurationManager,
            environment,
            logger) ?? throw new InvalidOperationException("Could not create SsmConfigurationLoader.");

        var parameters = new List<Amazon.SimpleSystemsManagement.Model.Parameter>
        {
            new()
            {
                Name = "/conveymate/www/cognito/hosteduidomain",
                Value = "https://example.auth.ap-southeast-2.amazoncognito.com"
            },
            new()
            {
                Name = "/conveymate/www/cognito/redirectsignin",
                Value = "https://app.conveymate.com.au/google/callback"
            },
            new()
            {
                Name = "/conveymate/www/cognito/redirectsignout",
                Value = "https://app.conveymate.com.au/signin"
            },
            new()
            {
                Name = "/conveymate/www/cognito/supportedidentityproviders",
                Value = "COGNITO,Google"
            }
        };

        var result = (Dictionary<string, string?>)mapParameters.Invoke(loader, [parameters, "/conveymate/www"])
            !;

        Assert.Equal("https://example.auth.ap-southeast-2.amazoncognito.com", result["Cognito:HostedUiDomain"]);
        Assert.Equal("https://app.conveymate.com.au/google/callback", result["Cognito:RedirectSignIn"]);
        Assert.Equal("https://app.conveymate.com.au/signin", result["Cognito:RedirectSignOut"]);
        Assert.Equal("COGNITO", result["Cognito:SupportedIdentityProviders:0"]);
        Assert.Equal("Google", result["Cognito:SupportedIdentityProviders:1"]);
    }

    [Fact]
    public void MapParameters_Maps_SeoEngineAutomation_Fields()
    {
        var loaderType = typeof(SsmConfigurationLoader);
        var mapParameters = loaderType.GetMethod("MapParameters", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Could not find MapParameters.");

        var configuration = new ConfigurationBuilder().Build();
        var configurationManager = new ConfigurationManager();
        var loggerFactory = LoggerFactory.Create(_ => { });
        var logger = loggerFactory.CreateLogger<SsmConfigurationLoader>();
        var environment = new FakeHostEnvironment();
        var loader = Activator.CreateInstance(
            loaderType,
            configuration,
            configurationManager,
            environment,
            logger) ?? throw new InvalidOperationException("Could not create SsmConfigurationLoader.");

        var parameters = new List<Amazon.SimpleSystemsManagement.Model.Parameter>
        {
            new()
            {
                Name = "/conveymate/www/seo-engine/enabled",
                Value = "true"
            },
            new()
            {
                Name = "/conveymate/www/seo-engine/enginename",
                Value = "ConveyMate-SEO"
            },
            new()
            {
                Name = "/conveymate/www/seo-engine/commandqueueurl",
                Value = "https://sqs.ap-southeast-2.amazonaws.com/123456789012/conveymate-www-seo-commands"
            },
            new()
            {
                Name = "/conveymate/www/seo-engine/commandqueueregion",
                Value = "ap-southeast-2"
            },
            new()
            {
                Name = "/conveymate/www/seo-engine/marketinghost",
                Value = "conveymate.com.au"
            },
            new()
            {
                Name = "/conveymate/www/seo-engine/apphost",
                Value = "app.conveymate.com.au"
            }
        };

        var result = (Dictionary<string, string?>)mapParameters.Invoke(loader, [parameters, "/conveymate/www"])
            !;

        Assert.Equal("true", result["SeoEngineAutomation:Enabled"]);
        Assert.Equal("ConveyMate-SEO", result["SeoEngineAutomation:EngineName"]);
        Assert.Equal(
            "https://sqs.ap-southeast-2.amazonaws.com/123456789012/conveymate-www-seo-commands",
            result["SeoEngineAutomation:CommandQueueUrl"]);
        Assert.Equal("ap-southeast-2", result["SeoEngineAutomation:CommandQueueRegion"]);
        Assert.Equal("conveymate.com.au", result["SeoEngineAutomation:MarketingHost"]);
        Assert.Equal("app.conveymate.com.au", result["SeoEngineAutomation:AppHost"]);
    }

    private sealed class FakeHostEnvironment : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";

        public string ApplicationName { get; set; } = "ConveyMate.Api.Tests";

        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; }
            = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
