namespace ConveyMate.Api.Configuration;

/// <summary>
/// Embedding provider settings for worker retrieval quality and pgvector storage.
/// </summary>
public sealed class EmbeddingsOptions
{
    public const string SectionName = "Embeddings";

    public string Provider { get; init; } = "deterministic";

    public string Model { get; init; } = "deterministic-1536-v1";
}
