namespace ConveyMate.Api.Application.Reviews.Abstractions;

public sealed record ReviewStorageObjectMetadata(long SizeBytes, string? ContentType);

public sealed class ReviewStorageDownloadObject : IAsyncDisposable
{
    private readonly IAsyncDisposable? asyncDisposable;
    private readonly IDisposable? disposable;

    public ReviewStorageDownloadObject(Stream stream, string? contentType, long? contentLength, IAsyncDisposable? asyncDisposable = null, IDisposable? disposable = null)
    {
        Stream = stream;
        ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim();
        ContentLength = contentLength;
        this.asyncDisposable = asyncDisposable;
        this.disposable = disposable;
    }

    public Stream Stream { get; }

    public string ContentType { get; }

    public long? ContentLength { get; }

    public async ValueTask DisposeAsync()
    {
        if (asyncDisposable is not null)
        {
            await asyncDisposable.DisposeAsync();
        }
        else if (disposable is not null)
        {
            disposable.Dispose();
        }
        else
        {
            Stream.Dispose();
        }
    }
}

/// <summary>
/// Generates S3 presigned URLs for raw uploads and report downloads.
/// </summary>
public interface IReviewStorageService
{
    (string Url, DateTimeOffset ExpiresAtUtc) CreateUploadUrl(string s3Key, string contentType);

    (string Url, DateTimeOffset ExpiresAtUtc) CreateDownloadUrl(string s3Key);

    Task<ReviewStorageDownloadObject?> OpenReadAsync(string s3Key, CancellationToken cancellationToken);

    Task<ReviewStorageObjectMetadata?> GetObjectMetadataAsync(string s3Key, CancellationToken cancellationToken);

    Task DeleteObjectsAsync(IReadOnlyCollection<string> s3Keys, CancellationToken cancellationToken);
}
