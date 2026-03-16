namespace ConveyMate.Api.Application.Metadata.Contracts;

/// <summary>
/// Public runtime configuration exposed to the SPA. Contains only non-secret values.
/// </summary>
public sealed record MetadataConfigurationResponse(
    string Environment,
    string ApiBaseUrl,
    MetadataCognitoConfiguration Cognito,
    MetadataPaymentsConfiguration Payments,
    MetadataAnalyticsConfiguration Analytics,
    MetadataJurisdictionConfiguration Jurisdiction,
    MetadataAddressAutocompleteConfiguration AddressAutocomplete,
    int CacheTtlSeconds);

/// <summary>
/// Cognito settings required by the SPA to authenticate against the correct pool/client.
/// </summary>
public sealed record MetadataCognitoConfiguration(
    string Region,
    string UserPoolId,
    string AppClientId,
    string Issuer,
    string[] Scopes,
    MetadataCognitoHostedUiConfiguration HostedUi);

/// <summary>
/// Hosted UI settings required by the SPA for federated sign-in and sign-out flows.
/// </summary>
public sealed record MetadataCognitoHostedUiConfiguration(
    string Domain,
    string RedirectSignIn,
    string RedirectSignOut,
    string[] SupportedIdentityProviders);

/// <summary>
/// Non-secret payment settings required by the SPA.
/// </summary>
public sealed record MetadataPaymentsConfiguration(
    string StripePublishableKey,
    int PriceAudCents,
    string Currency);

/// <summary>
/// Public analytics settings used by browser-side tracking setup.
/// </summary>
public sealed record MetadataAnalyticsConfiguration(
    string GoogleMeasurementId);

/// <summary>
/// Public jurisdiction defaults for frontend review forms.
/// </summary>
public sealed record MetadataJurisdictionConfiguration(
    string DefaultState,
    string[] SupportedStates);

/// <summary>
/// Public address-autocomplete provider settings for browser-side lookup.
/// </summary>
public sealed record MetadataAddressAutocompleteConfiguration(
    string Provider);
