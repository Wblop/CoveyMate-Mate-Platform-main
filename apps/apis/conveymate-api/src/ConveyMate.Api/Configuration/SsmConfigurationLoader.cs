using Amazon;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;

namespace ConveyMate.Api.Configuration;

/// <summary>
/// Loads environment-scoped overrides from AWS SSM Parameter Store.
/// </summary>
public interface ISsmConfigurationLoader
{
    Task LoadOverridesAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Resolves /conveymate/{env} parameters and overlays them on top of appsettings.
/// </summary>
public sealed class SsmConfigurationLoader(
    IConfiguration configuration,
    IConfigurationManager configurationManager,
    IHostEnvironment hostEnvironment,
    ILogger<SsmConfigurationLoader> logger) : ISsmConfigurationLoader
{
    public async Task LoadOverridesAsync(CancellationToken cancellationToken)
    {
        if (hostEnvironment.IsEnvironment("Testing"))
        {
            return;
        }

        var configEnvironment = ResolveConfigEnvironment();
        var prefix = $"/conveymate/{configEnvironment}";
        var region = ResolveAwsRegion();

        var clientConfig = new AmazonSimpleSystemsManagementConfig
        {
            RegionEndpoint = RegionEndpoint.GetBySystemName(region),
            Timeout = TimeSpan.FromSeconds(3),
            MaxErrorRetry = 1
        };

        try
        {
            using var client = new AmazonSimpleSystemsManagementClient(clientConfig);
            var parameters = await GetParametersByPathAsync(client, prefix, cancellationToken);
            var overrides = MapParameters(parameters, prefix);
            EnsureDerivedCognitoIssuer(overrides, configuration);

            if (overrides.Count == 0)
            {
                logger.LogInformation("No SSM overrides found under {Prefix}. Falling back to appsettings.", prefix);
                return;
            }

            configurationManager.AddInMemoryCollection(overrides);
            logger.LogInformation("Loaded {Count} SSM configuration override values from {Prefix}.", overrides.Count, prefix);
        }
        catch (Exception error)
        {
            logger.LogWarning(error, "Could not load SSM configuration from {Prefix}. Falling back to appsettings.", prefix);
        }
    }

    private string ResolveConfigEnvironment()
    {
        var configured = configuration["ConveyMate:ConfigEnvironment"]
            ?? Environment.GetEnvironmentVariable("CONVEYMATE_CONFIG_ENV");

        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured.Trim().ToLowerInvariant();
        }

        if (hostEnvironment.IsDevelopment())
        {
            return "dev";
        }

        return hostEnvironment.EnvironmentName.Trim().ToLowerInvariant();
    }

    private string ResolveAwsRegion()
    {
        return configuration["AWS:Region"]
            ?? Environment.GetEnvironmentVariable("AWS_REGION")
            ?? Environment.GetEnvironmentVariable("AWS_DEFAULT_REGION")
            ?? configuration["Cognito:Region"]
            ?? "ap-southeast-2";
    }

    private async Task<List<Parameter>> GetParametersByPathAsync(
        IAmazonSimpleSystemsManagement client,
        string prefix,
        CancellationToken cancellationToken)
    {
        var items = new List<Parameter>();
        string? nextToken = null;

        do
        {
            var request = new GetParametersByPathRequest
            {
                Path = prefix,
                Recursive = true,
                WithDecryption = true,
                NextToken = nextToken
            };

            var response = await client.GetParametersByPathAsync(request, cancellationToken);
            items.AddRange(response.Parameters);
            nextToken = response.NextToken;
        } while (!string.IsNullOrWhiteSpace(nextToken));

        return items;
    }

