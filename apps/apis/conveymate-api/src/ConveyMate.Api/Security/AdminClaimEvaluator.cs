using System.Security.Claims;
using System.Text.Json;

namespace ConveyMate.Api.Security;

/// <summary>
/// Resolves whether an authenticated principal carries an admin claim/group marker.
/// </summary>
public static class AdminClaimEvaluator
{
    private static readonly string[] AdminClaimTypes =
    [
        "admin",
        "custom:admin",
        "cognito:groups",
        "role",
        "roles",
        ClaimTypes.Role
    ];

    public static bool HasAdminClaim(ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true)
        {
            return false;
        }

        if (principal.IsInRole("admin") || principal.IsInRole("admins"))
        {
            return true;
        }

        foreach (var claimType in AdminClaimTypes)
        {
            foreach (var claim in principal.FindAll(claimType))
            {
                if (ClaimValueMarksAdmin(claim.Value))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool ClaimValueMarksAdmin(string? rawValue)
    {
        if (string.IsNullOrWhiteSpace(rawValue))
        {
            return false;
        }

        var value = rawValue.Trim();
        if (IsTruthy(value))
        {
            return true;
        }

        if (IsAdminToken(value))
        {
            return true;
        }

        if (TryParseJsonArray(value, out var parsedValues))
        {
            return parsedValues.Any(IsAdminToken);
        }

        var splitValues = value.Split([',', ';', ' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return splitValues.Any(IsAdminToken);
    }

    private static bool IsTruthy(string value)
    {
        var normalized = value.Trim().ToLowerInvariant();
        return normalized is "true" or "1" or "yes" or "y";
    }

    private static bool IsAdminToken(string value)
    {
        var normalized = value.Trim().Trim('"').ToLowerInvariant();
        return normalized is "admin" or "admins";
    }

    private static bool TryParseJsonArray(string raw, out string[] values)
    {
        values = [];

        if (!raw.StartsWith("[", StringComparison.Ordinal) || !raw.EndsWith("]", StringComparison.Ordinal))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return false;
            }

            values = document.RootElement
                .EnumerateArray()
                .Select(element => element.ValueKind == JsonValueKind.String ? element.GetString() : element.ToString())
                .Where(element => !string.IsNullOrWhiteSpace(element))
                .ToArray()!;
            return true;
        }
        catch
        {
            return false;
        }
    }
}
