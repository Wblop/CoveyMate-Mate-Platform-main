export interface MetadataCognitoConfiguration {
  region: string;
  userPoolId: string;
  appClientId: string;
  issuer: string;
  scopes: string[];
  hostedUi?: MetadataCognitoHostedUiConfiguration;
}

export interface MetadataCognitoHostedUiConfiguration {
  domain: string;
  redirectSignIn: string;
  redirectSignOut: string;
  supportedIdentityProviders: string[];
}

export interface MetadataPaymentsConfiguration {
  stripePublishableKey: string;
  priceAudCents: number;
  currency: string;
}

export interface MetadataAnalyticsConfiguration {
  googleMeasurementId: string;
}

export interface MetadataAddressAutocompleteConfiguration {
  provider: string;
}

export interface MetadataConfiguration {
  environment: string;
  apiBaseUrl: string;
  cognito: MetadataCognitoConfiguration;
  payments: MetadataPaymentsConfiguration;
  analytics?: MetadataAnalyticsConfiguration;
  addressAutocomplete?: MetadataAddressAutocompleteConfiguration;
  cacheTtlSeconds: number;
}

export interface CachedMetadataConfiguration {
  value: MetadataConfiguration;
  expiresAtEpochMs: number;
}
