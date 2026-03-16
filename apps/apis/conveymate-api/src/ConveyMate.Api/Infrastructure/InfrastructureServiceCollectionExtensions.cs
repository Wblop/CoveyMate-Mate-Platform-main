using Amazon;
using Amazon.Runtime;
using Amazon.Scheduler;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.SimpleEmailV2;
using Amazon.SQS;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Npgsql;
using ConveyMate.Api.Application.Auth.Abstractions;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Application.Admin.Abstractions;
using ConveyMate.Api.Application.Conveyancers.Abstractions;
using ConveyMate.Api.Application.Notifications.Abstractions;
using ConveyMate.Api.Application.Users.Abstractions;
using ConveyMate.Api.Configuration;
using ConveyMate.Api.Database;
using ConveyMate.Api.Infrastructure.Aws;
using ConveyMate.Api.Infrastructure.Audit;
using ConveyMate.Api.Infrastructure.Auth;
using ConveyMate.Api.Infrastructure.Email;
using ConveyMate.Api.Infrastructure.Payments;
using ConveyMate.Api.Infrastructure.Persistence.Audit;
using ConveyMate.Api.Application.Feedback;
using ConveyMate.Api.Infrastructure.Persistence.Conveyancers;
using ConveyMate.Api.Infrastructure.Persistence.Admin;
using ConveyMate.Api.Infrastructure.Persistence.Feedback;
using ConveyMate.Api.Infrastructure.Persistence.Notifications;
using ConveyMate.Api.Infrastructure.Persistence.QuoteRequests;
using ConveyMate.Api.Infrastructure.Persistence.Reviews;
using ConveyMate.Api.Infrastructure.Persistence.SeoEngine;
using ConveyMate.Api.Infrastructure.Persistence.Users;
using ConveyMate.Api.Application.Audit.Abstractions;
using ConveyMate.Api.Application.QuoteRequests.Abstractions;
using ConveyMate.Api.Application.SeoEngine.Abstractions;

namespace ConveyMate.Api.Infrastructure;

