namespace ConveyMate.Api.Application.Conveyancers;

internal static class ConveyancerDirectoryCacheKeys
{
    public static string BuildJurisdictionKey(string jurisdiction)
    {
        return $"conveyancers:jurisdiction:{(jurisdiction ?? string.Empty).Trim().ToUpperInvariant()}";
    }
}
