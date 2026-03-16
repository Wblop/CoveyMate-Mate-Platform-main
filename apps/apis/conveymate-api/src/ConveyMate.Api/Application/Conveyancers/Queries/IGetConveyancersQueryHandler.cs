using ErrorOr;
using MediatR;
using ConveyMate.Api.Application.Conveyancers.Contracts;

namespace ConveyMate.Api.Application.Conveyancers.Queries;

/// <summary>
/// Retrieves active conveyancers for a jurisdiction.
/// </summary>
public interface IGetConveyancersQueryHandler
{
    Task<ConveyancerDirectoryPageDto> HandleAsync(
        GetConveyancersQuery query,
        CancellationToken cancellationToken);
}

/// <summary>
/// API-level conveyancer search query options.
/// </summary>
public sealed record GetConveyancersQuery(
    string Jurisdiction,
    string? SearchTerm,
    string? RegulatorType,
    int Page,
    int PageSize) : IRequest<ErrorOr<ConveyancerDirectoryPageDto>>;
