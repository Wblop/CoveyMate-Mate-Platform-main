using System.Net;
using System.Net.Http.Json;
using ConveyMate.Api.Application.Users.Contracts;
using ConveyMate.Api.Tests.TestDoubles;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Integration tests for authenticated /user/userinfo behaviour.
/// </summary>
public sealed class UserInfoEndpointTests : IClassFixture<TestAppFactory>
{
    private readonly TestAppFactory factory;
    private readonly HttpClient client;

    public UserInfoEndpointTests(TestAppFactory factory)
    {
        this.factory = factory;
        client = factory.CreateClient();
    }

    [Fact]
    public async Task Requires_Authentication()
    {
        using var response = await client.GetAsync("/user/userinfo");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Extracts_Claims_And_Persists_User_When_Missing()
    {
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.Add("Authorization", "Test");
        client.DefaultRequestHeaders.Remove("x-test-sub");
        client.DefaultRequestHeaders.Remove("x-test-email");
        client.DefaultRequestHeaders.Remove("x-test-name");
        client.DefaultRequestHeaders.Add("x-test-sub", "cognito-sub-001");
        client.DefaultRequestHeaders.Add("x-test-email", "buyer@conveymate.test");
        client.DefaultRequestHeaders.Add("x-test-name", "Casey Buyer");

        using var response = await client.GetAsync("/user/userinfo");
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<UserInfoDto>();
        Assert.NotNull(payload);
        Assert.Equal("Casey Buyer", payload.FullName);
        Assert.Equal("buyer@conveymate.test", payload.Email);
        Assert.NotEqual(Guid.Empty, payload.Id);

        Assert.Equal(1, factory.UserRepository.UpsertCalls);

        using var secondResponse = await client.GetAsync("/user/userinfo");
        secondResponse.EnsureSuccessStatusCode();

        var secondPayload = await secondResponse.Content.ReadFromJsonAsync<UserInfoDto>();
        Assert.NotNull(secondPayload);
        Assert.Equal(payload.Id, secondPayload.Id);
        Assert.Equal(1, factory.UserRepository.UpsertCalls);
    }
}
