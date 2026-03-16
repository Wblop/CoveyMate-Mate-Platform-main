using System.Text;
using System.Text.Json;
using ConveyMate.Api.Security;

namespace ConveyMate.Api.Tests;

public sealed class StubSamlTokenCodecTests
{
    [Fact]
    public void CanHandleAuthorizationHeader_Detects_StubSamlPrefix()
    {
        Assert.True(StubSamlTokenCodec.CanHandleAuthorizationHeader("Bearer stub-saml.payload.stub"));
        Assert.False(StubSamlTokenCodec.CanHandleAuthorizationHeader("Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature"));
    }

    [Fact]
    public void TryDecodeBearerToken_Returns_Payload_For_ValidToken()
    {
        var token = BuildBearerToken(new StubSamlTokenPayload
        {
            Sub = "stub-saml:test-user",
            Email = "buyer@example.com",
            Name = "Buyer Example",
            Groups = ["admins"],
            IsAdmin = true,
            Exp = DateTimeOffset.UtcNow.AddMinutes(30).ToUnixTimeSeconds()
        });

        var success = StubSamlTokenCodec.TryDecodeBearerToken(token, out var payload, out var failureReason);

        Assert.True(success);
        Assert.Equal(string.Empty, failureReason);
        Assert.Equal("stub-saml:test-user", payload.Sub);
        Assert.Equal("buyer@example.com", payload.Email);
        Assert.Equal("Buyer Example", payload.Name);
        Assert.Equal(["admins"], payload.Groups);
        Assert.True(payload.IsAdmin);
    }

    [Fact]
    public void TryDecodeBearerToken_Fails_For_ExpiredToken()
    {
        var token = BuildBearerToken(new StubSamlTokenPayload
        {
            Sub = "stub-saml:test-user",
            Email = "buyer@example.com",
            Name = "Buyer Example",
            Exp = DateTimeOffset.UtcNow.AddMinutes(-5).ToUnixTimeSeconds()
        });

        var success = StubSamlTokenCodec.TryDecodeBearerToken(token, out _, out var failureReason);

        Assert.False(success);
        Assert.Equal("The stub SAML bearer token has expired.", failureReason);
    }

    private static string BuildBearerToken(StubSamlTokenPayload payload)
    {
        var json = JsonSerializer.Serialize(payload);
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
        return $"Bearer stub-saml.{encoded}.stub";
    }
}
