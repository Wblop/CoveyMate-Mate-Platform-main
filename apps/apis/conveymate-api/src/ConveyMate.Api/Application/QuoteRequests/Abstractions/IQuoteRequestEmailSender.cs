namespace ConveyMate.Api.Application.QuoteRequests.Abstractions;

/// <summary>
/// Sends outbound quote-request emails.
/// </summary>
public interface IQuoteRequestEmailSender
{
    Task<QuoteRequestEmailSendResult> SendAsync(QuoteRequestEmailMessage message, CancellationToken cancellationToken);
}

/// <summary>
/// Outbound email payload for a single quote-request email.
/// </summary>
public sealed record QuoteRequestEmailMessage(
    string ToEmail,
    string ToDisplayName,
    string Subject,
    string TextBody,
    string? HtmlBody);

/// <summary>
/// Delivery result returned to the application layer.
/// </summary>
public sealed record QuoteRequestEmailSendResult(
    bool IsSuccess,
    string? ProviderMessageId,
    string? ErrorMessage);
