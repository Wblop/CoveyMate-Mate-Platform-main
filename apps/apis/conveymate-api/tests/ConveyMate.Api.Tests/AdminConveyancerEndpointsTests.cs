using System.Net;
using System.Net.Http.Json;
using ConveyMate.Api.Application.Admin.Contracts;
using ConveyMate.Api.Domain.Users;
using ConveyMate.Api.Tests.TestDoubles;

namespace ConveyMate.Api.Tests;

public sealed class AdminConveyancerEndpointsTests : IClassFixture<TestAppFactory>
{
    private readonly TestAppFactory factory;
    private readonly HttpClient client;

    public AdminConveyancerEndpointsTests(TestAppFactory factory)
    {
        this.factory = factory;
        client = factory.CreateClient();
        factory.UserRepository.Reset();
        factory.ConveyancerDirectoryRepository.Reset();
    }

    [Fact]
    public async Task Admin_Can_List_Create_And_Edit_Conveyancers()
    {
        SeedAdminUser("admin-sub", "admin@conveymate.test", "Admin User");
        SetAdminHeaders("admin-sub", "admin@conveymate.test", "Admin User");

        using var listResponse = await client.GetAsync("/api/admin/conveyancers");
        listResponse.EnsureSuccessStatusCode();

        var listed = await listResponse.Content.ReadFromJsonAsync<AdminConveyancersPageDto>();
        Assert.NotNull(listed);
        Assert.Equal(3, listed.TotalCount);

        using var createResponse = await client.PostAsJsonAsync("/api/admin/conveyancers", new
        {
            jurisdiction = "QLD",
            organizationName = "Harbour Conveyancing",
            contactName = "Morgan Lee",
            address = "15 Wharf St, Brisbane QLD",
            phone = "(07) 1234 5678",
            email = "hello@harbour.example.com",
            website = "harbour.example.com",
            areasOfPractice = new[] { "Conveyancing", "Property law" },
            quoteRequestsEnabled = true
        });
        createResponse.EnsureSuccessStatusCode();

        var created = await createResponse.Content.ReadFromJsonAsync<AdminConveyancerDto>();
        Assert.NotNull(created);
        Assert.Equal("QLD", created.Jurisdiction);
        Assert.Equal("manual", created.RegulatorType);
        Assert.Equal("Harbour Conveyancing", created.OrganizationName);
        Assert.True(created.QuoteRequestsEnabled);

        using var updateResponse = await client.PutAsJsonAsync($"/api/admin/conveyancers/{created.Id}", new
        {
            organizationName = "Harbour Conveyancing Group",
            contactName = "Morgan Lee",
            address = "22 Wharf St, Brisbane QLD",
            phone = "(07) 9999 0000",
            email = "quotes@harbour.example.com",
            website = "quotes.harbour.example.com",
            areasOfPractice = new[] { "Conveyancing", "Property law", "Settlement support" },
            quoteRequestsEnabled = false
        });
        updateResponse.EnsureSuccessStatusCode();

        var updated = await updateResponse.Content.ReadFromJsonAsync<AdminConveyancerDto>();
        Assert.NotNull(updated);
        Assert.Equal(created.Id, updated.Id);
        Assert.Equal("Harbour Conveyancing Group", updated.OrganizationName);
        Assert.Equal("quotes@harbour.example.com", updated.Email);
        Assert.Equal("quotes.harbour.example.com", updated.Website);
        Assert.Equal("https://quotes.harbour.example.com", updated.SourceUrl);
        Assert.False(updated.QuoteRequestsEnabled);
        Assert.NotNull(updated.QuoteRequestsDisabledAtUtc);
        Assert.Contains("Settlement support", updated.AreasOfPractice);
    }

    [Fact]
    public async Task Admin_Conveyancer_Endpoints_Reject_Non_Admin_Users()
    {
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.Remove("x-test-sub");
        client.DefaultRequestHeaders.Remove("x-test-email");
        client.DefaultRequestHeaders.Remove("x-test-name");
        client.DefaultRequestHeaders.Add("Authorization", "Test");
        client.DefaultRequestHeaders.Add("x-test-sub", "standard-sub");
        client.DefaultRequestHeaders.Add("x-test-email", "user@conveymate.test");
        client.DefaultRequestHeaders.Add("x-test-name", "Standard User");

        using var response = await client.GetAsync("/api/admin/conveyancers");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private void SeedAdminUser(string sub, string email, string fullName)
    {
        var now = DateTimeOffset.UtcNow;
        factory.UserRepository.Seed(new AppUser(
            Guid.NewGuid(),
            sub,
            email,
            fullName,
            IsAdmin: true,
            IsSuspended: false,
            LastLoginAt: now,
            CreatedAt: now,
            UpdatedAt: now));
    }

    private void SetAdminHeaders(string sub, string email, string fullName)
    {
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.Remove("x-test-sub");
        client.DefaultRequestHeaders.Remove("x-test-email");
        client.DefaultRequestHeaders.Remove("x-test-name");
        client.DefaultRequestHeaders.Add("Authorization", "Test");
        client.DefaultRequestHeaders.Add("x-test-sub", sub);
        client.DefaultRequestHeaders.Add("x-test-email", email);
        client.DefaultRequestHeaders.Add("x-test-name", fullName);
    }
}
