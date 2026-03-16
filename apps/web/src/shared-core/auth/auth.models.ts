export interface AuthSession {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  fullName: string;
  expiresAtEpochSeconds: number;
}

export interface AuthSignInExperience {
  mode: 'credentials' | 'stub-saml';
  googleAvailable: boolean;
}

export interface CognitoAuthenticationResult {
  IdToken?: string;
  AccessToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

export interface CognitoInitiateAuthResponse {
  AuthenticationResult?: CognitoAuthenticationResult;
}

export interface CognitoHostedUiTokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface CognitoSignUpResponse {
  UserConfirmed?: boolean;
}

export interface CognitoConfirmSignUpResponse {}

export interface CognitoCodeDeliveryDetails {
  Destination?: string;
  DeliveryMedium?: string;
  AttributeName?: string;
}

export interface CognitoResendConfirmationCodeResponse {
  CodeDeliveryDetails?: CognitoCodeDeliveryDetails;
}
