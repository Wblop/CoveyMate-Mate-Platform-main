using ConveyMate.Api.Application.Configuration.Contracts;

namespace ConveyMate.Api.Application.Configuration.Queries;

/// <summary>
/// Returns the environment-enabled jurisdictions for frontend selectors.
/// </summary>
public interface IGetEnabledStatesQueryHandler
{
    EnabledStatesConfigurationResponse Handle();
}

