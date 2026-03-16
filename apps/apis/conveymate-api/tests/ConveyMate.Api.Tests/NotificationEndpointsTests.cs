using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using ConveyMate.Api.Application.Notifications.Contracts;
using ConveyMate.Api.Domain.Users;
using ConveyMate.Api.Tests.TestDoubles;

namespace ConveyMate.Api.Tests;

public sealed class NotificationEndpointsTests : IClassFixture<TestAppFactory>
{
    private readonly TestAppFactory factory;
    private readonly HttpClient client;

    public NotificationEndpointsTests(TestAppFactory factory)
    {
        this.factory = factory;
        client = factory.CreateClient();
        factory.UserRepository.Reset();
        factory.NotificationRepository.Reset();
    }

    [Fact]
    public async Task Public_Endpoint_Returns_Enabled_Notifications_For_Surface()
    {
        var now = DateTimeOffset.UtcNow;
        factory.NotificationRepository.Seed(
            new(Guid.Parse("10000000-0000-0000-0000-000000000001"), "Public site notice", "info", "public", true, now, now),
            new(Guid.Parse("10000000-0000-0000-0000-000000000002"), "Dashboard notice", "info", "dashboard", true, now.AddMinutes(-1), now.AddMinutes(-1)),
            new(Guid.Parse("10000000-0000-0000-0000-000000000003"), "Everywhere notice", "warning", "both", true, now.AddMinutes(-2), now.AddMinutes(-2)),
            new(Guid.Parse("10000000-0000-0000-0000-000000000004"), "Disabled notice", "info", "dashboard", false, now, now));

        using var response = await client.GetAsync("/api/notifications?surface=dashboard");
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<List<SiteNotificationDto>>();
        Assert.NotNull(payload);
        Assert.Equal(1, payload.Count(notification => notification.Audience == "dashboard"));
        Assert.Contains(payload, notification => notification.Audience == "both");
        Assert.DoesNotContain(payload, notification => notification.Audience == "public");
        Assert.DoesNotContain(payload, notification => notification.Message == "Disabled notice");
    }

    [Fact]
    public async Task Public_Endpoint_Returns_BadRequest_For_Invalid_Surface()
    {
        using var response = await client.GetAsync("/api/notifications?surface=internal");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.NotNull(payload);
        Assert.Equal("Invalid notification surface.", payload.Title);
    }

    [Fact]
    public async Task Admin_Can_Create_And_List_Notifications()
    {
        SeedAdminUser("admin-sub", "admin@conveymate.test", "Admin User");
        SetAdminHeaders("admin-sub", "admin@conveymate.test", "Admin User");

        using var createResponse = await client.PostAsJsonAsync("/api/admin/notifications", new
        {
            message = "Dashboard maintenance window tonight.",
            tone = "warning",
            audience = "dashboard",
            isEnabled = true
        });
        createResponse.EnsureSuccessStatusCode();

        var created = await createResponse.Content.ReadFromJsonAsync<SiteNotificationDto>();
        Assert.NotNull(created);
        Assert.Equal("Dashboard maintenance window tonight.", created.Message);
        Assert.Equal("warning", created.Tone);
        Assert.Equal("dashboard", created.Audience);
        Assert.True(created.IsEnabled);

        using var listResponse = await client.GetAsync("/api/admin/notifications");
        listResponse.EnsureSuccessStatusCode();

        var payload = await listResponse.Content.ReadFromJsonAsync<List<SiteNotificationDto>>();
        Assert.NotNull(payload);
        Assert.Single(payload);
        Assert.Equal(created.Id, payload[0].Id);
    }

    [Fact]
    public async Task Admin_Endpoints_Reject_Non_Admin_Users()
    {
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.Add("Authorization", "Test");
        client.DefaultRequestHeaders.Remove("x-test-sub");
        client.DefaultRequestHeaders.Remove("x-test-email");
        client.DefaultRequestHeaders.Remove("x-test-name");
        client.DefaultRequestHeaders.Add("x-test-sub", "standard-sub");
        client.DefaultRequestHeaders.Add("x-test-email", "user@conveymate.test");
        client.DefaultRequestHeaders.Add("x-test-name", "Standard User");

        using var response = await client.GetAsync("/api/admin/notifications");

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
