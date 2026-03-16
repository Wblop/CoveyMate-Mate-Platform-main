using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using ConveyMate.Api.Application.Auth.Abstractions;
using ConveyMate.Api.Tests.TestDoubles;

namespace ConveyMate.Api.Tests;

public sealed class AuthEndpointsTests : IClassFixture<TestAppFactory>
{
    private readonly TestAppFactory factory;
    private readonly HttpClient client;

    public AuthEndpointsTests(TestAppFactory factory)
    {
        this.factory = factory;
        client = factory.CreateClient();
        factory.CognitoSignUpService.Reset();
    }

    [Fact]
    public async Task SignUp_Creates_Account()
    {
        factory.CognitoSignUpService.NextResult = new CognitoSignUpResult(false);

        using var response = await client.PostAsJsonAsync("/api/auth/sign-up", new
        {
            fullName = "Alice Example",
            email = "USER@example.com",
            password = "StrongPassword123!"
        });

        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<PublicSignUpResponseDto>();
        Assert.NotNull(payload);
        Assert.False(payload.UserConfirmed);
        Assert.Equal("Alice Example", factory.CognitoSignUpService.LastFullName);
        Assert.Equal("user@example.com", factory.CognitoSignUpService.LastEmail);
        Assert.Equal("StrongPassword123!", factory.CognitoSignUpService.LastPassword);
    }

    [Fact]
    public async Task SignUp_Returns_BadRequest_For_Invalid_Request()
    {
        using var response = await client.PostAsJsonAsync("/api/auth/sign-up", new
        {
            fullName = "",
            email = "user@example.com",
            password = "StrongPassword123!"
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.NotNull(payload);
        Assert.Equal("Registration failed.", payload.Title);
        Assert.Contains("Enter your full name.", payload.Detail, StringComparison.Ordinal);
        Assert.Null(factory.CognitoSignUpService.LastEmail);
    }

    private sealed record PublicSignUpResponseDto(bool UserConfirmed);
}
