namespace ConveyMate.Api.Application.Configuration.Contracts;

/// <summary>
/// Public state availability payload used by frontend jurisdiction selectors.
/// </summary>
public sealed record EnabledStatesConfigurationResponse(
    string DefaultState,
    string[] SupportedStates,
    string[] EnabledStates);

