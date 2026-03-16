using ConveyMate.Api.Application.Configuration.Contracts;

namespace ConveyMate.Api.Application.Configuration.EnabledStates;

/// <summary>
/// Cached read model for jurisdiction availability derived from configured collections.
/// </summary>
public interface IEnabledStatesProvider
{
    EnabledStatesConfigurationResponse GetSnapshot();

    bool IsStateEnabled(string stateOrTerritory);
}

