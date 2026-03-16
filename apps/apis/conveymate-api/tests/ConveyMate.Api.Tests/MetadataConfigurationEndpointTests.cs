using System.Net;
using System.Text.Json;
using ConveyMate.Api.Tests.TestDoubles;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Integration tests validating the public metadata bootstrap endpoint contract.
/// </summary>
public sealed class MetadataConfigurationEndpointTests : IClassFixture<TestAppFactory>
{
    private readonly HttpClient client;

    public MetadataConfigurationEndpointTests(TestAppFactory factory)
    {
        client = factory.CreateClient();
    }

    [Fact]
    public async Task Returns_Only_Public_Metadata_Fields()
    {
        using var response = await client.GetAsync("/metadataconfiguration");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.ETag is not null);
        Assert.Equal("public", response.Headers.CacheControl?.ToString()?.Split(',')[0]);

        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        Assert.True(root.TryGetProperty("environment", out _));
        Assert.True(root.TryGetProperty("apiBaseUrl", out _));
        Assert.True(root.TryGetProperty("cacheTtlSeconds", out _));
        Assert.True(root.TryGetProperty("cognito", out var cognito));
        Assert.True(root.TryGetProperty("payments", out var payments));
        Assert.True(root.TryGetProperty("analytics", out var analytics));
        Assert.True(root.TryGetProperty("addressAutocomplete", out var addressAutocomplete));
        Assert.False(root.TryGetProperty("recaptcha", out _));

        Assert.True(cognito.TryGetProperty("region", out _));
        Assert.True(cognito.TryGetProperty("userPoolId", out _));
        Assert.True(cognito.TryGetProperty("appClientId", out _));
        Assert.True(cognito.TryGetProperty("issuer", out _));
        Assert.True(cognito.TryGetProperty("scopes", out _));
        Assert.True(cognito.TryGetProperty("hostedUi", out var hostedUi));
        Assert.True(hostedUi.TryGetProperty("domain", out _));
        Assert.True(hostedUi.TryGetProperty("redirectSignIn", out _));
        Assert.True(hostedUi.TryGetProperty("redirectSignOut", out _));
        Assert.True(hostedUi.TryGetProperty("supportedIdentityProviders", out _));
        Assert.True(payments.TryGetProperty("stripePublishableKey", out _));
        Assert.True(payments.TryGetProperty("priceAudCents", out _));
        Assert.True(payments.TryGetProperty("currency", out _));
        Assert.True(analytics.TryGetProperty("googleMeasurementId", out _));
        Assert.True(addressAutocomplete.TryGetProperty("provider", out _));

        Assert.DoesNotContain("secret", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("aws_access_key", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("private_key", body, StringComparison.OrdinalIgnoreCase);
    }
}
