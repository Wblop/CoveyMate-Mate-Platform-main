import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';

@Injectable({
  providedIn: 'root'
})
export class AuditService {
  private readonly http = inject(HttpClient);
  private readonly metadata = inject(MetadataConfigurationService);

  recordSignInSucceeded(): Observable<void> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<void>(`${baseUrl}/api/audit/sign-in-succeeded`, {}).pipe(catchError(() => of(void 0)))
    );
  }

  recordPasswordResetRequested(email: string): Observable<void> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<void>(`${baseUrl}/api/audit/password-reset-requested`, { email }).pipe(catchError(() => of(void 0)))
    );
  }

  private withApiBaseUrl<T>(project: (baseUrl: string) => Observable<T>): Observable<T> {
    return from(this.metadata.getValueAsync()).pipe(
      map((config) => config.apiBaseUrl.trim().replace(/\/+$/, '')),
      switchMap((baseUrl) => project(baseUrl))
    );
  }
}
