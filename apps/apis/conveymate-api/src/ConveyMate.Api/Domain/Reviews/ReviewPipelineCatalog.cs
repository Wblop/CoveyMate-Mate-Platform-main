namespace ConveyMate.Api.Domain.Reviews;

/// <summary>
/// Canonical review-pipeline model used by API contracts and frontend mapping.
/// </summary>
public static class ReviewPipelineCatalog
{
    public const string CurrentDisclaimerVersion = "2026-03-04";
    public const int TypicalDurationMinutes = 7;

    public static readonly IReadOnlyList<ReviewPipelineStageDefinition> Steps =
    [
        new(
            ReviewJobStatus.AwaitingUpload,
            "Upload",
            "Documents are uploaded and prepared for processing.",
            "setup",
            0,
            0,
            14),
        new(
            ReviewJobStatus.AwaitingPayment,
            "Payment",
            "Secure payment is confirmed before processing starts.",
            "setup",
            1,
            15,
            19),
        new(
            ReviewJobStatus.Queued,
            "Queue",
            "The job is waiting for worker capacity.",
            "setup",
            2,
            20,
            29),
        new(
            ReviewJobStatus.Extracting,
            "Indexing",
            "Contract text is extracted from uploaded files.",
            "analysis",
            3,
            30,
            47),
        new(
            ReviewJobStatus.Indexing,
            "Extracting",
            "Evidence chunks and embeddings are indexed for retrieval.",
            "analysis",
            4,
            48,
            59),
        new(
            ReviewJobStatus.Analyzing,
            "Analysing",
            "AI analysis and state-specific reasoning are generated.",
            "analysis",
            5,
            60,
            85),
        new(
            ReviewJobStatus.Validating,
            "Validating",
            "Deterministic checks run over findings and citations.",
            "analysis",
            6,
            86,
            91),
        new(
            ReviewJobStatus.Rendering,
            "Rendering",
            "JSON and PDF report outputs are assembled.",
            "analysis",
            7,
            92,
            99),
        new(
            ReviewJobStatus.Completed,
            "Completed",
            "The report is ready to open and download.",
            "delivery",
            8,
            100,
            100)
    ];

    public static string ToStageState(string status, string severity = "info", bool retrying = false)
    {
        if (retrying)
        {
            return "retrying";
        }

        if (string.Equals(severity, "error", StringComparison.OrdinalIgnoreCase))
        {
            return "failed";
        }

        if (string.Equals(severity, "warning", StringComparison.OrdinalIgnoreCase))
        {
            return "warning";
        }

        var normalized = (status ?? string.Empty).Trim().ToLowerInvariant();
        return normalized switch
        {
            "awaitingupload" or "awaitingpayment" or "queued" => "queued",
            "extracting" or "indexing" or "analyzing" or "validating" or "rendering" => "running",
            "completed" => "complete",
            "failed" => "failed",
            _ => "queued"
        };
    }
}

/// <summary>
/// Single pipeline stage definition for frontend source-of-truth mapping.
/// </summary>
public sealed record ReviewPipelineStageDefinition(
    string Id,
    string Label,
    string Description,
    string Phase,
    int Order,
    int ProgressStartPercent,
    int ProgressEndPercent);
