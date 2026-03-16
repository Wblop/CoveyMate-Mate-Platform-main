namespace ConveyMate.Api.Domain.Reviews;

/// <summary>
/// Canonical review job status values for API and worker orchestration.
/// </summary>
public static class ReviewJobStatus
{
    public const string AwaitingUpload = "AwaitingUpload";
    public const string AwaitingPayment = "AwaitingPayment";
    public const string Paid = "Paid";
    public const string Queued = "Queued";
    public const string Extracting = "Extracting";
    public const string Indexing = "Indexing";
    public const string Analyzing = "Analyzing";
    public const string Validating = "Validating";
    public const string Rendering = "Rendering";
    public const string Completed = "Completed";
    public const string Failed = "Failed";

    public static readonly string[] TerminalStates = [Completed];
}
