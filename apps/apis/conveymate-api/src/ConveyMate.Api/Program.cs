using Carter;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using ConveyMate.Api.Application;
using ConveyMate.Api.Configuration;
using ConveyMate.Api.Database;
using ConveyMate.Api.Infrastructure;
using ConveyMate.Api.Logging;
using ConveyMate.Api.Security;
using Serilog;
using Serilog.Events;

const string CorsPolicyName = "conveymate-default";
const string CompositeBearerScheme = "ConveyMateBearer";

Log.Logger = ApiSerilogConfiguration.CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.WebHost.ConfigureKestrel(kestrel =>
    {
        kestrel.AddServerHeader = false;
        kestrel.Limits.MaxRequestBodySize = 10 * 1024 * 1024; // 10 MB
    });

    // Bootstrap logger is intentionally lightweight because full logging configuration may be overridden from SSM.
    using var bootstrapLoggerFactory = LoggerFactory.Create(logging =>
    {
        logging.ClearProviders();
        logging.AddSerilog(Log.Logger, dispose: false);
    });

    var ssmConfigurationLoader = new SsmConfigurationLoader(
        builder.Configuration,
        builder.Configuration,
        builder.Environment,
        bootstrapLoggerFactory.CreateLogger<SsmConfigurationLoader>());

    await ssmConfigurationLoader.LoadOverridesAsync(CancellationToken.None);

    builder.Logging.ClearProviders();
    builder.Host.UseSerilog((context, _, loggerConfiguration) =>
    {
        ApiSerilogConfiguration.Configure(loggerConfiguration, context.Configuration, context.HostingEnvironment.EnvironmentName);
    });

    // Bind typed options. Core platform settings fail fast at startup; pipeline-only settings validate when invoked.
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddOpenApi();
    builder.Services.AddCarter();

    builder.Services
        .AddOptions<DatabaseOptions>()
        .Bind(builder.Configuration.GetSection(DatabaseOptions.SectionName))
        .ValidateDataAnnotations()
        .Validate(options => !string.IsNullOrWhiteSpace(options.Postgres), "ConnectionStrings:Postgres must be configured.")
        .ValidateOnStart();

    builder.Services
        .AddOptions<CognitoOptions>()
        .Bind(builder.Configuration.GetSection(CognitoOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();

    builder.Services
        .AddOptions<PublicMetadataOptions>()
        .Bind(builder.Configuration.GetSection(PublicMetadataOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();

    builder.Services
        .AddOptions<ConveyancerDirectoryCacheOptions>()
        .Bind(builder.Configuration.GetSection(ConveyancerDirectoryCacheOptions.SectionName))
        .ValidateDataAnnotations()
        .ValidateOnStart();

    builder.Services
        .AddOptions<CorsOptions>()
        .Bind(builder.Configuration.GetSection(CorsOptions.SectionName))
        .ValidateOnStart();

    builder.Services
        .AddOptions<AwsServiceOptions>()
        .Bind(builder.Configuration.GetSection(AwsServiceOptions.SectionName));

    builder.Services
        .AddOptions<StripeOptions>()
        .Bind(builder.Configuration.GetSection(StripeOptions.SectionName))
        .ValidateDataAnnotations();

    builder.Services
        .AddOptions<ReviewPipelineOptions>()
        .Bind(builder.Configuration.GetSection(ReviewPipelineOptions.SectionName))
        .ValidateDataAnnotations();

    builder.Services
        .AddOptions<QuoteRequestEmailOptions>()
        .Bind(builder.Configuration.GetSection(QuoteRequestEmailOptions.SectionName))
        .ValidateDataAnnotations()
        .Validate(options =>
        {
            var mode = (options.Mode ?? string.Empty).Trim().ToLowerInvariant();
            if (mode is not ("log" or "ses" or "smtp"))
            {
                return false;
            }

            if (mode == "log")
            {
                return true;
            }

            if (string.IsNullOrWhiteSpace(options.FromEmail) || options.RequestExpiryHours <= 0)
            {
                return false;
            }

            if (mode == "ses")
            {
                return !options.EnableSes || !string.IsNullOrWhiteSpace(options.TestAddress);
            }

            return !string.IsNullOrWhiteSpace(options.SmtpHost);
        }, "QuoteRequestEmail configuration is invalid.");

    builder.Services
        .AddOptions<GrokOptions>()
        .Bind(builder.Configuration.GetSection(GrokOptions.SectionName))
        .ValidateDataAnnotations();

    builder.Services
        .AddOptions<SeoEngineAutomationOptions>()
        .Bind(builder.Configuration.GetSection(SeoEngineAutomationOptions.SectionName))
        .Validate(options => !options.Enabled || !string.IsNullOrWhiteSpace(options.CommandQueueUrl),
            "SeoEngineAutomation:CommandQueueUrl must be configured when SeoEngineAutomation:Enabled is true.")
        .ValidateOnStart();

    builder.Services
        .AddOptions<EmbeddingsOptions>()
        .Bind(builder.Configuration.GetSection(EmbeddingsOptions.SectionName))
        .ValidateDataAnnotations();

    builder.Services.AddApplicationLayer();
    builder.Services.AddInfrastructureLayer(builder.Configuration);
    builder.Services.AddHttpClient();
    builder.Services.AddMemoryCache();

    var cognitoOptions = builder.Configuration.GetSection(CognitoOptions.SectionName).Get<CognitoOptions>()
        ?? throw new InvalidOperationException("Cognito configuration is missing.");
    var enableStubSamlAuth = builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Local");

    var authenticationBuilder = builder.Services.AddAuthentication(options =>
    {
        var defaultScheme = enableStubSamlAuth ? CompositeBearerScheme : JwtBearerDefaults.AuthenticationScheme;
        options.DefaultAuthenticateScheme = defaultScheme;
        options.DefaultChallengeScheme = defaultScheme;
        options.DefaultScheme = defaultScheme;
    });

    if (enableStubSamlAuth)
    {
        authenticationBuilder.AddPolicyScheme(CompositeBearerScheme, CompositeBearerScheme, options =>
        {
            options.ForwardDefaultSelector = context =>
            {
                var authorizationHeader = context.Request.Headers.Authorization.ToString();
                return StubSamlTokenCodec.CanHandleAuthorizationHeader(authorizationHeader)
                    ? StubSamlTokenCodec.SchemeName
                    : JwtBearerDefaults.AuthenticationScheme;
            };
        });

        authenticationBuilder.AddScheme<AuthenticationSchemeOptions, StubSamlAuthenticationHandler>(StubSamlTokenCodec.SchemeName, _ => { });
    }

    authenticationBuilder.AddJwtBearer(options =>
        {
            options.MapInboundClaims = false;
            options.Authority = cognitoOptions.Issuer;
            options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = cognitoOptions.Issuer,
                ValidateAudience = true,
                ValidAudience = cognitoOptions.AppClientId,
                ValidateIssuerSigningKey = true,
                ValidateLifetime = true,
                NameClaimType = "name",
                RoleClaimType = "cognito:groups"
            };
            options.Events = new JwtBearerEvents
            {
                OnAuthenticationFailed = context =>
                {
                    Log.ForContext("SourceContext", "JwtBearer")
                        .ForContext("event", "jwt_authentication_failed")
                        .ForContext("requestId", context.HttpContext.TraceIdentifier)
                        .Warning(context.Exception, "JWT authentication failed.");
                    return Task.CompletedTask;
                }
            };
        });

    builder.Services.AddAuthorization(options =>
    {
        options.AddPolicy(AuthorizationPolicies.Admin, policy =>
        {
            policy.RequireAuthenticatedUser();
            policy.Requirements.Add(new AdminAccessRequirement());
        });
    });
    builder.Services.AddScoped<IAuthorizationHandler, AdminAccessAuthorizationHandler>();

    // CORS policy is validated to disallow wildcard origins in all environments.
    builder.Services.AddCors(options =>
    {
        options.AddPolicy(CorsPolicyName, policy =>
        {
            var allowLocalLoopbackOrigins = builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Local");
            var corsOptions = builder.Configuration.GetSection(CorsOptions.SectionName).Get<CorsOptions>() ?? new CorsOptions();
            var allowedOrigins = corsOptions.AllowedOrigins
                .Where(origin => !string.IsNullOrWhiteSpace(origin))
                .Select(NormalizeOrigin)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (allowedOrigins.Length == 0)
            {
                throw new InvalidOperationException("Cors:AllowedOrigins must contain at least one origin.");
            }

            if (allowedOrigins.Any(origin => origin == "*" || origin.Contains('*', StringComparison.Ordinal)))
            {
                throw new InvalidOperationException("Wildcard CORS origins are not allowed.");
            }

            var allowedOriginSet = new HashSet<string>(allowedOrigins, StringComparer.OrdinalIgnoreCase);
            policy.SetIsOriginAllowed(origin =>
                allowedOriginSet.Contains(NormalizeOrigin(origin)) ||
                (allowLocalLoopbackOrigins && IsLoopbackHttpOrigin(origin)))
                .WithHeaders("Authorization", "Content-Type", "Accept")
                .WithMethods("GET", "POST", "DELETE", "OPTIONS");
        });
    });

    var app = builder.Build();

    // Database migrations run before request handling to guarantee schema compatibility.
    await RunMigrationsAsync(app);

    if (app.Environment.IsDevelopment() || app.Environment.IsEnvironment("Local"))
    {
        app.MapOpenApi();
    }

    app.UseSerilogRequestLogging(options =>
    {
        options.MessageTemplate = "HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0000} ms";
        options.GetLevel = (httpContext, _, exception) =>
        {
            if (exception is not null || httpContext.Response.StatusCode >= StatusCodes.Status500InternalServerError)
            {
                return LogEventLevel.Error;
            }

            return httpContext.Response.StatusCode >= StatusCodes.Status400BadRequest
                ? LogEventLevel.Warning
                : LogEventLevel.Information;
        };
        options.EnrichDiagnosticContext = ApiSerilogConfiguration.EnrichRequest;
    });

    app.UseConveyMateSecurityHeaders(app.Environment);
    app.UseCors(CorsPolicyName);
    app.UseAuthentication();
    app.UseConveyMateSuspensionGate();
    app.UseAuthorization();

    app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

    app.MapCarter();

    app.MapGet("/", () => Results.Ok(new
    {
        service = "ConveyMate.Api",
        environment = app.Environment.EnvironmentName,
        timestampUtc = DateTimeOffset.UtcNow
    })).AllowAnonymous();

    app.Run();
}
finally
{
    Log.CloseAndFlush();
}

static async Task RunMigrationsAsync(WebApplication app)
{
    await using var scope = app.Services.CreateAsyncScope();
    var migrator = scope.ServiceProvider.GetRequiredService<IDatabaseMigrator>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup.Migrations");

    try
    {
        await migrator.MigrateAsync(CancellationToken.None);
    }
    catch (Exception error)
    {
        logger.LogCritical(error, "Database migration failed during startup.");
        throw;
    }
}

static string NormalizeOrigin(string origin)
{
    return origin.Trim().TrimEnd('/');
}

static bool IsLoopbackHttpOrigin(string origin)
{
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
    {
        return false;
    }

    if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
        !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
    {
        return false;
    }

    return uri.IsLoopback
        || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase)
        || string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase)
        || string.Equals(uri.Host, "::1", StringComparison.OrdinalIgnoreCase);
}

public partial class Program;
