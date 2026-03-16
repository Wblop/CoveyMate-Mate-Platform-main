using ErrorOr;
using MediatR;
using ConveyMate.Api.Application.Configuration.Contracts;
using ConveyMate.Api.Application.Configuration.EnabledStates;

namespace ConveyMate.Api.Application.Configuration.Queries;

/// <summary>
/// Query handler wrapper around the startup-cached enabled-state provider.
/// </summary>
public sealed class GetEnabledStatesQueryHandler(
    IEnabledStatesProvider enabledStatesProvider)
    : IGetEnabledStatesQueryHandler,
      IRequestHandler<GetEnabledStatesQuery, ErrorOr<EnabledStatesConfigurationResponse>>
{
    public EnabledStatesConfigurationResponse Handle() => enabledStatesProvider.GetSnapshot();

    public Task<ErrorOr<EnabledStatesConfigurationResponse>> Handle(GetEnabledStatesQuery request, CancellationToken cancellationToken)
    {
        return Task.FromResult<ErrorOr<EnabledStatesConfigurationResponse>>(Handle());
    }
}
