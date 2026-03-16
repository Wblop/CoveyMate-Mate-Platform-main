namespace ConveyMate.Api.Application.Reviews;

/// <summary>
/// Hard limits for review document uploads.
/// </summary>
public static class ReviewUploadLimits
{
    public const int MaxDocumentsPerReview = 5;
    public const long MaxDocumentSizeBytes = 30L * 1024L * 1024L;
    public const string MaxDocumentSizeLabel = "30 MB";
    public const string PdfMimeType = "application/pdf";
}
