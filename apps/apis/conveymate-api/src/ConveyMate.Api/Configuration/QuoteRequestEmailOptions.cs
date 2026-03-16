using System.ComponentModel.DataAnnotations;

namespace ConveyMate.Api.Configuration;

/// <summary>
/// Outbound email settings for conveyancer quote requests.
/// </summary>
public sealed class QuoteRequestEmailOptions
{
    public const string SectionName = "QuoteRequestEmail";

    [Required]
    public string Mode { get; init; } = "log";

    [Required]
    public string FromName { get; init; } = "ConveyMate Quotes";

    [Required]
    [EmailAddress]
    public string FromEmail { get; init; } = "quotes@conveymate.local";

    [Range(1, 168)]
    public int RequestExpiryHours { get; init; } = 72;

    [Range(1, 60)]
    public int DocumentAccessOtpExpiryMinutes { get; init; } = 10;

    [Range(1, 72)]
    public int DocumentAccessSessionHours { get; init; } = 12;

    [Range(0, 600)]
    public int DocumentAccessOtpCooldownSeconds { get; init; } = 45;

    /// <summary>
    /// When enabled, SES delivery is redirected to <see cref="TestAddress"/> so sandboxed
    /// accounts can still exercise the outbound email flow.
    /// </summary>
    public bool EnableSes { get; init; }

    [EmailAddress]
    public string TestAddress { get; init; } = string.Empty;

    public string SmtpHost { get; init; } = string.Empty;

    [Range(1, 65535)]
    public int SmtpPort { get; init; } = 587;

    public bool SmtpEnableSsl { get; init; } = true;

    public string SmtpUsername { get; init; } = string.Empty;

    public string SmtpPassword { get; init; } = string.Empty;
}
