import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap, timer } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';

export type SiteNotificationTone = 'info' | 'warning';
export type SiteNotificationAudience = 'public' | 'dashboard' | 'both';
export type SiteNotificationSurface = 'public' | 'dashboard';

export interface SiteNotification {
  id: string;
  message: string;
  tone: SiteNotificationTone;
  audience: SiteNotificationAudience;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function normalizeSiteNotificationMessage(message: string | null | undefined): string {
  return (message ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable({
  providedIn: 'root'
})
export class SiteNotificationService {
  private readonly http = inject(HttpClient);
  private readonly metadata = inject(MetadataConfigurationService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly refreshIntervalMs = 600_000;

  watchActiveNotifications(surface: SiteNotificationSurface): Observable<SiteNotification[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return of([]);
    }

    return timer(0, this.refreshIntervalMs).pipe(
      switchMap(() =>
        this.withApiBaseUrl((baseUrl) =>
          this.http.get<SiteNotification[]>(`${baseUrl}/api/notifications?surface=${encodeURIComponent(surface)}`).pipe(
            map((items) => this.normalizeNotifications(items))
          )
        ).pipe(catchError(() => of([])))
      )
    );
  }

  private withApiBaseUrl<T>(project: (baseUrl: string) => Observable<T>): Observable<T> {
    return from(this.metadata.getValueAsync()).pipe(
      map((config) => config.apiBaseUrl.trim().replace(/\/+$/, '')),
      switchMap((baseUrl) => project(baseUrl))
    );
  }

  private normalizeNotifications(items: SiteNotification[] | null | undefined): SiteNotification[] {
    return (items ?? []).flatMap((item) => {
      const message = normalizeSiteNotificationMessage(item?.message);

      if (
        typeof item?.id !== 'string' ||
        !message ||
        (item?.tone !== 'info' && item?.tone !== 'warning') ||
        (item?.audience !== 'public' && item?.audience !== 'dashboard' && item?.audience !== 'both')
      ) {
        return [];
      }

      return [
        {
          ...item,
          message
        }
      ];
    });
  }
}
