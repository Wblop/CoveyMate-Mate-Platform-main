using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ErrorOr;
using MediatR;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.Metadata.Contracts;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Application.Metadata.Queries;

/// <summary>
/// Produces deterministic, cacheable runtime metadata payloads for public frontend bootstrap.
/// </summary>
public sealed class GetMetadataConfigurationQueryHandler(
    IHostEnvironment environment,
    IOptions<CognitoOptions> cognitoOptions,
    IOptions<StripeOptions> stripeOptions,
    IOptions<ReviewPipelineOptions> reviewPipelineOptions,
    IOptions<PublicMetadataOptions> metadataOptions)
    : IGetMetadataConfigurationQueryHandler,
      IRequestHandler<GetMetadataConfigurationQuery, ErrorOr<GetMetadataConfigurationQueryResult>>
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public GetMetadataConfigurationQueryResult Handle(string? ifNoneMatchHeader)
    {
        var cognito = cognitoOptions.Value;
        var stripe = stripeOptions.Value;
        var reviewPipeline = reviewPipelineOptions.Value;
        var metadata = metadataOptions.Value;

        var payload = new MetadataConfigurationResponse(
            environment.EnvironmentName,
            NormalizePublicApiBaseUrl(metadata.ApiBaseUrl),
            new MetadataCognitoConfiguration(
                cognito.Region,
                cognito.UserPoolId,
                cognito.AppClientId,
                cognito.Issuer,
                cognito.Scopes
                    .Where(scope => !string.IsNullOrWhiteSpace(scope))
                    .Select(scope => scope.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray(),
                new MetadataCognitoHostedUiConfiguration(
                    string.IsNullOrWhiteSpace(cognito.HostedUiDomain) ? string.Empty : cognito.HostedUiDomain.Trim().TrimEnd('/'),
                    string.IsNullOrWhiteSpace(cognito.RedirectSignIn) ? string.Empty : cognito.RedirectSignIn.Trim(),
                    string.IsNullOrWhiteSpace(cognito.RedirectSignOut) ? string.Empty : cognito.RedirectSignOut.Trim(),
                    cognito.SupportedIdentityProviders
                        .Where(provider => !string.IsNullOrWhiteSpace(provider))
                        .Select(provider => provider.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToArray())),
            new MetadataPaymentsConfiguration(
                stripe.PublishableKey,
                stripe.PriceAudCents,
                "aud"),
            new MetadataAnalyticsConfiguration(
                string.IsNullOrWhiteSpace(metadata.GoogleAnalyticsMeasurementId)
                    ? string.Empty
                    : metadata.GoogleAnalyticsMeasurementId.Trim()),
            new MetadataJurisdictionConfiguration(
                string.IsNullOrWhiteSpace(reviewPipeline.DefaultState) ? "ACT" : reviewPipeline.DefaultState.Trim().ToUpperInvariant(),
                ["ACT", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT"]),
            new MetadataAddressAutocompleteConfiguration(
                string.IsNullOrWhiteSpace(metadata.AddressAutocompleteProvider)
                    ? PublicMetadataOptions.NominatimProvider
                    : metadata.AddressAutocompleteProvider.Trim().ToLowerInvariant()),
            metadata.CacheTtlSeconds);

        var json = JsonSerializer.Serialize(payload, SerializerOptions);
        var etag = BuildEtag(json);
        var notModified = HeaderContainsEtag(ifNoneMatchHeader, etag);

        return new GetMetadataConfigurationQueryResult(
            json,
            etag,
            $"public, max-age={metadata.CacheTtlSeconds}",
            notModified);
    }

    private static string NormalizePublicApiBaseUrl(string? apiBaseUrl)
    {
        if (string.IsNullOrWhiteSpace(apiBaseUrl))
        {
            return "/";
        }

        var trimmed = apiBaseUrl.Trim();
        if (trimmed == "/")
        {
            return "/";
        }

        return trimmed.TrimEnd('/');
    }

    private static bool HeaderContainsEtag(string? ifNoneMatchHeader, string etag)
    {
        if (string.IsNullOrWhiteSpace(ifNoneMatchHeader))
        {
            return false;
        }

        return ifNoneMatchHeader
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Any(value => string.Equals(value, etag, StringComparison.Ordinal));
    }

    private static string BuildEtag(string json)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return $"\"{Convert.ToHexString(hash)}\"";
    }

    public Task<ErrorOr<GetMetadataConfigurationQueryResult>> Handle(GetMetadataConfigurationQuery request, CancellationToken cancellationToken)
    {
        return Task.FromResult<ErrorOr<GetMetadataConfigurationQueryResult>>(Handle(request.IfNoneMatchHeader));
    }
}