/// <summary>
/// Registers infrastructure dependencies (database, migrations, persistence adapters).
/// </summary>
public static class InfrastructureServiceCollectionExtensions
{
    public static IServiceCollection AddInfrastructureLayer(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddHttpContextAccessor();
        services.AddSingleton<NpgsqlDataSource>(serviceProvider =>
        {
            var databaseOptions = serviceProvider.GetRequiredService<IOptions<DatabaseOptions>>().Value;
            var dataSourceBuilder = new NpgsqlDataSourceBuilder(databaseOptions.Postgres);
            return dataSourceBuilder.Build();
        });

        services.AddSingleton<IMigrationScriptProvider, MigrationScriptProvider>();
        services.AddSingleton<IJournalSchemaInitializer, PostgresJournalSchemaInitializer>();
        services.AddSingleton<IDbUpUpgradeEngineFactory, DbUpUpgradeEngineFactory>();
        services.AddSingleton<IDatabaseMigrator, DbUpDatabaseMigrator>();
        services.AddScoped<IAuditRepository, AuditRepository>();
        services.AddScoped<IAuditTrail, AuditTrail>();
        services.AddScoped<IConveyancerDirectoryRepository, ConveyancerDirectoryRepository>();
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IAdminConsoleRepository, AdminConsoleRepository>();
        services.AddScoped<INotificationRepository, NotificationRepository>();
        services.AddScoped<IReviewJobRepository, ReviewJobRepository>();
        services.AddScoped<IFeedbackRepository, FeedbackRepository>();
        services.AddScoped<IQuoteRequestRepository, QuoteRequestRepository>();
        services.AddScoped<ISeoEngineRepository, SeoEngineRepository>();
        services.AddScoped<IStripePaymentService, StripePaymentService>();
        services.AddScoped<IReviewStorageService, ReviewStorageService>();
        services.AddScoped<ISeoEngineCommandPublisher, SeoEngineCommandPublisher>();
        services.AddScoped<ISeoEngineScheduler, SeoEngineScheduler>();
        services.AddScoped<IQuoteRequestEmailSender, QuoteRequestEmailSender>();
        services.AddHttpClient<ICognitoSignUpService, CognitoSignUpService>();

        services.AddSingleton<IAmazonS3>(serviceProvider =>
        {
            var awsOptions = ResolveAwsOptions(configuration, serviceProvider);
            if (awsOptions.UseLocalStack)
            {
                var clientConfig = new AmazonS3Config
                {
                    ServiceURL = awsOptions.LocalStackUrl,
                    ForcePathStyle = awsOptions.S3ForcePathStyle,
                    AuthenticationRegion = awsOptions.Region
                };

                return new AmazonS3Client(CreateLocalStackCredentials(awsOptions), clientConfig);
            }

            return new AmazonS3Client(ResolveRegionEndpoint(awsOptions.Region));
        });

        services.AddSingleton<IAmazonSQS>(serviceProvider =>
        {
            var awsOptions = ResolveAwsOptions(configuration, serviceProvider);
            if (awsOptions.UseLocalStack)
            {
                var clientConfig = new AmazonSQSConfig
                {
                    ServiceURL = awsOptions.LocalStackUrl,
                    AuthenticationRegion = awsOptions.Region
                };

                return new AmazonSQSClient(CreateLocalStackCredentials(awsOptions), clientConfig);
            }

            return new AmazonSQSClient(ResolveRegionEndpoint(awsOptions.Region));
        });

        services.AddSingleton<IAmazonSimpleEmailServiceV2>(serviceProvider =>
        {
            var awsOptions = ResolveAwsOptions(configuration, serviceProvider);
            if (awsOptions.UseLocalStack)
            {
                var clientConfig = new AmazonSimpleEmailServiceV2Config
                {
                    ServiceURL = awsOptions.LocalStackUrl,
                    AuthenticationRegion = awsOptions.Region
                };

                return new AmazonSimpleEmailServiceV2Client(CreateLocalStackCredentials(awsOptions), clientConfig);
            }

            return new AmazonSimpleEmailServiceV2Client(ResolveRegionEndpoint(awsOptions.Region));
        });

        services.AddSingleton<IAmazonScheduler>(serviceProvider =>
        {
            var awsOptions = ResolveAwsOptions(configuration, serviceProvider);
            if (awsOptions.UseLocalStack)
            {
                var clientConfig = new AmazonSchedulerConfig
                {
                    ServiceURL = awsOptions.LocalStackUrl,
                    AuthenticationRegion = awsOptions.Region
                };

                return new AmazonSchedulerClient(CreateLocalStackCredentials(awsOptions), clientConfig);
            }

            return new AmazonSchedulerClient(ResolveRegionEndpoint(awsOptions.Region));
        });

        return services;
    }

    private static AwsServiceOptions ResolveAwsOptions(IConfiguration configuration, IServiceProvider serviceProvider)
    {
        var configured = serviceProvider.GetService<IOptions<AwsServiceOptions>>()?.Value ?? new AwsServiceOptions();

        var region = configured.Region;
        if (string.IsNullOrWhiteSpace(region))
        {
            region = configuration["AWS:Region"]
                     ?? Environment.GetEnvironmentVariable("AWS_REGION")
                     ?? Environment.GetEnvironmentVariable("AWS_DEFAULT_REGION")
                     ?? configuration["Cognito:Region"]
                     ?? "ap-southeast-2";
        }

        return new AwsServiceOptions
        {
            Region = region,
            UseLocalStack = configured.UseLocalStack,
            LocalStackUrl = string.IsNullOrWhiteSpace(configured.LocalStackUrl) ? "http://localhost:4566" : configured.LocalStackUrl,
            AccessKeyId = string.IsNullOrWhiteSpace(configured.AccessKeyId) ? "test" : configured.AccessKeyId,
            SecretAccessKey = string.IsNullOrWhiteSpace(configured.SecretAccessKey) ? "test" : configured.SecretAccessKey,
            S3ForcePathStyle = configured.S3ForcePathStyle
        };
    }

    private static RegionEndpoint ResolveRegionEndpoint(string region)
    {
        var endpoint = RegionEndpoint.GetBySystemName(region);
        return endpoint ?? RegionEndpoint.APSoutheast2;
    }

    private static AWSCredentials CreateLocalStackCredentials(AwsServiceOptions awsOptions)
    {
        return new BasicAWSCredentials(awsOptions.AccessKeyId, awsOptions.SecretAccessKey);
    }
}
