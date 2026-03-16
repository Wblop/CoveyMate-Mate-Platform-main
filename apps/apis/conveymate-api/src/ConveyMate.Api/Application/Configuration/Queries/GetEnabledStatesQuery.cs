using ErrorOr;
using MediatR;
using ConveyMate.Api.Application.Configuration.Contracts;

namespace ConveyMate.Api.Application.Configuration.Queries;

/// <summary>
/// CQRS query for retrieving enabled jurisdictions from configuration.
/// </summary>
public sealed record GetEnabledStatesQuery() : IRequest<ErrorOr<EnabledStatesConfigurationResponse>>;
