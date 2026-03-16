namespace ConveyMate.Api.Application.Metadata.Queries;

/// <summary>
/// Builds public metadata payloads and cache metadata for /metadataconfiguration.
/// </summary>
public interface IGetMetadataConfigurationQueryHandler
{
    GetMetadataConfigurationQueryResult Handle(string? ifNoneMatchHeader);
}
