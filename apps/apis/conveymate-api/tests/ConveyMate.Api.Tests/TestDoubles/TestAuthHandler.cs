using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ConveyMate.Api.Tests.TestDoubles;

/// <summary>
/// Test-only authentication handler that injects deterministic claim values from request headers.
/// </summary>
public sealed class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("Authorization", out var authorizationHeader) || authorizationHeader != "Test")
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var sub = Request.Headers.TryGetValue("x-test-sub", out var subHeader)
            ? subHeader.ToString()
            : "test-sub";
        var email = Request.Headers.TryGetValue("x-test-email", out var emailHeader)
            ? emailHeader.ToString()
            : "test@example.com";
        var name = Request.Headers.TryGetValue("x-test-name", out var nameHeader)
            ? nameHeader.ToString()
            : "Test User";
        var isAdmin = Request.Headers.TryGetValue("x-test-admin", out var adminHeader)
            && bool.TryParse(adminHeader.ToString(), out var parsedAdmin)
            && parsedAdmin;
        var groups = Request.Headers.TryGetValue("x-test-groups", out var groupsHeader)
            ? groupsHeader.ToString()
            : string.Empty;

        var claims = new List<Claim>
        {
            new Claim("sub", sub),
            new Claim("email", email),
            new Claim("name", name)
        };

        if (isAdmin)
        {
            claims.Add(new Claim("admin", "true"));
        }

        if (!string.IsNullOrWhiteSpace(groups))
        {
            foreach (var group in groups.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                claims.Add(new Claim("cognito:groups", group));
            }
        }

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
