import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  APP_HOSTNAME,
  MARKETING_HOSTNAME,
  isAllowedAppRedirectPath,
  isAppOnlyRoutePath,
  isAuthRoutePath,
  normalizePath
} from './site-paths';

@Injectable({
  providedIn: 'root'
})
export class SiteUrlService {
  private readonly marketingPublicOrigin = 'https://conveymate.com.au';
  private readonly appPublicOrigin = 'https://app.conveymate.com.au';
  private readonly marketingLocalOrigin = 'http://localhost:4200';
  private readonly appLocalOrigin = 'http://localhost:4201';
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  currentHostname(): string {
    return (this.document.location?.hostname ?? '').trim().toLowerCase();
  }

  currentOrigin(): string {
    return (this.document.location?.origin ?? '').trim();
  }

  isAppHost(): boolean {
    return this.currentHostname() === APP_HOSTNAME;
  }

  isMarketingHost(): boolean {
    return this.currentHostname() === MARKETING_HOSTNAME;
  }

  isLocalLikeHost(): boolean {
    const hostname = this.currentHostname();
    return hostname === '' ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === 'ng-localhost';
  }

  appHref(path: string): string {
    return this.buildHostHref(APP_HOSTNAME, path);
  }

  marketingHref(path: string): string {
    return this.buildHostHref(MARKETING_HOSTNAME, path);
  }

  signInHref(redirectPath?: string | null): string {
    const href = this.appHref('/signin');
    const normalizedRedirect = this.normalizeAppRedirect(redirectPath);
    if (!normalizedRedirect) {
      return href;
    }

    const url = new URL(href, this.resolveFallbackOrigin());
    url.searchParams.set('redirect', normalizedRedirect);
    return url.toString();
  }

  signOutHref(): string {
    return this.appHref('/signin');
  }

  normalizeAppRedirect(value: string | null | undefined): string {
    return isAllowedAppRedirectPath(value) ? normalizePath(value) : '/dashboard';
  }

  isAppOnlyRoutePath(path: string | null | undefined): boolean {
    return isAppOnlyRoutePath(path);
  }

  isAuthRoutePath(path: string | null | undefined): boolean {
    return isAuthRoutePath(path);
  }

  async navigateToApp(path: string): Promise<void> {
    await this.navigate(this.appHref(path));
  }

  async navigateToMarketing(path: string): Promise<void> {
    await this.navigate(this.marketingHref(path));
  }

  async navigate(target: string): Promise<void> {
    if (!this.isBrowser()) {
      return;
    }

    if (this.isCrossOriginTarget(target)) {
      this.document.location.assign(target);
      return;
    }

    const normalized = this.toLocalPath(target);
    if (normalized) {
      await this.router.navigateByUrl(normalized);
    }
  }

  private buildHostHref(hostname: string, path: string): string {
    const normalizedPath = this.normalizeHrefPath(path);
    if (!this.isBrowser()) {
      const targetOrigin = hostname === APP_HOSTNAME ? this.appPublicOrigin : this.marketingPublicOrigin;
      return `${targetOrigin}${normalizedPath}`;
    }

    if (this.isLocalLikeHost()) {
      const targetOrigin = hostname === APP_HOSTNAME ? this.appLocalOrigin : this.marketingLocalOrigin;
      if (this.currentOrigin() === targetOrigin) {
        return normalizedPath;
      }

      return `${targetOrigin}${normalizedPath}`;
    }

    const protocol = this.document.location?.protocol?.startsWith('http') ? this.document.location.protocol : 'https:';
    return `${protocol}//${hostname}${normalizedPath}`;
  }

  private isCrossOriginTarget(target: string): boolean {
    try {
      const url = new URL(target, this.resolveFallbackOrigin());
      return url.origin !== this.resolveFallbackOrigin();
    } catch {
      return false;
    }
  }

  private toLocalPath(target: string): string | null {
    try {
      const url = new URL(target, this.resolveFallbackOrigin());
      if (url.origin !== this.resolveFallbackOrigin()) {
        return null;
      }

      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return target.startsWith('/') ? target : this.normalizeHrefPath(target);
    }
  }

  private resolveFallbackOrigin(): string {
    const currentOrigin = this.currentOrigin();
    if (currentOrigin) {
      return currentOrigin;
    }

    return this.isBrowser() ? this.marketingLocalOrigin : this.marketingPublicOrigin;
  }

  private normalizeHrefPath(target: string): string {
    const trimmed = (target ?? '').trim();
    if (!trimmed) {
      return '/';
    }

    try {
      const url = new URL(trimmed, this.resolveFallbackOrigin());
      return `${normalizePath(url.pathname)}${url.search}${url.hash}`;
    } catch {
      const hashIndex = trimmed.indexOf('#');
      const queryIndex = trimmed.indexOf('?');
      const splitIndex = [hashIndex, queryIndex]
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0] ?? trimmed.length;
      const pathname = trimmed.slice(0, splitIndex);
      const suffix = trimmed.slice(splitIndex);
      return `${normalizePath(pathname)}${suffix}`;
    }
  }
}
