namespace ConveyMate.Api.Application.Metadata.Queries;

/// <summary>
/// Result object consumed by presentation endpoints to emit cache-aware metadata responses.
/// </summary>
public sealed record GetMetadataConfigurationQueryResult(
    string JsonPayload,
    string ETag,
    string CacheControl,
    bool NotModified);
