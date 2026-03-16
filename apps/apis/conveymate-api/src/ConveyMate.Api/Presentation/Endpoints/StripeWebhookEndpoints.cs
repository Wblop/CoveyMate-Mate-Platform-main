using Carter;
using MediatR;
using ConveyMate.Api.Application.Reviews;
using ConveyMate.Api.Presentation;

namespace ConveyMate.Api.Presentation.Endpoints;

/// <summary>
/// Public webhook endpoint mappings for Stripe payment notifications.
/// </summary>
public sealed class StripeWebhookEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/webhooks/stripe", async (
                HttpContext context,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                using var reader = new StreamReader(context.Request.Body);
                var payload = await reader.ReadToEndAsync(cancellationToken);
                var signatureHeader = context.Request.Headers["Stripe-Signature"].ToString();

                var result = await sender.Send(new HandleStripeWebhookCommand(payload, signatureHeader), cancellationToken);
                return result.Match(
                    value => Results.Ok(new
                    {
                        processed = value.IsProcessed,
                        message = value.Message
                    }),
                    errors => errors.ToHttpResult(validationTitle: "Invalid Stripe webhook payload."));
            })
            .AllowAnonymous()
            .WithName("StripeWebhook");
    }
}
