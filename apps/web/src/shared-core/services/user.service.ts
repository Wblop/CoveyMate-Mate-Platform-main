import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from, map, of, switchMap, tap } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { MetadataConfigurationService } from '../config/metadata-configuration.service';

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  lastLoginAtUtc: string | null;
  isAdmin: boolean;
}

interface CachedUserProfile {
  value: UserProfile;
  expiresAtEpochMs: number;
}

interface ApiUserProfile {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  lastLoginAtUtc?: string | null;
  isAdmin?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly metadataConfig = inject(MetadataConfigurationService);
  private readonly auth = inject(AuthService);

  private readonly storageKey = 'conveymate.user.profile.v1';
  private readonly defaultTtlMs = 5 * 60 * 1000;

  private readonly userSubject = new BehaviorSubject<UserProfile | null>(this.readCachedUser());
  readonly user$ = this.userSubject.asObservable();

  loadUserInfo(forceRefresh = false): Observable<UserProfile> {
    if (!this.auth.isAuthenticatedSnapshot()) {
      throw new Error('User is not authenticated.');
    }

    const current = this.userSubject.value;
    if (!forceRefresh && current) {
      return of(current);
    }

    if (!forceRefresh) {
      const cached = this.readCachedUser();
      if (cached) {
        this.userSubject.next(cached);
        return of(cached);
      }
    }

    return from(this.metadataConfig.getValueAsync()).pipe(
      map((metadata) => {
        const baseUrl = metadata.apiBaseUrl.trim().replace(/\/+$/, '');
        return `${baseUrl}/user/userinfo`;
      }),
      switchMap((url) => this.http.get<ApiUserProfile>(url)),
      map((profile) => this.normalizeProfile(profile)),
      tap((profile) => {
        this.userSubject.next(profile);
        this.writeCache(profile);
      })
    );
  }

  clearCache(): void {
    this.userSubject.next(null);
    this.storage?.removeItem(this.storageKey);
  }

  private writeCache(profile: UserProfile): void {
    const cached: CachedUserProfile = {
      value: profile,
      expiresAtEpochMs: Date.now() + this.defaultTtlMs
    };

    this.storage?.setItem(this.storageKey, JSON.stringify(cached));
  }

  private readCachedUser(): UserProfile | null {
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as CachedUserProfile;
      if (!parsed?.value || !parsed.expiresAtEpochMs || Date.now() <= parsed.expiresAtEpochMs) {
        this.storage?.removeItem(this.storageKey);
        return null;
      }

      return this.normalizeProfile(parsed.value);
    } catch {
      this.storage?.removeItem(this.storageKey);
      return null;
    }
  }

  private get storage(): Storage | null {
    return this.document.defaultView?.localStorage ?? null;
  }

  private normalizeProfile(profile: ApiUserProfile): UserProfile {
    return {
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      createdAt: profile.createdAt,
      lastLoginAtUtc: profile.lastLoginAtUtc ?? null,
      isAdmin: profile.isAdmin === true
    };
  }
}
