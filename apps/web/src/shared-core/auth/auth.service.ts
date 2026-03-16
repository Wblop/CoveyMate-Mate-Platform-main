import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  delay,
  firstValueFrom,
  from,
  map,
  of,
  switchMap,
  tap,
  throwError
} from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { isAllowedAppRedirectPath, normalizePath } from '../routing/site-paths';
import { MetadataCognitoConfiguration, MetadataConfiguration } from '../config/metadata-configuration.models';
import { AuthPresenceService } from './auth-presence.service';
import {
  AuthSignInExperience,
  AuthSession,
  CognitoAuthenticationResult,
  CognitoConfirmSignUpResponse,
  CognitoHostedUiTokenResponse,
  CognitoInitiateAuthResponse,
  CognitoResendConfirmationCodeResponse
} from './auth.models';

interface StubSamlAssertion {
  sub: string;
  email: string;
  name: string;
  groups: string[];
  isAdmin: boolean;
}

interface StubSamlTokenPayload extends StubSamlAssertion {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly metadataConfig = inject(MetadataConfigurationService);
  private readonly authPresence = inject(AuthPresenceService);
  private readonly document = inject(DOCUMENT);

  // Only the refresh token is persisted to localStorage so it survives tab close.
  // ID and access tokens live in memory only - stolen via XSS, they expire in ~1 hour max.
  private readonly refreshTokenKey = 'conveymate.auth.refresh.v1';
  private readonly googlePkceVerifierKey = 'conveymate.auth.google.pkce.v1';
  private readonly googleStateKey = 'conveymate.auth.google.state.v1';
  private readonly samlRelayStateKey = 'conveymate.auth.saml.relay.v1';
  private readonly stubSamlSessionSeconds = 60 * 60;
  private readonly stubSamlRefreshSeconds = 30 * 24 * 60 * 60;

  private readonly sessionSubject = new BehaviorSubject<AuthSession | null>(null);

  readonly session$ = this.sessionSubject.asObservable();
  readonly isAuthenticated$ = this.session$.pipe(map((session) => this.isSessionValid(session)));

  // Called by APP_INITIALIZER before the router activates.
  // Reads any stored refresh token and silently exchanges it for a fresh session.
  tryRestoreSessionAsync(): Promise<void> {
    const refreshToken = this.localStorageRef?.getItem(this.refreshTokenKey);
    if (!refreshToken) {
      this.authPresence.markSignedOut();
      return Promise.resolve();
    }

    if (this.isStubSamlRefreshToken(refreshToken)) {
      const session = this.restoreStubSamlSession(refreshToken);
      if (session) {
        this.sessionSubject.next(session);
        this.authPresence.markSignedIn();
      } else {
        this.localStorageRef?.removeItem(this.refreshTokenKey);
        this.authPresence.markSignedOut();
      }

      return Promise.resolve();
    }

    return firstValueFrom(
      this.withCognitoConfig((cognito) =>
        this.callRefreshToken(cognito, refreshToken).pipe(
          tap((session) => {
            if (session) {
              this.sessionSubject.next(session);
              this.authPresence.markSignedIn();
            } else {
              this.localStorageRef?.removeItem(this.refreshTokenKey);
              this.authPresence.markSignedOut();
            }
          }),
          map(() => void 0),
          catchError(() => {
            this.localStorageRef?.removeItem(this.refreshTokenKey);
            this.authPresence.markSignedOut();
            return of(void 0);
          })
        )
      )
    );
  }

  // Called by the HTTP interceptor after a 401.
  // Returns true if a new session was obtained, false if the user must sign in again.
  refreshSession(): Observable<boolean> {
    const refreshToken = this.localStorageRef?.getItem(this.refreshTokenKey);
    if (!refreshToken) {
      return of(false);
    }

    if (this.isStubSamlRefreshToken(refreshToken)) {
      const session = this.restoreStubSamlSession(refreshToken);
      if (session) {
        this.sessionSubject.next(session);
        this.authPresence.markSignedIn();
        return of(true);
      }

      this.localStorageRef?.removeItem(this.refreshTokenKey);
      this.sessionSubject.next(null);
      this.authPresence.markSignedOut();
      return of(false);
    }

    return this.withCognitoConfig((cognito) =>
      this.callRefreshToken(cognito, refreshToken).pipe(
        map((session) => {
          if (session) {
            this.sessionSubject.next(session);
            this.authPresence.markSignedIn();
            return true;
          }
          this.localStorageRef?.removeItem(this.refreshTokenKey);
          this.sessionSubject.next(null);
          this.authPresence.markSignedOut();
          return false;
        }),
        catchError(() => {
          this.localStorageRef?.removeItem(this.refreshTokenKey);
          this.sessionSubject.next(null);
          this.authPresence.markSignedOut();
          return of(false);
        })
      )
    );
  }

