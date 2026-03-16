namespace ConveyMate.Api.Configuration;

/// <summary>
/// Runtime AWS client configuration for local emulation (LocalStack) and cloud execution.
/// </summary>
public sealed class AwsServiceOptions
{
    public const string SectionName = "Aws";

    public string Region { get; init; } = "ap-southeast-2";

    public bool UseLocalStack { get; init; }

    public string LocalStackUrl { get; init; } = "http://localhost:4566";

    public string AccessKeyId { get; init; } = "test";

    public string SecretAccessKey { get; init; } = "test";

    public bool S3ForcePathStyle { get; init; } = true;
}
