using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Configuration;
using Stripe;

namespace ConveyMate.Api.Infrastructure.Payments;

/// <summary>
/// Stripe PaymentIntent adapter used by review-payment command handlers.
/// </summary>
public sealed class StripePaymentService(IOptions<StripeOptions> stripeOptions) : IStripePaymentService
{
    public async Task<StripePaymentIntentResult> CreateOrGetPaymentIntentAsync(
        string? existingPaymentIntentId,
        Guid jobId,
        Guid userId,
        string userEmail,
        string userFullName,
        CancellationToken cancellationToken)
    {
        var options = stripeOptions.Value;
        if (string.IsNullOrWhiteSpace(options.SecretKey))
        {
            throw new InvalidOperationException(
                "Stripe secret key is not configured. Set /conveymate/dev/stripe/secretKey in SSM (or Stripe:SecretKey in appsettings for local fallback).");
        }

        StripeConfiguration.ApiKey = options.SecretKey;
        var service = new PaymentIntentService();

        if (!string.IsNullOrWhiteSpace(existingPaymentIntentId))
        {
            var existing = await service.GetAsync(existingPaymentIntentId, cancellationToken: cancellationToken);
            if (!string.IsNullOrWhiteSpace(existing.ClientSecret))
            {
                return new StripePaymentIntentResult(
                    existing.Id,
                    existing.ClientSecret,
                    Convert.ToInt32(existing.Amount),
                    existing.Currency ?? "aud");
            }
        }

        var createOptions = new PaymentIntentCreateOptions
        {
            Amount = options.PriceAudCents,
            Currency = "aud",
            ReceiptEmail = userEmail,
            Description = "ConveyMate AI contract review",
            AutomaticPaymentMethods = new PaymentIntentAutomaticPaymentMethodsOptions
            {
                Enabled = true
            },
            Metadata = new Dictionary<string, string>
            {
                ["jobId"] = jobId.ToString(),
                ["userId"] = userId.ToString(),
                ["userEmail"] = userEmail,
                ["userFullName"] = userFullName
            }
        };

        var paymentIntent = await service.CreateAsync(createOptions, cancellationToken: cancellationToken);
        if (string.IsNullOrWhiteSpace(paymentIntent.ClientSecret))
        {
            throw new InvalidOperationException("Stripe did not return a client secret.");
        }

        return new StripePaymentIntentResult(
            paymentIntent.Id,
            paymentIntent.ClientSecret,
            Convert.ToInt32(paymentIntent.Amount),
            paymentIntent.Currency ?? "aud");
    }

    public async Task<StripePaymentIntentStatusResult> GetPaymentIntentStatusAsync(
        string paymentIntentId,
        CancellationToken cancellationToken)
    {
        var options = stripeOptions.Value;
        if (string.IsNullOrWhiteSpace(options.SecretKey))
        {
            throw new InvalidOperationException(
                "Stripe secret key is not configured. Set /conveymate/dev/stripe/secretKey in SSM (or Stripe:SecretKey in appsettings for local fallback).");
        }

        StripeConfiguration.ApiKey = options.SecretKey;
        var service = new PaymentIntentService();
        var paymentIntent = await service.GetAsync(paymentIntentId, cancellationToken: cancellationToken);

        var status = paymentIntent.Status ?? string.Empty;
        var succeeded = string.Equals(status, "succeeded", StringComparison.OrdinalIgnoreCase);

        return new StripePaymentIntentStatusResult(
            paymentIntent.Id,
            status,
            succeeded);
    }

    public async Task CancelPaymentIntentIfPendingAsync(
        string paymentIntentId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(paymentIntentId))
        {
            return;
        }

        var options = stripeOptions.Value;
        if (string.IsNullOrWhiteSpace(options.SecretKey))
        {
            throw new InvalidOperationException(
                "Stripe secret key is not configured. Set /conveymate/dev/stripe/secretKey in SSM (or Stripe:SecretKey in appsettings for local fallback).");
        }

        StripeConfiguration.ApiKey = options.SecretKey;
        var service = new PaymentIntentService();
        var paymentIntent = await service.GetAsync(paymentIntentId, cancellationToken: cancellationToken);
        var status = (paymentIntent.Status ?? string.Empty).Trim().ToLowerInvariant();

        if (status is "" or "canceled" or "canceled")
        {
            return;
        }

        if (status is "succeeded" or "processing")
        {
            throw new InvalidOperationException(
                "Secure checkout is already in progress for this review. Wait for the payment status to settle before trying again.");
        }

        await service.CancelAsync(paymentIntentId, cancellationToken: cancellationToken);
    }
}
