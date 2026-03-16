import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let metadataConfigurationService: jasmine.SpyObj<MetadataConfigurationService>;
  const googlePkceVerifierKey = 'conveymate.auth.google.pkce.v1';
  const googleStateKey = 'conveymate.auth.google.state.v1';
  const samlRelayStateKey = 'conveymate.auth.saml.relay.v1';
  const refreshTokenKey = 'conveymate.auth.refresh.v1';
  const baseMetadata = {
    environment: 'Testing',
    apiBaseUrl: 'http://localhost:5141',
    cacheTtlSeconds: 300,
    cognito: {
      region: 'ap-southeast-2',
      userPoolId: 'pool',
      appClientId: 'client',
      issuer: 'issuer',
      scopes: ['openid', 'email'],
      hostedUi: {
        domain: 'https://conveymate-test.auth.ap-southeast-2.amazoncognito.com',
        redirectSignIn: 'https://app.conveymate.com.au/google/callback',
        redirectSignOut: 'https://app.conveymate.com.au/signin',
        supportedIdentityProviders: ['COGNITO', 'Google']
      }
    },
    payments: {
      stripePublishableKey: 'pk_test_123',
      priceAudCents: 1999,
      currency: 'aud'
    }
  };

  beforeEach(() => {
    localStorage.clear();
    metadataConfigurationService = jasmine.createSpyObj<MetadataConfigurationService>('MetadataConfigurationService', ['getValueAsync']);
    metadataConfigurationService.getValueAsync.and.resolveTo(baseMetadata);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: MetadataConfigurationService,
          useValue: metadataConfigurationService
        }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('posts signup details to the public auth endpoint', async () => {
    const signUpPromise = firstValueFrom(service.signUp(' Alice Example ', ' USER@example.com ', 'StrongPassword123!'));

    const request = httpMock.expectOne('/api/auth/sign-up');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      fullName: 'Alice Example',
      email: 'user@example.com',
      password: 'StrongPassword123!'
    });

    request.flush({ userConfirmed: false });

    await expectAsync(signUpPromise).toBeResolvedTo({ userConfirmed: false });
  });

  it('surfaces API problem details for signup failures', async () => {
    const signUpPromise = firstValueFrom(service.signUp('Alice Example', 'user@example.com', 'StrongPassword123!'));

    const request = httpMock.expectOne('/api/auth/sign-up');
    request.flush(
      {
        title: 'Registration failed.',
        detail: 'Account already exists.'
      },
      {
        status: 400,
        statusText: 'Bad Request'
      }
    );

    await expectAsync(signUpPromise).toBeRejectedWithError('Account already exists.');
  });

  it('validates obvious signup errors before making a request', async () => {
    const signUpPromise = firstValueFrom(service.signUp('', 'user@example.com', 'StrongPassword123!'));

    httpMock.expectNone('/api/auth/sign-up');
    await expectAsync(signUpPromise).toBeRejectedWithError('Enter your full name.');
  });

  it('exchanges the Google hosted UI code for a Cognito session', async () => {
    const state = btoa(JSON.stringify({ nonce: 'nonce', redirectPath: '/reports' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    sessionStorage.setItem(googleStateKey, state);
    sessionStorage.setItem(googlePkceVerifierKey, 'pkce-verifier');

    const signInPromise = firstValueFrom(service.completeGoogleSignIn('oauth-code-123', state));
    await Promise.resolve();

    const request = httpMock.expectOne('https://conveymate-test.auth.ap-southeast-2.amazoncognito.com/oauth2/token');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toContain('grant_type=authorization_code');
    expect(request.request.body).toContain('client_id=client');
    expect(request.request.body).toContain('code=oauth-code-123');
    expect(request.request.body).toContain(
      encodeURIComponent('redirect_uri=https://app.conveymate.com.au/google/callback').replace(/%3D/g, '=')
    );
    expect(request.request.body).toContain('code_verifier=pkce-verifier');

    request.flush({
      access_token: 'access-token',
      id_token:
        'eyJhbGciOiJIUzI1NiJ9.' +
        btoa(JSON.stringify({ email: 'buyer@example.com', name: 'Buyer Example' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') +
        '.signature',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'Bearer'
    });

    await expectAsync(signInPromise).toBeResolvedTo('/reports');
    expect(service.isAuthenticatedSnapshot()).toBeTrue();
    expect(localStorage.getItem('conveymate.auth.refresh.v1')).toBe('refresh-token');
    expect(sessionStorage.getItem(googleStateKey)).toBeNull();
    expect(sessionStorage.getItem(googlePkceVerifierKey)).toBeNull();
  });

  it('rejects Google sign-in when the state does not match the stored flow', async () => {
    sessionStorage.setItem(googleStateKey, 'expected-state');
    sessionStorage.setItem(googlePkceVerifierKey, 'pkce-verifier');

    const signInPromise = firstValueFrom(service.completeGoogleSignIn('oauth-code-123', 'unexpected-state'));

    httpMock.expectNone('https://conveymate-test.auth.ap-southeast-2.amazoncognito.com/oauth2/token');
    await expectAsync(signInPromise).toBeRejectedWithError('Google sign-in could not be verified. Start again.');
  });

  it('uses stub SAML sign-in for development metadata', async () => {
    metadataConfigurationService.getValueAsync.and.resolveTo({
      ...baseMetadata,
      environment: 'Development'
    });

    await expectAsync(service.getSignInExperienceAsync()).toBeResolvedTo({
      mode: 'stub-saml',
      googleAvailable: false
    });
  });

  it('completes the stub SAML callback and stores a stub refresh token', async () => {
    metadataConfigurationService.getValueAsync.and.resolveTo({
      ...baseMetadata,
      environment: 'Development'
    });

    const relayState = encodeBase64Url(JSON.stringify({ nonce: 'nonce', redirectPath: '/reports' }));
    const samlResponse = encodeBase64Url(JSON.stringify({
      sub: 'stub-saml:test-user',
      email: 'buyer@example.com',
      name: 'Buyer Example',
      groups: ['admins'],
      isAdmin: true
    }));

    sessionStorage.setItem(samlRelayStateKey, relayState);

    await expectAsync(firstValueFrom(service.completeSamlSignIn(samlResponse, relayState))).toBeResolvedTo('/reports');
    expect(service.isAuthenticatedSnapshot()).toBeTrue();
    expect(localStorage.getItem(refreshTokenKey)?.startsWith('stub-refresh.')).toBeTrue();
    expect(sessionStorage.getItem(samlRelayStateKey)).toBeNull();
  });

  it('restores a stub SAML session from the stored refresh token', async () => {
    metadataConfigurationService.getValueAsync.and.resolveTo({
      ...baseMetadata,
      environment: 'Development'
    });

    const relayState = encodeBase64Url(JSON.stringify({ nonce: 'nonce', redirectPath: '/dashboard' }));
    const samlResponse = encodeBase64Url(JSON.stringify({
      sub: 'stub-saml:test-user',
      email: 'buyer@example.com',
      name: 'Buyer Example',
      groups: [],
      isAdmin: false
    }));

    sessionStorage.setItem(samlRelayStateKey, relayState);
    await firstValueFrom(service.completeSamlSignIn(samlResponse, relayState));

    const refreshToken = localStorage.getItem(refreshTokenKey);
    expect(refreshToken).not.toBeNull();

    service.signOut();
    localStorage.setItem(refreshTokenKey, refreshToken!);

    await service.tryRestoreSessionAsync();

    expect(service.isAuthenticatedSnapshot()).toBeTrue();
  });
});

function encodeBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