  signIn(email: string, password: string): Observable<void> {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password.trim()) {
      return throwError(() => new Error('Enter both email and password.'));
    }

    return this.withCognitoConfig((cognito) => {
      const requestBody = {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: cognito.appClientId,
        AuthParameters: {
          USERNAME: normalizedEmail,
          PASSWORD: password
        }
      };

      return this.callCognito<CognitoInitiateAuthResponse>(cognito, 'AWSCognitoIdentityProviderService.InitiateAuth', requestBody).pipe(
        map((response) => this.toSession(normalizedEmail, response.AuthenticationResult)),
        tap((session) => this.setSession(session)),
        map(() => void 0)
      );
    });
  }

  signUp(fullName: string, email: string, password: string): Observable<{ userConfirmed: boolean }> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = fullName.trim();

    if (!normalizedName) {
      return throwError(() => new Error('Enter your full name.'));
    }

    if (!normalizedEmail.includes('@')) {
      return throwError(() => new Error('Enter a valid email address.'));
    }

    if (password.length < 1) {
      return throwError(() => new Error('Use a password with at least 12 characters.'));
    }

    return this.http
      .post<{ userConfirmed: boolean }>('/api/auth/sign-up', {
        fullName: normalizedName,
        email: normalizedEmail,
        password
      })
      .pipe(catchError((error) => throwError(() => new Error(this.resolveRequestErrorMessage(error, 'Registration failed.')))));
  }

  requestPasswordReset(email: string): Observable<void> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      return throwError(() => new Error('Enter a valid email address.'));
    }

    return this.withCognitoConfig((cognito) => {
      const requestBody = {
        ClientId: cognito.appClientId,
        Username: normalizedEmail
      };

      return this.callCognito(cognito, 'AWSCognitoIdentityProviderService.ForgotPassword', requestBody).pipe(map(() => void 0));
    });
  }

  confirmRegistration(email: string, confirmationCode: string): Observable<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = confirmationCode.trim();

    if (!normalizedEmail.includes('@')) {
      return throwError(() => new Error('Enter a valid email address.'));
    }

    if (!normalizedCode) {
      return throwError(() => new Error('Enter the verification code.'));
    }

    return this.withCognitoConfig((cognito) => {
      const requestBody = {
        ClientId: cognito.appClientId,
        Username: normalizedEmail,
        ConfirmationCode: normalizedCode
      };

      return this.callCognito<CognitoConfirmSignUpResponse>(cognito, 'AWSCognitoIdentityProviderService.ConfirmSignUp', requestBody).pipe(
        map(() => void 0)
      );
    });
  }

  resendConfirmationCode(email: string): Observable<void> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      return throwError(() => new Error('Enter a valid email address.'));
    }

    return this.withCognitoConfig((cognito) => {
      const requestBody = {
        ClientId: cognito.appClientId,
        Username: normalizedEmail
      };

      return this.callCognito<CognitoResendConfirmationCodeResponse>(
        cognito,
        'AWSCognitoIdentityProviderService.ResendConfirmationCode',
        requestBody
      ).pipe(map(() => void 0));
    });
  }

  signOut(): void {
    this.sessionSubject.next(null);
    this.localStorageRef?.removeItem(this.refreshTokenKey);
    this.authPresence.markSignedOut();
    this.clearPendingGoogleState();
    this.clearPendingSamlState();
  }

  async isGoogleSignInAvailableAsync(): Promise<boolean> {
    const metadata = await this.metadataConfig.getValueAsync();
    return !this.shouldUseStubSaml(metadata) && this.hasHostedUiProvider(metadata.cognito, 'Google');
  }

  async getSignInExperienceAsync(): Promise<AuthSignInExperience> {
    const metadata = await this.metadataConfig.getValueAsync();
    const mode = this.shouldUseStubSaml(metadata) ? 'stub-saml' : 'credentials';
    return {
      mode,
      googleAvailable: mode === 'credentials' && this.hasHostedUiProvider(metadata.cognito, 'Google')
    };
  }

  async startSamlSignInAsync(requestedRedirect?: string): Promise<void> {
    const metadata = await this.metadataConfig.getValueAsync();
    if (!this.shouldUseStubSaml(metadata)) {
      throw new Error('SAML sign-in is not configured for this environment.');
    }

    const sessionStorage = this.sessionStorageRef;
    if (!sessionStorage) {
      throw new Error('SAML sign-in is unavailable right now. Refresh and try again.');
    }

    const relayState = this.buildSamlRelayState(this.normalizeAppRedirect(requestedRedirect));
    sessionStorage.setItem(this.samlRelayStateKey, relayState);

    const stubIdpUrl = new URL('/saml/login', this.resolveCurrentOrigin());
    stubIdpUrl.searchParams.set('RelayState', relayState);
    this.document.location.assign(stubIdpUrl.toString());
  }

  async startGoogleSignInAsync(requestedRedirect?: string): Promise<void> {
    const metadata = await this.metadataConfig.getValueAsync();
    const cognito = metadata.cognito;

    if (!this.hasHostedUiProvider(cognito, 'Google')) {
      throw new Error('Google sign-in is not configured for this environment.');
    }

    const redirectPath = this.normalizeAppRedirect(requestedRedirect);
    const { verifier, challenge } = await this.createPkcePairAsync();
    const state = this.buildGoogleState(redirectPath);
    const hostedUi = cognito.hostedUi!;
    const authorizeUrl = new URL(`${this.normalizeHostedUiDomain(hostedUi.domain)}/oauth2/authorize`);

    const sessionStorage = this.sessionStorageRef;
    if (!sessionStorage) {
      throw new Error('Google sign-in is unavailable right now. Refresh and try again.');
    }

    sessionStorage.setItem(this.googlePkceVerifierKey, verifier);
    sessionStorage.setItem(this.googleStateKey, state);

    authorizeUrl.searchParams.set('client_id', cognito.appClientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('identity_provider', 'Google');
    authorizeUrl.searchParams.set('redirect_uri', hostedUi.redirectSignIn);
    authorizeUrl.searchParams.set('scope', cognito.scopes.join(' '));
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('code_challenge', challenge);

    this.document.location.assign(authorizeUrl.toString());
  }

  completeSamlSignIn(samlResponse: string, relayState: string | null): Observable<string> {
    return this.withMetadataConfig((metadata) => {
      if (!this.shouldUseStubSaml(metadata)) {
        return throwError(() => new Error('SAML sign-in is not configured for this environment.'));
      }

      let redirectPath = '/dashboard';
      try {
        redirectPath = this.consumeSamlRelayState(relayState);
      } catch (error) {
        this.clearPendingSamlState();
        return throwError(() => error);
      }

      let assertion: StubSamlAssertion;
      try {
        assertion = this.decodeStubSamlAssertion(samlResponse);
      } catch (error) {
        this.clearPendingSamlState();
        return throwError(() => error);
      }

      this.setSession(this.createStubSamlSession(assertion));
      this.clearPendingSamlState();
      return of(redirectPath);
    });
  }

  completeGoogleSignIn(code: string, state: string | null): Observable<string> {
    return this.withCognitoConfig((cognito) => {
      if (!this.hasHostedUiProvider(cognito, 'Google')) {
        return throwError(() => new Error('Google sign-in is not configured for this environment.'));
      }

      const hostedUi = cognito.hostedUi!;
      const verifier = this.sessionStorageRef?.getItem(this.googlePkceVerifierKey);

      if (!verifier) {
        this.clearPendingGoogleState();
        return throwError(() => new Error('Google sign-in session expired. Start again.'));
      }

      let redirectPath = '/dashboard';
      try {
        redirectPath = this.consumeGoogleState(state);
      } catch (error) {
        this.clearPendingGoogleState();
        return throwError(() => error);
      }

      const endpoint = `${this.normalizeHostedUiDomain(hostedUi.domain)}/oauth2/token`;
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cognito.appClientId,
        code,
        redirect_uri: hostedUi.redirectSignIn,
        code_verifier: verifier
      }).toString();
      const headers = new HttpHeaders({
        'Content-Type': 'application/x-www-form-urlencoded'
      });

      return this.http.post<CognitoHostedUiTokenResponse>(endpoint, body, { headers }).pipe(
        map((response) => this.toHostedUiSession(response)),
        tap((session) => {
          this.setSession(session);
          this.clearPendingGoogleState();
        }),
        map(() => redirectPath),
        catchError((error) => {
          this.clearPendingGoogleState();
          return throwError(() => new Error(this.resolveRequestErrorMessage(error, 'Google sign-in failed.')));
        })
      );
    });
  }

  getIdToken(): string | null {
    const session = this.sessionSubject.value;
    return this.isSessionValid(session) ? session.idToken : null;
  }

  isAuthenticatedSnapshot(): boolean {
    return this.isSessionValid(this.sessionSubject.value);
  }

  private callRefreshToken(cognito: MetadataCognitoConfiguration, refreshToken: string): Observable<AuthSession | null> {
    const requestBody = {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: cognito.appClientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken
      }
    };

    return this.callCognito<CognitoInitiateAuthResponse>(
      cognito,
      'AWSCognitoIdentityProviderService.InitiateAuth',
      requestBody
    ).pipe(
      map((response) => {
        const result = response.AuthenticationResult;
        if (!result?.IdToken || !result.AccessToken || !result.ExpiresIn) {
          return null;
        }
        return this.buildSessionFromRefresh(result, refreshToken);
      })
    );
  }

  private buildSessionFromRefresh(result: CognitoAuthenticationResult, refreshToken: string): AuthSession {
    const idToken = result.IdToken!;
    const claims = this.decodeTokenPayload(idToken);
    const email = typeof claims['email'] === 'string' ? claims['email'] : '';
    const nameClaim = claims['name'];
    const fullName = typeof nameClaim === 'string' && nameClaim.trim() ? nameClaim.trim() : email;

    return {
      idToken,
      accessToken: result.AccessToken!,
      // REFRESH_TOKEN_AUTH does not return a new refresh token - keep the existing one.
      refreshToken,
      email,
      fullName,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) - result.ExpiresIn!
    };
  }

  private setSession(session: AuthSession): void {
    this.sessionSubject.next(session);
    // Only the refresh token goes to localStorage; ID + access tokens stay in memory.
    this.localStorageRef?.setItem(this.refreshTokenKey, session.refreshToken);
    this.authPresence.markSignedIn();
  }

  private withMetadataConfig<T>(project: (metadata: MetadataConfiguration) => Observable<T>): Observable<T> {
    return from(this.metadataConfig.getValueAsync()).pipe(switchMap((metadata) => project(metadata)));
  }

  private withCognitoConfig<T>(project: (cognito: MetadataCognitoConfiguration) => Observable<T>): Observable<T> {
    return this.withMetadataConfig((metadata) => of(metadata.cognito).pipe(switchMap((cognito) => project(cognito))));
  }

  private shouldUseStubSaml(metadata: MetadataConfiguration): boolean {
    const environment = metadata.environment.trim().toLowerCase();
    return environment === 'development' || environment === 'local';
  }

  private isStubSamlRefreshToken(refreshToken: string): boolean {
    return refreshToken.startsWith('stub-refresh.');
  }

  private restoreStubSamlSession(refreshToken: string): AuthSession | null {
    const payload = this.decodeStubTokenPayload(refreshToken, 'stub-refresh');
    if (!payload || payload.exp >= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return this.createStubSamlSession(
      {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        groups: payload.groups ?? [],
        isAdmin: payload.isAdmin === true
      },
      refreshToken
    );
  }

  private createStubSamlSession(assertion: StubSamlAssertion, existingRefreshToken?: string): AuthSession {
    const normalizedAssertion = this.normalizeStubSamlAssertion(assertion);
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    const basePayload = {
      sub: normalizedAssertion.sub,
      email: normalizedAssertion.email,
      name: normalizedAssertion.name,
      groups: normalizedAssertion.groups,
      isAdmin: normalizedAssertion.isAdmin
    };
    const sessionPayload: StubSamlTokenPayload = {
      ...basePayload,
      iss: 'stub-saml',
      aud: 'conveymate-local',
      iat: nowEpochSeconds,
      exp: nowEpochSeconds + this.stubSamlSessionSeconds
    };
    const refreshToken = existingRefreshToken ?? this.encodeStubToken('stub-refresh', {
      ...basePayload,
      iss: 'stub-saml-refresh',
      aud: 'conveymate-local',
      iat: nowEpochSeconds,
      exp: nowEpochSeconds + this.stubSamlRefreshSeconds
    });

    return {
      idToken: this.encodeStubToken('stub-saml', sessionPayload),
      accessToken: this.encodeStubToken('stub-access', sessionPayload),
      refreshToken,
      email: normalizedAssertion.email,
      fullName: normalizedAssertion.name,
      expiresAtEpochSeconds: sessionPayload.exp
    };
  }

  private normalizeStubSamlAssertion(assertion: Partial<StubSamlAssertion>): StubSamlAssertion {
    const email = assertion.email?.trim().toLowerCase() ?? '';
    if (!email.includes('@')) {
      throw new Error('SAML sign-in did not return a valid email address.');
    }

    const groups = this.normalizeStubGroups(assertion.groups, assertion.isAdmin === true);
    return {
      sub: assertion.sub?.trim() || this.deriveStubSubject(email),
      email,
      name: assertion.name?.trim() || email,
      groups,
      isAdmin: assertion.isAdmin === true && groups.includes('admins')
    };
  }

  private normalizeStubGroups(groups: string[] | undefined, isAdmin: boolean): string[] {
    const normalized = (groups ?? [])
      .map((group) => group.trim())
      .filter((group) => group.length > 0);

    if (isAdmin) {
      normalized.push('admins');
    }

    return Array.from(new Set(normalized));
  }

  private deriveStubSubject(email: string): string {
    return `stub-saml:${this.base64UrlEncodeBytes(new TextEncoder().encode(email))}`;
  }

  private callCognito<TResponse>(cognito: MetadataCognitoConfiguration, target: string, payload: unknown): Observable<TResponse> {
    const endpoint = `https://cognito-idp.${cognito.region}.amazonaws.com/`;
    const headers = new HttpHeaders({
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': target
    });

    return this.http.post<TResponse>(endpoint, payload, { headers }).pipe(
      delay(50),
      switchMap((response) => of(response)),
      catchError((error) => throwError(() => new Error(this.resolveRequestErrorMessage(error, 'Authentication request failed.')))),
      tap({
        error: () => {
          // Intentionally avoid logging payloads or tokens.
        }
      })
    );
  }

  private toSession(email: string, result: CognitoAuthenticationResult | undefined): AuthSession {
    if (!result?.IdToken || !result.AccessToken || !result.RefreshToken || !result.ExpiresIn) {
      throw new Error('Authentication did not return a complete token set.');
    }

    const claims = this.decodeTokenPayload(result.IdToken);
    const nameClaim = claims['name'];
    const fullName = typeof nameClaim === 'string' && nameClaim.trim() ? nameClaim.trim() : email;

    return {
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken,
      email,
      fullName,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + result.ExpiresIn
    };
  }

  private isSessionValid(session: AuthSession | null): session is AuthSession {
    if (!session) {
      return false;
    }

    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    // Treat tokens as expired 60 s early to avoid clock-edge races.
    return nowEpochSeconds < session.expiresAtEpochSeconds + 60;
  }

  private decodeTokenPayload(idToken: string): Record<string, unknown> {
    try {
      const payload = idToken.split('.')[2];
      if (!payload) {
        return {};
      }

      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(normalized)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private resolveRequestErrorMessage(error: unknown, unknownMessage: string): string {
    if (!error || typeof error !== 'object') {
      return unknownMessage;
    }

    const response = error as {
      error?: { detail?: string; title?: string; message?: string; Message?: string };
      message?: string;
    };

    return response.error?.detail || response.error?.message || response.error?.Message || response.error?.title || response.message || unknownMessage;
  }

  private hasHostedUiProvider(cognito: MetadataCognitoConfiguration, providerName: string): boolean {
    const hostedUi = cognito.hostedUi;
    if (!hostedUi?.domain || !hostedUi.redirectSignIn) {
      return false;
    }

    return hostedUi.supportedIdentityProviders.some(
      (provider) => provider.localeCompare(providerName, undefined, { sensitivity: 'accent' }) === 0
    );
  }

  private normalizeHostedUiDomain(value: string): string {
    return value.trim().replace(/\/+$/, '');
  }

  private normalizeAppRedirect(value: string | null | undefined): string {
    return isAllowedAppRedirectPath(value) ? normalizePath(value) : '/dashboard';
  }

  private buildSamlRelayState(redirectPath: string): string {
    const payload = JSON.stringify({
      nonce: this.randomBase64Url(18),
      redirectPath
    });

    return this.base64UrlEncodeBytes(new TextEncoder().encode(payload));
  }

  private consumeSamlRelayState(actualRelayState: string | null): string {
    const expectedRelayState = this.sessionStorageRef?.getItem(this.samlRelayStateKey);
    if (!actualRelayState || !expectedRelayState || actualRelayState !== expectedRelayState) {
      throw new Error('SAML sign-in could not be verified. Start again.');
    }

    const decoded = this.base64UrlDecodeToString(actualRelayState);
    const payload = JSON.parse(decoded) as { redirectPath?: string };
    return this.normalizeAppRedirect(payload.redirectPath);
  }

  private buildGoogleState(redirectPath: string): string {
    const payload = JSON.stringify({
      nonce: this.randomBase64Url(18),
      redirectPath
    });

    return this.base64UrlEncodeBytes(new TextEncoder().encode(payload));
  }

  private consumeGoogleState(actualState: string | null): string {
    const expectedState = this.sessionStorageRef?.getItem(this.googleStateKey);

    if (!actualState || !expectedState || actualState !== expectedState) {
      throw new Error('Google sign-in could not be verified. Start again.');
    }

    const decoded = this.base64UrlDecodeToString(actualState);
    const payload = JSON.parse(decoded) as { redirectPath?: string };
    return this.normalizeAppRedirect(payload.redirectPath);
  }

  private async createPkcePairAsync(): Promise<{ verifier: string; challenge: string }> {
    const verifier = this.randomBase64Url(48);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = this.base64UrlEncodeBytes(new Uint8Array(digest));

    return { verifier, challenge };
  }

  private randomBase64Url(byteLength: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    return this.base64UrlEncodeBytes(bytes);
  }

  private base64UrlEncodeBytes(bytes: ArrayLike<number>): string {
    let binary = '';
    for (const value of Array.from(bytes)) {
      binary += String.fromCharCode(value);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private base64UrlDecodeToString(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const binary = atob(`${normalized}${padding}`);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  private decodeStubSamlAssertion(samlResponse: string): StubSamlAssertion {
    try {
      const decoded = this.base64UrlDecodeToString(samlResponse);
      return this.normalizeStubSamlAssertion(JSON.parse(decoded) as Partial<StubSamlAssertion>);
    } catch {
      throw new Error('SAML sign-in could not be verified. Start again.');
    }
  }

  private encodeStubToken(prefix: string, payload: StubSamlTokenPayload): string {
    return `${prefix}.${this.base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(payload)))}.stub`;
  }

  private decodeStubTokenPayload(token: string, expectedPrefix: string): StubSamlTokenPayload | null {
    try {
      const segments = token.split('.');
      if (segments.length !== 3 || segments[0] !== expectedPrefix) {
        return null;
      }

      return JSON.parse(this.base64UrlDecodeToString(segments[1])) as StubSamlTokenPayload;
    } catch {
      return null;
    }
  }

  private toHostedUiSession(response: CognitoHostedUiTokenResponse): AuthSession {
    if (!response.id_token || !response.access_token || !response.refresh_token || !response.expires_in) {
      throw new Error('Google sign-in did not return a complete token set.');
    }

    const claims = this.decodeTokenPayload(response.id_token);
    const emailClaim = claims['email'];
    const nameClaim = claims['name'];
    const email = typeof emailClaim === 'string' ? emailClaim.trim().toLowerCase() : '';
    const fullName = typeof nameClaim === 'string' && nameClaim.trim() ? nameClaim.trim() : email || 'ConveyMate user';

    return {
      idToken: response.id_token,
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      email,
      fullName,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + response.expires_in
    };
  }

  private clearPendingGoogleState(): void {
    this.sessionStorageRef?.removeItem(this.googlePkceVerifierKey);
    this.sessionStorageRef?.removeItem(this.googleStateKey);
  }

  private clearPendingSamlState(): void {
    this.sessionStorageRef?.removeItem(this.samlRelayStateKey);
  }

  private resolveCurrentOrigin(): string {
    return this.document.location?.origin || 'http://localhost:4201';
  }

  private get localStorageRef(): Storage | null {
    return this.document.defaultView?.localStorage ?? null;
  }

  private get sessionStorageRef(): Storage | null {
    return this.document.defaultView?.sessionStorage ?? null;
  }
}
