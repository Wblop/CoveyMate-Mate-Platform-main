using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Configuration;
using ConveyMate.Api.Infrastructure.Auth;

namespace ConveyMate.Api.Tests;

public sealed class CognitoSignUpServiceTests
{
    [Fact]
    public async Task SignUpAsync_Sends_PascalCase_Cognito_Request_Payload()
    {
        string? capturedBody = null;

        using var httpClient = new HttpClient(new StubHttpMessageHandler(request =>
        {
            capturedBody = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"UserConfirmed\":true}", Encoding.UTF8, "application/x-amz-json-1.1")
            };
        }));
        var service = CreateService(httpClient);

        var result = await service.SignUpAsync(
            "Alice Example",
            "user@example.com",
            "StrongPassword123!",
            CancellationToken.None);

        Assert.False(result.IsError);
        Assert.True(result.Value.UserConfirmed);
        Assert.NotNull(capturedBody);

        using var document = JsonDocument.Parse(capturedBody);
        Assert.True(document.RootElement.TryGetProperty("ClientId", out var clientId));
        Assert.Equal("app-client-id", clientId.GetString());
        Assert.True(document.RootElement.TryGetProperty("Username", out var username));
        Assert.Equal("user@example.com", username.GetString());
        Assert.True(document.RootElement.TryGetProperty("UserAttributes", out var userAttributes));
        Assert.Equal(JsonValueKind.Array, userAttributes.ValueKind);
        Assert.False(document.RootElement.TryGetProperty("clientId", out _));
        Assert.False(document.RootElement.TryGetProperty("username", out _));
    }

    [Theory]
    [InlineData(
        "{\"message\":\"User already exists\",\"__type\":\"UsernameExistsException\"}",
        "That email address is already registered.")]
    [InlineData(
        "{\"Message\":\"Password did not conform with policy\",\"__type\":\"com.amazon.coral.service#InvalidPasswordException\"}",
        "Use a stronger password.")]
    public async Task SignUpAsync_Maps_Cognito_Error_Payloads(string responseBody, string expectedMessage)
    {
        using var httpClient = new HttpClient(new StubHttpMessageHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.BadRequest)
            {
                Content = new StringContent(responseBody, Encoding.UTF8, "application/x-amz-json-1.1")
            }));
        var service = CreateService(httpClient);

        var result = await service.SignUpAsync(
            "Alice Example",
            "user@example.com",
            "StrongPassword123!",
            CancellationToken.None);

        Assert.True(result.IsError);
        Assert.Equal(expectedMessage, result.FirstError.Description);
    }

    private sealed class StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(responseFactory(request));
    }

    private static CognitoSignUpService CreateService(HttpClient httpClient)
        => new(
            httpClient,
            Options.Create(new CognitoOptions
            {
                Region = "ap-southeast-2",
                AppClientId = "app-client-id",
                UserPoolId = "user-pool-id",
                Issuer = "https://issuer.example.com"
            }));
}
