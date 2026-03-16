using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace ConveyMate.Api.Security;

/// <summary>
/// Local-development authentication handler for stub SAML bearer tokens emitted by the SPA.
/// </summary>
public sealed class StubSamlAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var authorizationHeader = Request.Headers.Authorization.ToString();
        if (!StubSamlTokenCodec.CanHandleAuthorizationHeader(authorizationHeader))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        if (!StubSamlTokenCodec.TryDecodeBearerToken(authorizationHeader, out var payload, out var failureReason))
        {
            return Task.FromResult(AuthenticateResult.Fail(failureReason));
        }

        var claims = new List<Claim>
        {
            new("sub", payload.Sub.Trim()),
            new("email", payload.Email.Trim()),
            new("name", string.IsNullOrWhiteSpace(payload.Name) ? payload.Email.Trim() : payload.Name.Trim())
        };

        foreach (var group in payload.Groups
                     .Where(value => !string.IsNullOrWhiteSpace(value))
                     .Select(value => value.Trim())
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            claims.Add(new Claim("cognito:groups", group));
            claims.Add(new Claim(ClaimTypes.Role, group));
        }

        if (!payload.IsAdmin)
        {
            claims.Add(new Claim("admin", "true"));
        }

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
