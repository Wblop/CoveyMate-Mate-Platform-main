namespace ConveyMate.Api.Application.Reviews.Abstractions;

/// <summary>
/// Wraps Stripe PaymentIntent operations used by the API.
/// </summary>
public interface IStripePaymentService
{
    Task<StripePaymentIntentResult> CreateOrGetPaymentIntentAsync(
        string? existingPaymentIntentId,
        Guid jobId,
        Guid userId,
        string userEmail,
        string userFullName,
        CancellationToken cancellationToken);

    Task<StripePaymentIntentStatusResult> GetPaymentIntentStatusAsync(
        string paymentIntentId,
        CancellationToken cancellationToken);

    Task CancelPaymentIntentIfPendingAsync(
        string paymentIntentId,
        CancellationToken cancellationToken);
}

/// <summary>
/// Stripe payment intent result returned to review payment handlers.
/// </summary>
public sealed record StripePaymentIntentResult(
    string PaymentIntentId,
    string ClientSecret,
    int AmountAudCents,
    string Currency);

/// <summary>
/// Stripe payment intent status snapshot used by payment confirmation workflows.
/// </summary>
public sealed record StripePaymentIntentStatusResult(
    string PaymentIntentId,
    string Status,
    bool IsSucceeded);
