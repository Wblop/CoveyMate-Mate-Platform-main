using System.Text;
using System.Text.Json;

namespace ConveyMate.Api.Security;

/// <summary>
/// Parses the local-development stub SAML bearer token used by the SPA callback flow.
/// </summary>
public static class StubSamlTokenCodec
{
    public const string SchemeName = "StubSaml";

    private const string BearerPrefix = "Bearer ";
    private const string TokenPrefix = "stub-saml";
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    public static bool CanHandleAuthorizationHeader(string? authorizationHeader)
    {
        return TryExtractToken(authorizationHeader, out var token) &&
               token.StartsWith($"{TokenPrefix}.", StringComparison.Ordinal);
    }

    public static bool TryDecodeBearerToken(string? authorizationHeader, out StubSamlTokenPayload payload, out string failureReason)
    {
        payload = new StubSamlTokenPayload();

        if (!TryExtractToken(authorizationHeader, out var token))
        {
            failureReason = "The Authorization header was missing or invalid.";
            return false;
        }

        return TryDecodeToken(token, out payload, out failureReason);
    }

    internal static bool TryDecodeToken(string token, out StubSamlTokenPayload payload, out string failureReason)
    {
        payload = new StubSamlTokenPayload();

        var segments = token.Split('.', StringSplitOptions.None);
        if (segments.Length != 3 || !string.Equals(segments[0], TokenPrefix, StringComparison.Ordinal))
        {
            failureReason = "The stub SAML bearer token format was invalid.";
            return false;
        }

        try
        {
            var json = Encoding.UTF8.GetString(Base64UrlDecode(segments[1]));
            payload = JsonSerializer.Deserialize<StubSamlTokenPayload>(json, SerializerOptions) ?? new StubSamlTokenPayload();
        }
        catch (Exception)
        {
            failureReason = "The stub SAML bearer token could not be decoded.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(payload.Sub))
        {
            failureReason = "The stub SAML bearer token did not contain a subject.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(payload.Email))
        {
            failureReason = "The stub SAML bearer token did not contain an email address.";
            return false;
        }

        if (payload.Exp <= DateTimeOffset.UtcNow.ToUnixTimeSeconds())
        {
            failureReason = "The stub SAML bearer token has expired.";
            return false;
        }

        failureReason = string.Empty;
        return true;
    }

    private static bool TryExtractToken(string? authorizationHeader, out string token)
    {
        token = string.Empty;
        if (string.IsNullOrWhiteSpace(authorizationHeader) ||
            !authorizationHeader.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        token = authorizationHeader[BearerPrefix.Length..].Trim();
        return !string.IsNullOrWhiteSpace(token);
    }

    private static byte[] Base64UrlDecode(string encoded)
    {
        var normalized = encoded.Replace('-', '+').Replace('_', '/');
        var paddingLength = normalized.Length % 4;
        if (paddingLength != 0)
        {
            normalized = normalized.PadRight(normalized.Length + (4 - paddingLength), '=');
        }

        return Convert.FromBase64String(normalized);
    }
}

public sealed class StubSamlTokenPayload
{
    public string Sub { get; init; } = string.Empty;

    public string Email { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public long Exp { get; init; }

    public string[] Groups { get; init; } = [];

    public bool IsAdmin { get; init; }
}