    private Dictionary<string, string?> MapParameters(List<Parameter> parameters, string prefix)
    {
        var mapped = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

        foreach (var parameter in parameters)
        {
            if (string.IsNullOrWhiteSpace(parameter.Name) || parameter.Value is null)
            {
                continue;
            }

            var suffix = parameter.Name[prefix.Length..].Trim('/').ToLowerInvariant();
            switch (suffix)
            {
                case "cognito/userpoolid":
                    mapped["Cognito:UserPoolId"] = parameter.Value;
                    break;
                case "cognito/appclientid":
                case "cognito/clientid":
                    mapped["Cognito:AppClientId"] = parameter.Value;
                    break;
                case "cognito/issuer":
                    mapped["Cognito:Issuer"] = parameter.Value;
                    break;
                case "cognito/region":
                    mapped["Cognito:Region"] = parameter.Value;
                    break;
                case "cognito/scopes":
                    AddArray(mapped, "Cognito:Scopes", parameter.Value);
                    break;
                case "cognito/hosteduidomain":
                    mapped["Cognito:HostedUiDomain"] = parameter.Value;
                    break;
                case "cognito/redirectsignin":
                    mapped["Cognito:RedirectSignIn"] = parameter.Value;
                    break;
                case "cognito/redirectsignout":
                    mapped["Cognito:RedirectSignOut"] = parameter.Value;
                    break;
                case "cognito/supportedidentityproviders":
                    AddArray(mapped, "Cognito:SupportedIdentityProviders", parameter.Value);
                    break;
                case "database/connectionstring":
                    mapped["ConnectionStrings:Postgres"] = parameter.Value;
                    break;
                case "publicmetadata/apibaseurl":
                    mapped["PublicMetadata:ApiBaseUrl"] = parameter.Value;
                    break;
                case "publicmetadata/cachettlseconds":
                    mapped["PublicMetadata:CacheTtlSeconds"] = parameter.Value;
                    break;
                case "publicmetadata/addressautocompleteprovider":
                    mapped["PublicMetadata:AddressAutocompleteProvider"] = parameter.Value;
                    break;
                case "publicmetadata/googleanalyticsmeasurementid":
                case "publicmetadata/googleanalyticsid":
                case "publicmetadata/ga4measurementid":
                    mapped["PublicMetadata:GoogleAnalyticsMeasurementId"] = parameter.Value;
                    break;
                case "publicmetadata/enablerecaptcha":
                    mapped["PublicMetadata:EnableRecaptcha"] = parameter.Value;
                    break;
                case "publicmetadata/recaptchasitekey":
                    mapped["PublicMetadata:RecaptchaSiteKey"] = parameter.Value;
                    break;
                case "recaptcha/legacysecretkey":
                    mapped["Recaptcha:LegacySecretKey"] = parameter.Value;
                    break;
                case "recaptcha/minimumscore":
                    mapped["Recaptcha:MinimumScore"] = parameter.Value;
                    break;
                case "conveyancerdirectorycache/enabled":
                    mapped["ConveyancerDirectoryCache:Enabled"] = parameter.Value;
                    break;
                case "conveyancerdirectorycache/absolutettlhours":
                    mapped["ConveyancerDirectoryCache:AbsoluteTtlHours"] = parameter.Value;
                    break;
                case "cors/allowedorigins":
                    AddArray(mapped, "Cors:AllowedOrigins", parameter.Value);
                    break;
                case "grok/apikey":
                case "grok/api-key":
                    mapped["Grok:ApiKey"] = parameter.Value;
                    break;
                case "grok/apiurl":
                    mapped["Grok:ApiUrl"] = parameter.Value;
                    break;
                case "grok/model":
                    mapped["Grok:Model"] = parameter.Value;
                    break;
                case "grok/temperature":
                    mapped["Grok:Temperature"] = parameter.Value;
                    break;
                case "embeddings/provider":
                    mapped["Embeddings:Provider"] = parameter.Value;
                    break;
                case "embeddings/model":
                    mapped["Embeddings:Model"] = parameter.Value;
                    break;
                case "stripe/secretkey":
                    mapped["Stripe:SecretKey"] = parameter.Value;
                    break;
                case "stripe/webhooksecret":
                    mapped["Stripe:WebhookSecret"] = parameter.Value;
                    break;
                case "stripe/priceaudcents":
                    mapped["Stripe:PriceAudCents"] = parameter.Value;
                    break;
                case "stripe/publishablekey":
                    mapped["Stripe:PublishableKey"] = parameter.Value;
                    break;
                case "app/baseurl":
                    mapped["ReviewPipeline:AppBaseUrl"] = parameter.Value;
                    break;
                case "seo-engine/enabled":
                    mapped["SeoEngineAutomation:Enabled"] = parameter.Value;
                    break;
                case "seo-engine/enginename":
                    mapped["SeoEngineAutomation:EngineName"] = parameter.Value;
                    break;
                case "seo-engine/commandqueueurl":
                    mapped["SeoEngineAutomation:CommandQueueUrl"] = parameter.Value;
                    break;
                case "seo-engine/commandqueueregion":
                    mapped["SeoEngineAutomation:CommandQueueRegion"] = parameter.Value;
                    break;
                case "seo-engine/marketinghost":
                    mapped["SeoEngineAutomation:MarketingHost"] = parameter.Value;
                    break;
                case "seo-engine/apphost":
                    mapped["SeoEngineAutomation:AppHost"] = parameter.Value;
                    break;
                case "quoterequestemail/mode":
                    mapped["QuoteRequestEmail:Mode"] = parameter.Value;
                    break;
                case "quoterequestemail/fromname":
                    mapped["QuoteRequestEmail:FromName"] = parameter.Value;
                    break;
                case "quoterequestemail/fromemail":
                    mapped["QuoteRequestEmail:FromEmail"] = parameter.Value;
                    break;
                case "quoterequestemail/requestexpiryhours":
                    mapped["QuoteRequestEmail:RequestExpiryHours"] = parameter.Value;
                    break;
                case "email/smtp/host":
                    mapped["QuoteRequestEmail:SmtpHost"] = parameter.Value;
                    break;
                case "email/smtp/port":
                    mapped["QuoteRequestEmail:SmtpPort"] = parameter.Value;
                    break;
                case "email/smtp/enablessl":
                    mapped["QuoteRequestEmail:SmtpEnableSsl"] = parameter.Value;
                    break;
                case "email/smtp/username":
                    mapped["QuoteRequestEmail:SmtpUsername"] = parameter.Value;
                    break;
                case "email/smtp/password":
                    mapped["QuoteRequestEmail:SmtpPassword"] = parameter.Value;
                    break;
                case "email/smtp/enableses":
                    mapped["QuoteRequestEmail:EnableSes"] = parameter.Value;
                    break;
                case "email/smtp/testaddress":
                    mapped["QuoteRequestEmail:TestAddress"] = parameter.Value;
                    break;
                case "quoterequestemail/smtphost":
                    mapped["QuoteRequestEmail:SmtpHost"] = parameter.Value;
                    break;
                case "quoterequestemail/smtpport":
                    mapped["QuoteRequestEmail:SmtpPort"] = parameter.Value;
                    break;
                case "quoterequestemail/smtpenablessl":
                    mapped["QuoteRequestEmail:SmtpEnableSsl"] = parameter.Value;
                    break;
                case "quoterequestemail/smtpusername":
                    mapped["QuoteRequestEmail:SmtpUsername"] = parameter.Value;
                    break;
                case "quoterequestemail/smtppassword":
                    mapped["QuoteRequestEmail:SmtpPassword"] = parameter.Value;
                    break;
                case "s3/reportsbucketname":
                    mapped["ReviewPipeline:ReportsBucketName"] = parameter.Value;
                    break;
                case "textract/enabled":
                    mapped["ReviewPipeline:TextractEnabled"] = parameter.Value;
                    break;
                case "jurisdiction/defaultstate":
                    mapped["ReviewPipeline:DefaultState"] = parameter.Value;
                    break;
                default:
                    if (suffix.StartsWith("grok/collections/", StringComparison.OrdinalIgnoreCase))
                    {
                        var key = suffix["grok/collections/".Length..].Trim('/');
                        if (!string.IsNullOrWhiteSpace(key))
                        {
                            mapped[$"Grok:Collections:{key}"] = parameter.Value;
                        }
                    }
                    break;
            }
        }

        return mapped;
    }
    public static void EnsureDerivedCognitoIssuer(IDictionary<string, string?> overrides, IConfiguration configuration)
    {
        if (overrides.ContainsKey("Cognito:Issuer"))
        {
            return;
        }

        if (!overrides.TryGetValue("Cognito:UserPoolId", out var userPoolId) || string.IsNullOrWhiteSpace(userPoolId))
        {
            return;
        }

        var region = overrides.TryGetValue("Cognito:Region", out var regionOverride) && !string.IsNullOrWhiteSpace(regionOverride)
            ? regionOverride
            : configuration["Cognito:Region"];

        if (string.IsNullOrWhiteSpace(region))
        {
            return;
        }

        overrides["Cognito:Issuer"] = $"https://cognito-idp.{region.Trim()}.amazonaws.com/{userPoolId.Trim()}";
    }

    private static void AddArray(IDictionary<string, string?> target, string prefix, string rawValue)
    {
        var values = rawValue
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToArray();

        for (var i = 0; i < values.Length; i++)
        {
            target[$"{prefix}:{i}"] = values[i];
        }
    }
}
