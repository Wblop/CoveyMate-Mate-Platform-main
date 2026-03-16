import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';

export interface SubmitFeedbackRequest {
  type: 'bug' | 'suggestion' | 'general';
  message: string;
  pageUrl: string;
}

@Injectable({
  providedIn: 'root'
})
export class FeedbackService {
  private readonly http = inject(HttpClient);
  private readonly metadata = inject(MetadataConfigurationService);

  submitFeedback(request: SubmitFeedbackRequest): Observable<void> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<void>(`${baseUrl}/api/feedback`, request).pipe(
        catchError((error) => {
          const detail =
            error?.error?.detail ??
            error?.error?.message ??
            (typeof error?.error === 'string' && error.error ? error.error : null) ??
            (error?.message ? `${error.status ?? ''} ${error.message}`.trim() : null) ??
            'Could not submit feedback.';
          return throwError(() => new Error(detail));
        })
      )
    );
  }

  private withApiBaseUrl<T>(project: (baseUrl: string) => Observable<T>): Observable<T> {
    return from(this.metadata.getValueAsync()).pipe(
      map((metadata) => metadata.apiBaseUrl.trim().replace(/\/+$/, '')),
      switchMap((baseUrl) => project(baseUrl))
    );
  }
}
