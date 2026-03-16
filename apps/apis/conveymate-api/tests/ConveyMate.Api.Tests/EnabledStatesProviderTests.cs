using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.Configuration.EnabledStates;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Tests;

/// <summary>
/// Unit tests for collection-driven state enablement policy.
/// </summary>
public sealed class EnabledStatesProviderTests
{
    [Fact]
    public void Enables_State_Only_When_Common_And_State_Collections_Are_Configured()
    {
        var provider = new EnabledStatesProvider(
            Options.Create(new ReviewPipelineOptions { DefaultState = "ACT" }),
            Options.Create(new GrokOptions
            {
                Collections = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["au-common"] = "collection_common",
                    ["au-act"] = "collection_act"
                }
            }));

        var snapshot = provider.GetSnapshot();
        Assert.Equal(["ACT"], snapshot.EnabledStates);
        Assert.True(provider.IsStateEnabled("ACT"));
        Assert.False(provider.IsStateEnabled("NSW"));
    }

    [Fact]
    public void Disables_All_States_When_Common_Collection_Is_Missing()
    {
        var provider = new EnabledStatesProvider(
            Options.Create(new ReviewPipelineOptions { DefaultState = "ACT" }),
            Options.Create(new GrokOptions
            {
                Collections = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["au-act"] = "collection_act_only"
                }
            }));

        var snapshot = provider.GetSnapshot();
        Assert.Empty(snapshot.EnabledStates);
    }
}

