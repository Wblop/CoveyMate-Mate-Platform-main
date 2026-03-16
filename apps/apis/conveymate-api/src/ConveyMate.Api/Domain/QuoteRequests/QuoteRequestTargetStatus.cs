namespace ConveyMate.Api.Domain.QuoteRequests;

/// <summary>
/// Lifecycle values for individual conveyancer targets on a quote request.
/// </summary>
public static class QuoteRequestTargetStatus
{
    public const string Prepared = "prepared";
    public const string Sent = "sent";
    public const string Opened = "opened";
    public const string Responded = "responded";
    public const string DeliveryFailed = "delivery-failed";
}
