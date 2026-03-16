using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.Reviews.Abstractions;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Infrastructure.Aws;

/// <summary>
/// S3 presigned URL adapter for client uploads and report downloads.
/// </summary>
public sealed class ReviewStorageService(
    IAmazonS3 s3,
    IOptions<ReviewPipelineOptions> pipelineOptions,
    IOptions<AwsServiceOptions> awsOptions) : IReviewStorageService
{
    // Hard cap regardless of configuration value - prevents accidental long-lived URLs.
    private const int MaxPresignedUrlTtlSeconds = 3600;

    public (string Url, DateTimeOffset ExpiresAtUtc) CreateUploadUrl(string s3Key, string contentType)
    {
        var bucketName = ResolveBucketName();
        var options = pipelineOptions.Value;

        var ttl = Math.Min(options.PresignedUrlTtlSeconds, MaxPresignedUrlTtlSeconds);
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(ttl);
        var request = new GetPreSignedUrlRequest
        {
            BucketName = bucketName,
            Key = s3Key,
            Verb = HttpVerb.PUT,
            Expires = expiresAt.UtcDateTime,
            ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType
        };

        ConfigureRequestProtocol(request);
        return (s3.GetPreSignedURL(request), expiresAt);
    }

    public async Task<ReviewStorageObjectMetadata?> GetObjectMetadataAsync(string s3Key, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(s3Key))
        {
            return null;
        }

        try
        {
            var response = await s3.GetObjectMetadataAsync(new GetObjectMetadataRequest
            {
                BucketName = ResolveBucketName(),
                Key = s3Key.Trim()
            }, cancellationToken);

            return new ReviewStorageObjectMetadata(response.Headers.ContentLength, response.Headers.ContentType);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<ReviewStorageDownloadObject?> OpenReadAsync(string s3Key, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(s3Key))
        {
            return null;
        }

        try
        {
            var response = await s3.GetObjectAsync(new GetObjectRequest
            {
                BucketName = ResolveBucketName(),
                Key = s3Key.Trim()
            }, cancellationToken);

            return new ReviewStorageDownloadObject(
                response.ResponseStream,
                response.Headers.ContentType,
                response.Headers.ContentLength,
                disposable: response);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public (string Url, DateTimeOffset ExpiresAtUtc) CreateDownloadUrl(string s3Key)
    {
        var bucketName = ResolveBucketName();
        var options = pipelineOptions.Value;

        var ttl = Math.Min(options.PresignedUrlTtlSeconds, MaxPresignedUrlTtlSeconds);
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(ttl);
        var request = new GetPreSignedUrlRequest
        {
            BucketName = bucketName,
            Key = s3Key,
            Verb = HttpVerb.GET,
            Expires = expiresAt.UtcDateTime
        };

        ConfigureRequestProtocol(request);
        return (s3.GetPreSignedURL(request), expiresAt);
    }

    public async Task DeleteObjectsAsync(IReadOnlyCollection<string> s3Keys, CancellationToken cancellationToken)
    {
        if (s3Keys.Count == 0)
        {
            return;
        }

        var bucketName = ResolveBucketName();
        var keys = s3Keys
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Select(key => key.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (keys.Length == 0)
        {
            return;
        }

        var request = new DeleteObjectsRequest
        {
            BucketName = bucketName,
            Objects = keys.Select(key => new KeyVersion
            {
                Key = key
            }).ToList(),
            Quiet = true
        };

        var response = await s3.DeleteObjectsAsync(request, cancellationToken);
        if (response.DeleteErrors is { Count: > 0 })
        {
            var failures = string.Join(", ", response.DeleteErrors.Select(error => error.Key));
            throw new InvalidOperationException($"Failed to delete one or more storage objects: {failures}");
        }
    }

    private void ConfigureRequestProtocol(GetPreSignedUrlRequest request)
    {
        if (awsOptions.Value.UseLocalStack)
        {
            // LocalStack dev endpoints typically run over plain HTTP on localhost.
            request.Protocol = Protocol.HTTP;
        }
    }

    private string ResolveBucketName()
    {
        var bucketName = pipelineOptions.Value.ReportsBucketName;
        if (string.IsNullOrWhiteSpace(bucketName))
        {
            throw new InvalidOperationException(
                "Review pipeline S3 bucket is not configured. Set /conveymate/<env>/s3/reportsBucketName in SSM (or ReviewPipeline:ReportsBucketName in appsettings for local fallback).");
        }

        return bucketName;
    }
}
