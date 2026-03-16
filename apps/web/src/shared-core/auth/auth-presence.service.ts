import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

const AUTH_PRESENCE_COOKIE = 'conveymate.auth.presence.v1';
const AUTH_PRESENCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

@Injectable({
  providedIn: 'root'
})
export class AuthPresenceService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isSignedInState = signal(false);

  readonly isSignedIn = this.isSignedInState.asReadonly();

  constructor() {
    this.refreshFromCookie();
  }

  refreshFromCookie(): void {
    if (!this.isBrowser()) {
      this.isSignedInState.set(false);
      return;
    }

    this.isSignedInState.set(this.readCookieValue() === '1');
  }

  markSignedIn(): void {
    if (!this.isBrowser()) {
      this.isSignedInState.set(true);
      return;
    }

    this.writeCookie('1', AUTH_PRESENCE_COOKIE_MAX_AGE_SECONDS);
    this.isSignedInState.set(true);
  }

  markSignedOut(): void {
    if (!this.isBrowser()) {
      this.isSignedInState.set(false);
      return;
    }

    this.clearCookie();
    this.isSignedInState.set(false);
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  private readCookieValue(): string | null {
    const cookies = (this.document.cookie ?? '').split(';');

    for (const cookie of cookies) {
      const [rawName, ...rawValueParts] = cookie.trim().split('=');
      if (rawName !== AUTH_PRESENCE_COOKIE) {
        continue;
      }

      return rawValueParts.join('=');
    }

    return null;
  }

  private writeCookie(value: string, maxAgeSeconds: number): void {
    const parts = [
      `${AUTH_PRESENCE_COOKIE}=${value}`,
      'Path=/',
      `Max-Age=${maxAgeSeconds}`,
      'SameSite=Lax'
    ];

    const domain = this.resolveCookieDomain();
    if (domain) {
      parts.push(`Domain=${domain}`);
    }

    if (this.document.location?.protocol === 'https:') {
      parts.push('Secure');
    }

    this.document.cookie = parts.join('; ');
  }

  private clearCookie(): void {
    const parts = [
      `${AUTH_PRESENCE_COOKIE}=`,
      'Path=/',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'SameSite=Lax'
    ];

    const domain = this.resolveCookieDomain();
    if (domain) {
      parts.push(`Domain=${domain}`);
    }

    if (this.document.location?.protocol === 'https:') {
      parts.push('Secure');
    }

    this.document.cookie = parts.join('; ');
  }

  private resolveCookieDomain(): string | null {
    const hostname = (this.document.location?.hostname ?? '').trim().toLowerCase();

    if (
      !hostname ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === 'ng-localhost'
    ) {
      return null;
    }

    if (hostname === 'conveymate.com.au' && hostname.endsWith('.conveymate.com.au')) {
      return '.conveymate.com.au';
    }

    return null;
  }
}
