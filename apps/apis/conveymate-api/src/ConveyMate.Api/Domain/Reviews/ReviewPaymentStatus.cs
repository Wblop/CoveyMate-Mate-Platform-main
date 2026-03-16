namespace ConveyMate.Api.Domain.Reviews;

/// <summary>
/// Canonical payment status values persisted for review jobs.
/// </summary>
public static class ReviewPaymentStatus
{
    public const string Unpaid = "Unpaid";
    public const string Pending = "Pending";
    public const string Paid = "Paid";
    public const string Failed = "Failed";
}
