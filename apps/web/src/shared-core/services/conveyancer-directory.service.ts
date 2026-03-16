import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import {
  ConveyancerDirectoryItem,
  ConveyancerDirectoryPage,
  ConveyancerDirectorySearchParams,
  JurisdictionCode
} from '../models/conveyancer.models';

interface ApiConveyancerDirectoryItem {
  jurisdiction: string;
  regulatorType: string;
  name: string;
  contactName: string | null;
  organizationName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  areasOfPractice: string[] | null;
  sourceUrl: string;
  sourceIdentifier: string;
  quoteRequestsEnabled: boolean;
  lastSeenUtc: string;
}

interface ApiConveyancerDirectoryPage {
  items: ApiConveyancerDirectoryItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  regulatorTypes: string[] | null;
}

@Injectable({
  providedIn: 'root'
})
export class ConveyancerDirectoryService {
  private readonly http = inject(HttpClient);
  private readonly metadata = inject(MetadataConfigurationService);

  search(params: ConveyancerDirectorySearchParams): Observable<ConveyancerDirectoryPage> {
    const normalizedJurisdiction = this.normalizeJurisdiction(params.jurisdiction);
    const normalizedPage = this.normalizePositiveInt(params.page, 1);
    const normalizedPageSize = this.normalizePositiveInt(params.pageSize, 24);
    const normalizedQuery = this.normalizeNullableString(params.query);
    const normalizedRegulator = this.normalizeNullableString(params.regulatorType);

    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .get<ApiConveyancerDirectoryPage>(`${baseUrl}/api/conveyancers`, {
          params: {
            jurisdiction: normalizedJurisdiction,
            page: String(normalizedPage),
            pageSize: String(normalizedPageSize),
            ...(normalizedQuery ? { q: normalizedQuery } : {}),
            ...(normalizedRegulator ? { regulatorType: normalizedRegulator } : {})
          }
        })
        .pipe(
          map((payload) => this.mapPage(payload)),
          catchError((error) =>
            throwError(() =>
              new Error(this.resolveApiErrorMessage(error, 'Could not load conveyancer directory.'))
            )
          )
        )
    );
  }

  listByJurisdiction(jurisdiction: string): Observable<ConveyancerDirectoryItem[]> {
    return this.search({
      jurisdiction: this.normalizeJurisdiction(jurisdiction),
      page: 1,
      pageSize: 250
    }).pipe(map((payload) => payload.items));
  }

  private withApiBaseUrl<T>(project: (baseUrl: string) => Observable<T>): Observable<T> {
    return from(this.metadata.getValueAsync()).pipe(
      map((metadata) => metadata.apiBaseUrl.trim().replace(/\/+$/, '')),
      switchMap((baseUrl) => project(baseUrl))
    );
  }

  private mapItem(row: ApiConveyancerDirectoryItem): ConveyancerDirectoryItem {
    const normalizedName = (row.name || '').trim();
    const organizationName = this.normalizeNullableString(row.organizationName) ?? (normalizedName || null);
    const contactName = this.normalizeNullableString(row.contactName);
    const website = this.normalizeWebsite(row.website);
    const sourceUrl = this.normalizeHttpUrl(row.sourceUrl) ?? '';

    return {
      jurisdiction: this.normalizeJurisdiction(row.jurisdiction),
      regulatorType: (row.regulatorType || 'unknown').trim(),
      name: normalizedName,
      contactName,
      organizationName,
      address: this.normalizeNullableString(row.address),
      phone: this.normalizeNullableString(row.phone),
      email: this.normalizeNullableString(row.email),
      website,
      areasOfPractice: Array.isArray(row.areasOfPractice)
        ? row.areasOfPractice
            .map((value) => value.trim())
            .filter((value): value is string => value.length > 0)
        : [],
      sourceUrl,
      sourceIdentifier: (row.sourceIdentifier || '').trim(),
      quoteRequestsEnabled: row.quoteRequestsEnabled !== false,
      lastSeenUtc: row.lastSeenUtc || ''
    };
  }

  private mapPage(payload: ApiConveyancerDirectoryPage): ConveyancerDirectoryPage {
    const page = this.normalizePositiveInt(payload.page, 1);
    const pageSize = this.normalizePositiveInt(payload.pageSize, 24);
    const totalCount = Math.max(0, Number(payload.totalCount || 0));
    const totalPages = Math.max(1, Math.floor(totalCount / pageSize));
    const items = Array.isArray(payload.items) ? payload.items.map((row) => this.mapItem(row)) : [];
    const regulatorTypes = Array.isArray(payload.regulatorTypes)
      ? payload.regulatorTypes
          .map((value) => value.trim())
          .filter((value): value is string => value.length > 0)
      : [];

    return {
      items,
      page,
      pageSize,
      totalCount,
      totalPages,
      regulatorTypes
    };
  }

  private normalizeNullableString(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeWebsite(value: string | null): string | null {
    const normalized = this.normalizeHttpUrl(value);
    if (!normalized) {
      return null;
    }

    // Block obvious non-website paths that slipped through scraping.
    const parsed = this.tryParseUrl(normalized);
    if (!parsed) {
      return null;
    }

    if (parsed.hostname.indexOf('.') >= 0) {
      return null;
    }

    return normalized;
  }

  private normalizeHttpUrl(value: string | null | undefined): string | null {
    const trimmed = this.normalizeNullableString(value);
    if (!trimmed) {
      return null;
    }

    const cleaned = trimmed
      .replace(/^website:\s*/i, '')
      .replace(/^url:\s*/i, '')
      .replace(/[),.;\]]+$/g, '')
      .trim();
    if (cleaned.length === 0) {
      return null;
    }

    if (/^(mailto:|tel:)/i.test(cleaned)) {
      return null;
    }

    // If a mixed string was captured, keep only the first probable URL-like token.
    const firstToken = cleaned.split(/\s+/).find((token) => token.includes('.') || /^https?:\/\//i.test(token));
    const candidate = (firstToken ?? cleaned).trim();
    if (candidate.length === 0) {
      return null;
    }

    const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const parsed = this.tryParseUrl(withScheme);
    if (!parsed) {
      return null;
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }

    if (!parsed.hostname || parsed.hostname.indexOf('.') < 0) {
      return null;
    }

    return parsed.toString();
  }

  private tryParseUrl(value: string): URL | null {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  private normalizeJurisdiction(jurisdiction: string): JurisdictionCode {
    const normalized = jurisdiction.trim().toUpperCase();
    const supported: JurisdictionCode[] = ['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT'];
    return supported.includes(normalized as JurisdictionCode)
      ? (normalized as JurisdictionCode)
      : 'ACT';
  }

  private normalizePositiveInt(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    const rounded = Math.floor(value);
    return rounded > 0 ? rounded : fallback;
  }

  private resolveApiErrorMessage(error: unknown, fallbackMessage: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    if (error instanceof HttpErrorResponse) {
      const detail = this.extractApiDetail(error.error);
      if (detail) {
        return detail;
      }

      if (error.status > 0) {
        return `${fallbackMessage} (HTTP ${error.status})`;
      }
    }

    return fallbackMessage;
  }

  private extractApiDetail(payload: unknown): string | null {
    if (typeof payload === 'string') {
      const trimmed = payload.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof payload === 'object' && payload !== null) {
      const candidate = payload as { detail?: unknown; title?: unknown; error?: unknown };
      for (const value of [candidate.detail, candidate.title, candidate.error]) {
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }

    return null;
  }
}
