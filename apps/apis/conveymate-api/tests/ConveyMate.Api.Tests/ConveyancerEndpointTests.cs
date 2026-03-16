using System.Net;
using System.Net.Http.Json;
using ConveyMate.Api.Application.Conveyancers.Contracts;
using ConveyMate.Api.Tests.TestDoubles;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Integration tests for authenticated conveyancer directory endpoint.
/// </summary>
public sealed class ConveyancerEndpointTests : IClassFixture<TestAppFactory>
{
    private readonly HttpClient client;

    public ConveyancerEndpointTests(TestAppFactory factory)
    {
        client = factory.CreateClient();
    }

    [Fact]
    public async Task Requires_Authentication()
    {
        using var response = await client.GetAsync("/api/conveyancers?jurisdiction=ACT");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Returns_Active_Conveyancers_For_Jurisdiction_Ordered_By_Name()
    {
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.Add("Authorization", "Test");

        using var response = await client.GetAsync("/api/conveyancers?jurisdiction=ACT");
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<ConveyancerDirectoryPageDto>();
        Assert.NotNull(payload);
        Assert.Equal(2, payload.TotalCount);
        Assert.Equal(1, payload.Page);
        Assert.Equal(24, payload.PageSize);
        Assert.Equal(2, payload.Items.Count);
        Assert.Equal("Alpha Conveyancing", payload.Items[0].Name);
        Assert.Equal("Alpha Conveyancing", payload.Items[0].OrganizationName);
        Assert.Null(payload.Items[0].ContactName);
        Assert.Equal("Beta Legal", payload.Items[1].Name);
        Assert.Equal("Beta Legal", payload.Items[1].OrganizationName);
        Assert.Null(payload.Items[1].ContactName);
        Assert.All(payload.Items, item => Assert.Equal("ACT", item.Jurisdiction));
        Assert.Contains("law_society", payload.RegulatorTypes);
        Assert.Contains("licence_register", payload.RegulatorTypes);
    }

    [Fact]
    public async Task Applies_Pagination_And_Search_Query()
    {
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.Add("Authorization", "Test");

        using var response = await client.GetAsync("/api/conveyancers?jurisdiction=ACT&page=2&pageSize=1&q=legal");
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<ConveyancerDirectoryPageDto>();
        Assert.NotNull(payload);
        Assert.Equal(1, payload.TotalCount);
        Assert.Equal(2, payload.Page);
        Assert.Equal(1, payload.PageSize);
        Assert.Empty(payload.Items);
    }

    [Fact]
    public async Task Returns_BadRequest_For_Invalid_Jurisdiction()
    {
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.Add("Authorization", "Test");

        using var response = await client.GetAsync("/api/conveyancers?jurisdiction=BAD");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
