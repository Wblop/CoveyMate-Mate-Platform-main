using System.Net;
using System.Net.Mail;
using Amazon.SimpleEmailV2;
using Amazon.SimpleEmailV2.Model;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.QuoteRequests.Abstractions;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Infrastructure.Email;

/// <summary>
/// Sends quote-request invitation emails using either structured logging or SMTP.
/// </summary>
public sealed class QuoteRequestEmailSender(
    IOptions<QuoteRequestEmailOptions> options,
    IAmazonSimpleEmailServiceV2 sesClient,
    ILogger<QuoteRequestEmailSender> logger) : IQuoteRequestEmailSender
{
    public async Task<QuoteRequestEmailSendResult> SendAsync(QuoteRequestEmailMessage message, CancellationToken cancellationToken)
    {
        var config = options.Value;
        var mode = (config.Mode ?? string.Empty).Trim().ToLowerInvariant();

        return mode switch
        {
            "ses" => await SendViaSesAsync(message, config, cancellationToken),
            "smtp" => await SendViaSmtpAsync(message, config, cancellationToken),
            _ => LogMessage(message)
        };
    }

    private QuoteRequestEmailSendResult LogMessage(QuoteRequestEmailMessage message)
    {
        logger.LogInformation(
            "Quote request email simulated. To: {ToEmail}; Subject: {Subject}; Body: {Body}",
            message.ToEmail,
            message.Subject,
            message.TextBody);

        return new QuoteRequestEmailSendResult(true, "log", null);
    }

    private async Task<QuoteRequestEmailSendResult> SendViaSesAsync(
        QuoteRequestEmailMessage message,
        QuoteRequestEmailOptions config,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(config.FromEmail))
        {
            return new QuoteRequestEmailSendResult(false, null, "SES sender email is not configured.");
        }

        try
        {
            var resolvedRecipient = ResolveSesRecipient(message, config);
            var response = await sesClient.SendEmailAsync(new SendEmailRequest
            {
                FromEmailAddress = string.IsNullOrWhiteSpace(config.FromName)
                    ? config.FromEmail
                    : $"{config.FromName} <{config.FromEmail}>",
                Destination = new Destination
                {
                    ToAddresses = [resolvedRecipient.ToEmail]
                },
                ReplyToAddresses = [],
                Content = new EmailContent
                {
                    Simple = new Message
                    {
                        Subject = new Content
                        {
                            Data = message.Subject
                        },
                        Body = new Body
                        {
                            Text = new Content
                            {
                                Data = resolvedRecipient.TextBody
                            },
                            Html = string.IsNullOrWhiteSpace(resolvedRecipient.HtmlBody)
                                ? null
                                : new Content
                                {
                                    Data = resolvedRecipient.HtmlBody
                                }
                            }
	                        }
	                    }
	            }, cancellationToken);

            return new QuoteRequestEmailSendResult(true, response.MessageId, null);
        }
        catch (Exception error)
        {
            logger.LogWarning(error, "Quote request email delivery via SES failed for {ToEmail}.", message.ToEmail);
            return new QuoteRequestEmailSendResult(false, null, error.Message);
        }
    }

    private ResolvedEmailMessage ResolveSesRecipient(
        QuoteRequestEmailMessage message,
        QuoteRequestEmailOptions config)
    {
        if (!config.EnableSes || string.IsNullOrWhiteSpace(config.TestAddress))
        {
            return new ResolvedEmailMessage(message.ToEmail, message.TextBody, message.HtmlBody);
        }

        var testAddress = config.TestAddress.Trim();
        if (string.Equals(testAddress, message.ToEmail, StringComparison.OrdinalIgnoreCase))
        {
            return new ResolvedEmailMessage(testAddress, message.TextBody, message.HtmlBody);
        }

        logger.LogInformation(
            "Routing SES quote request email for {OriginalToEmail} to sandbox test address {SandboxToEmail}.",
            message.ToEmail,
            testAddress);

        return new ResolvedEmailMessage(
            testAddress,
            $"Sandbox redirect. Intended recipient: {message.ToDisplayName} <{message.ToEmail}>.{Environment.NewLine}{Environment.NewLine}{message.TextBody}",
            string.IsNullOrWhiteSpace(message.HtmlBody)
                ? null
                : $"<p><strong>Sandbox redirect.</strong> Intended recipient: {WebUtility.HtmlEncode(message.ToDisplayName)} &lt;{WebUtility.HtmlEncode(message.ToEmail)}&gt;.</p>{message.HtmlBody}");
    }

    private async Task<QuoteRequestEmailSendResult> SendViaSmtpAsync(
        QuoteRequestEmailMessage message,
        QuoteRequestEmailOptions config,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(config.SmtpHost))
        {
            return new QuoteRequestEmailSendResult(false, null, "SMTP host is not configured.");
        }

        try
        {
            using var mailMessage = new MailMessage
            {
                From = new MailAddress(config.FromEmail, config.FromName),
                Subject = message.Subject,
                Body = message.TextBody,
                IsBodyHtml = false
            };
            mailMessage.To.Add(new MailAddress(message.ToEmail, message.ToDisplayName));
            if (!string.IsNullOrWhiteSpace(message.HtmlBody))
            {
                mailMessage.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.TextBody, null, "text/plain"));
                mailMessage.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.HtmlBody, null, "text/html"));
                mailMessage.Body = message.HtmlBody;
                mailMessage.IsBodyHtml = true;
            }

            using var client = new SmtpClient(config.SmtpHost, config.SmtpPort)
            {
                EnableSsl = config.SmtpEnableSsl,
                DeliveryMethod = SmtpDeliveryMethod.Network
            };

            if (!string.IsNullOrWhiteSpace(config.SmtpUsername))
            {
                client.Credentials = new NetworkCredential(config.SmtpUsername, config.SmtpPassword);
            }

            using var registration = cancellationToken.Register(client.SendAsyncCancel);
            await client.SendMailAsync(mailMessage, cancellationToken);
            return new QuoteRequestEmailSendResult(true, Guid.NewGuid().ToString("N"), null);
        }
        catch (Exception error)
        {
            logger.LogWarning(error, "Quote request email delivery failed for {ToEmail}.", message.ToEmail);
            return new QuoteRequestEmailSendResult(false, null, error.Message);
        }
    }

    private sealed record ResolvedEmailMessage(string ToEmail, string TextBody, string? HtmlBody);
}
