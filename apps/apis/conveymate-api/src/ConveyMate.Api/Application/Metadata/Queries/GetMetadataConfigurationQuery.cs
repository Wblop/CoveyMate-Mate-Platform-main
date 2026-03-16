using ErrorOr;
using MediatR;

namespace ConveyMate.Api.Application.Metadata.Queries;

/// <summary>
/// CQRS query for building public metadata payload and cache headers.
/// </summary>
public sealed record GetMetadataConfigurationQuery(string? IfNoneMatchHeader) : IRequest<ErrorOr<GetMetadataConfigurationQueryResult>>;
