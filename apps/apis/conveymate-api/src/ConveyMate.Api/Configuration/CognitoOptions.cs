using System.ComponentModel.DataAnnotations;

namespace ConveyMate.Api.Configuration;

/// <summary>
/// Strongly-typed Cognito JWT validation and frontend bootstrap settings.
/// </summary>
public sealed class CognitoOptions
{
    public const string SectionName = "Cognito";

    [Required]
    public string Region { get; init; } = string.Empty;

    [Required]
    public string UserPoolId { get; init; } = string.Empty;

    [Required]
    public string AppClientId { get; init; } = string.Empty;

    [Required]
    public string Issuer { get; init; } = string.Empty;

    public string[] Scopes { get; init; } = ["openid", "email", "profile"];

    public string HostedUiDomain { get; init; } = string.Empty;

    public string RedirectSignIn { get; init; } = string.Empty;

    public string RedirectSignOut { get; init; } = string.Empty;

    public string[] SupportedIdentityProviders { get; init; } = ["COGNITO"];
}
