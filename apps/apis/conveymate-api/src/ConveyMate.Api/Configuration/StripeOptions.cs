using System.ComponentModel.DataAnnotations;

namespace ConveyMate.Api.Configuration;

/// <summary>
/// Stripe runtime settings loaded from SSM/app configuration.
/// </summary>
public sealed class StripeOptions
{
    public const string SectionName = "Stripe";

    public string SecretKey { get; init; } = string.Empty;

    public string WebhookSecret { get; init; } = string.Empty;

    [Range(100, 500000)]
    public int PriceAudCents { get; init; } = 1999;

    public string PublishableKey { get; init; } = string.Empty;
}
