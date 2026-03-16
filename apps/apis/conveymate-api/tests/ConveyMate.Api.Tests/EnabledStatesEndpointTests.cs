using System.Net;
using System.Text.Json;
using ConveyMate.Api.Tests.TestDoubles;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Integration tests for frontend jurisdiction availability endpoint.
/// </summary>
public sealed class EnabledStatesEndpointTests : IClassFixture<TestAppFactory>
{
    private readonly HttpClient client;

    public EnabledStatesEndpointTests(TestAppFactory factory)
    {
        client = factory.CreateClient();
    }

    [Fact]
    public async Task Returns_Enabled_States_Derived_From_Configured_Collections()
    {
        using var response = await client.GetAsync("/api/config/enabled-states");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        var defaultState = root.GetProperty("defaultState").GetString();
        Assert.Equal("ACT", defaultState);

        var supportedStates = root.GetProperty("supportedStates").EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToArray();
        Assert.Contains("ACT", supportedStates);
        Assert.Contains("NSW", supportedStates);

        var enabledStates = root.GetProperty("enabledStates").EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToArray();
        Assert.Equal(["ACT"], enabledStates);
    }
}
