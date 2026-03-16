import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CachedMetadataConfiguration, MetadataConfiguration } from './metadata-configuration.models';

@Injectable({
  providedIn: 'root'
})
export class MetadataConfigurationService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly storageKey = 'conveymate.metadata.configuration.v1';

  private inMemoryCache: CachedMetadataConfiguration | null = null;
  private loadInFlight: Promise<void> | null = null;

  async load(): Promise<void> {
    const inMemoryCache = this.inMemoryCache;
    const cachedFromStorage = this.readCachedValue();
    const staleConfiguration = inMemoryCache?.value ?? cachedFromStorage?.value ?? null;

    if (this.hasValidCache(inMemoryCache)) {
      return;
    }

    if (this.hasValidCache(cachedFromStorage)) {
      this.inMemoryCache = cachedFromStorage;
      return;
    }

    if (this.loadInFlight) {
      return this.loadInFlight;
    }

    this.loadInFlight = this.fetchFromApi()
      .then((response) => {
        const value = response.body;
        if (!value) {
          throw new Error('Metadata configuration response body was empty.');
        }

        const cacheTtlSeconds = this.resolveTtlSeconds(response, value.cacheTtlSeconds);
        this.writeCache(value, cacheTtlSeconds);
      })
      .catch((error) => {
        if (staleConfiguration && this.hasRequiredFields(staleConfiguration)) {
          // Keep the app usable during brief API outages by temporarily extending stale config.
          this.writeCache(staleConfiguration, 120);
          return;
        }

        throw error;
      })
      .finally(() => {
        this.loadInFlight = null;
      });

    return this.loadInFlight;
  }

  async getValueAsync(): Promise<MetadataConfiguration> {
    await this.load();
    return this.value;
  }

  get value(): MetadataConfiguration {
    const cached = this.inMemoryCache ?? this.readCachedValue();
    if (!this.hasValidCache(cached)) {
      throw new Error('Metadata configuration is unavailable. Ensure app initialization completed.');
    }

    this.inMemoryCache = cached;
    return cached.value;
  }

  tryGetValue(): MetadataConfiguration | null {
    const cached = this.inMemoryCache ?? this.readCachedValue();
    if (!this.hasValidCache(cached)) {
      return null;
    }

    this.inMemoryCache = cached;
    return cached.value;
  }

  resolveApiUrl(path: string): string {
    const baseUrl = this.value.apiBaseUrl.trim().replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  }

  clearCache(): void {
    this.inMemoryCache = null;
    this.storage?.removeItem(this.storageKey);
  }

  private async fetchFromApi(): Promise<HttpResponse<MetadataConfiguration>> {
    return firstValueFrom(this.http.get<MetadataConfiguration>('/metadataconfiguration', { observe: 'response' }));
  }

  private writeCache(value: MetadataConfiguration, cacheTtlSeconds: number): void {
    const safeTtlSeconds = Math.max(60, Math.min(cacheTtlSeconds, 3600));
    const record: CachedMetadataConfiguration = {
      value,
      expiresAtEpochMs: Date.now() + safeTtlSeconds * 1000
    };

    this.inMemoryCache = record;
    this.storage?.setItem(this.storageKey, JSON.stringify(record));
  }

  private resolveTtlSeconds(response: HttpResponse<MetadataConfiguration>, fallbackTtlSeconds: number): number {
    const cacheControl = response.headers.get('Cache-Control') ?? '';
    const match = /max-age=(\d+)/i.exec(cacheControl);

    if (match) {
      return Number.parseInt(match[1], 10);
    }

    return fallbackTtlSeconds || 300;
  }

  private readCachedValue(): CachedMetadataConfiguration | null {
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as CachedMetadataConfiguration;
      if (!parsed?.value || !parsed?.expiresAtEpochMs) {
        this.storage?.removeItem(this.storageKey);
        return null;
      }

      return parsed;
    } catch {
      this.storage?.removeItem(this.storageKey);
      return null;
    }
  }

  private hasValidCache(value: CachedMetadataConfiguration | null): value is CachedMetadataConfiguration {
    if (!value) {
      return false;
    }

    if (Date.now() >= value.expiresAtEpochMs) {
      return false;
    }

    return this.hasRequiredFields(value.value);
  }

  private hasRequiredFields(value: MetadataConfiguration | null): value is MetadataConfiguration {
    if (!value) {
      return false;
    }

    return Boolean(
      value.apiBaseUrl &&
        value.cognito?.appClientId &&
        value.cognito?.region &&
        value.payments &&
        typeof value.payments.priceAudCents === 'number'
    );
  }

  private get storage(): Storage | null {
    return this.document.defaultView?.localStorage ?? null;
  }
}
