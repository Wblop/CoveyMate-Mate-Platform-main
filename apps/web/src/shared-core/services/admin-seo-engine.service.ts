import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';

export interface SeoEngineOverview {
  engineEnabled: boolean;
  queueConfigured: boolean;
  engineName: string;
  marketingHost: string;
  appHost: string;
  draftCount: number;
  publishedCount: number;
  runningJobCount: number;
  failedJobCount: number;
}

export interface SeoEngineJob {
  id: string;
  jobType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  requestedSource: string;
  requestedByEmail: string;
  requestedByName: string;
  articleId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface SeoEngineSchedule {
  jobType: string;
  label: string;
  description: string;
  scheduleExpression: string;
  scheduleExpressionTimezone: string;
  enabled: boolean;
  state: 'ENABLED' | 'DISABLED' | string;
}

export interface SeoEngineDuplicateWarning {
  severity: 'warn' | 'block' | string;
  matchType: string;
  message: string;
  existingArticleId: string | null;
  existingArticleTitle: string | null;
  existingArticleSlug: string | null;
  similarityScore: number;
}

export interface SeoEngineArticleSection {
  sectionId: string;
  heading: string;
  paragraphs: string[];
  bullets: string[];
  position: number;
}

export interface SeoEngineArticleSource {
  sourceName: string;
  publisher: string;
  headline: string;
  sourceUrl: string;
  publishedAt: string | null;
  summary: string;
  position: number;
}

export interface SeoEngineArticleSummary {
  id: string;
  status: 'draft' | 'published';
  title: string;
  slug: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
  keywords: string[];
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  duplicateWarnings: SeoEngineDuplicateWarning[];
}

export interface SeoEngineArticleDetail extends SeoEngineArticleSummary {
  bodyMarkdown: string;
  bodyHtml: string;
  bodyPlainText: string;
  lastGeneratedAt: string | null;
  sections: SeoEngineArticleSection[];
  sources: SeoEngineArticleSource[];
}

export interface SeoEngineArticleUpdateRequest {
  title: string;
  slug: string;
  excerpt: string;
  bodyMarkdown: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
  keywords: string[];
}

export interface SeoEngineJobTriggerResponse {
  jobId: string;
  jobType: string;
  status: string;
  queuedAtUtc: string;
  message: string;
}

export interface SeoEngineJobHistoryClearResponse {
  deletedCount: number;
}

export interface SeoEngineScheduleUpdateRequest {
  scheduleExpression: string;
  scheduleExpressionTimezone: string;
  enabled: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AdminSeoEngineService {
  private readonly http = inject(HttpClient);
  private readonly metadataConfiguration = inject(MetadataConfigurationService);

  getOverview(): Observable<SeoEngineOverview> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<unknown>(`${baseUrl}/api/admin/seo-engine/overview`).pipe(map((payload) => this.toOverview(payload)))
    );
  }

  getJobs(): Observable<SeoEngineJob[]> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<unknown>(`${baseUrl}/api/admin/seo-engine/jobs`).pipe(map((payload) => this.toJobs(payload)))
    );
  }

  getSchedules(): Observable<SeoEngineSchedule[]> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<unknown>(`${baseUrl}/api/admin/seo-engine/schedules`).pipe(map((payload) => this.toSchedules(payload)))
    );
  }

  getArticles(status?: 'draft' | 'published'): Observable<SeoEngineArticleSummary[]> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .get<unknown>(`${baseUrl}/api/admin/seo-engine/articles`, {
          params: status ? { status } : undefined
        })
        .pipe(map((payload) => this.toArticleSummaries(payload)))
    );
  }

  getArticle(articleId: string): Observable<SeoEngineArticleDetail> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<unknown>(`${baseUrl}/api/admin/seo-engine/articles/${articleId}`).pipe(map((payload) => this.toArticleDetail(payload)))
    );
  }

  generateArticle(): Observable<SeoEngineJobTriggerResponse> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<unknown>(`${baseUrl}/api/admin/seo-engine/jobs/generate-article`, {}).pipe(map((payload) => this.toJobTrigger(payload)))
    );
  }

  refreshSitemap(): Observable<SeoEngineJobTriggerResponse> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<unknown>(`${baseUrl}/api/admin/seo-engine/sitemap/refresh`, {}).pipe(map((payload) => this.toJobTrigger(payload)))
    );
  }

  updateSchedule(jobType: string, request: SeoEngineScheduleUpdateRequest): Observable<SeoEngineSchedule> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.put<unknown>(`${baseUrl}/api/admin/seo-engine/schedules/${jobType}`, request).pipe(map((payload) => this.toSchedule(payload)))
    );
  }

  updateArticle(articleId: string, request: SeoEngineArticleUpdateRequest): Observable<SeoEngineArticleDetail> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.put<unknown>(`${baseUrl}/api/admin/seo-engine/articles/${articleId}`, request).pipe(map((payload) => this.toArticleDetail(payload)))
    );
  }

  publishArticle(articleId: string): Observable<SeoEngineArticleDetail> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<unknown>(`${baseUrl}/api/admin/seo-engine/articles/${articleId}/publish`, {}).pipe(map((payload) => this.toArticleDetail(payload)))
    );
  }

  deleteArticle(articleId: string): Observable<void> {
    return this.withApiBaseUrl((baseUrl) => this.http.delete<void>(`${baseUrl}/api/admin/seo-engine/articles/${articleId}`));
  }

  deleteJob(jobId: string): Observable<void> {
    return this.withApiBaseUrl((baseUrl) => this.http.delete<void>(`${baseUrl}/api/admin/seo-engine/jobs/${jobId}`));
  }

  clearJobHistory(): Observable<SeoEngineJobHistoryClearResponse> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .delete<unknown>(`${baseUrl}/api/admin/seo-engine/jobs/history`)
        .pipe(map((payload) => this.toJobHistoryClearResponse(payload)))
    );
  }

  private withApiBaseUrl<T>(project: (baseUrl: string) => Observable<T>): Observable<T> {
    return from(this.metadataConfiguration.getValueAsync()).pipe(
      switchMap((configuration) => project(this.normalizeBaseUrl(configuration.apiBaseUrl))),
      catchError((error) => this.handleError(error))
    );
  }

  private normalizeBaseUrl(value: string): string {
    const trimmed = (value ?? '').trim();
    if (!trimmed || trimmed === '/') {
      return '';
    }

    return trimmed.replace(/\/+$/, '');
  }

  private toOverview(payload: unknown): SeoEngineOverview {
    const row = this.readRecord(payload);
    return {
      engineEnabled: this.readBoolean(row, 'engineEnabled'),
      queueConfigured: this.readBoolean(row, 'queueConfigured'),
      engineName: this.readString(row, 'engineName'),
      marketingHost: this.readString(row, 'marketingHost'),
      appHost: this.readString(row, 'appHost'),
      draftCount: this.readNumber(row, 'draftCount'),
      publishedCount: this.readNumber(row, 'publishedCount'),
      runningJobCount: this.readNumber(row, 'runningJobCount'),
      failedJobCount: this.readNumber(row, 'failedJobCount')
    };
  }

  private toJobs(payload: unknown): SeoEngineJob[] {
    return this.readArray(payload).map((value) => {
      const row = this.readRecord(value);
      return {
        id: this.readString(row, 'id'),
        jobType: this.readString(row, 'jobType'),
        status: this.readString(row, 'status') as SeoEngineJob['status'],
        requestedSource: this.readString(row, 'requestedSource'),
        requestedByEmail: this.readString(row, 'requestedByEmail'),
        requestedByName: this.readString(row, 'requestedByName'),
        articleId: this.readNullableString(row, 'articleId'),
        createdAt: this.readString(row, 'createdAt'),
        startedAt: this.readNullableString(row, 'startedAt'),
        completedAt: this.readNullableString(row, 'completedAt'),
        errorMessage: this.readNullableString(row, 'errorMessage')
      };
    });
  }

  private toSchedules(payload: unknown): SeoEngineSchedule[] {
    return this.readArray(payload).map((value) => this.toSchedule(value));
  }

  private toSchedule(payload: unknown): SeoEngineSchedule {
    const row = this.readRecord(payload);
    return {
      jobType: this.readString(row, 'jobType'),
      label: this.readString(row, 'label'),
      description: this.readString(row, 'description'),
      scheduleExpression: this.readString(row, 'scheduleExpression'),
      scheduleExpressionTimezone: this.readString(row, 'scheduleExpressionTimezone'),
      enabled: this.readBoolean(row, 'enabled'),
      state: this.readString(row, 'state')
    };
  }

  private toArticleSummaries(payload: unknown): SeoEngineArticleSummary[] {
    return this.readArray(payload).map((value) => this.readArticleSummary(this.readRecord(value)));
  }

  private toArticleDetail(payload: unknown): SeoEngineArticleDetail {
    const row = this.readRecord(payload);
    const summary = this.readArticleSummary(row);
    return {
      ...summary,
      bodyMarkdown: this.readString(row, 'bodyMarkdown'),
      bodyHtml: this.readString(row, 'bodyHtml'),
      bodyPlainText: this.readString(row, 'bodyPlainText'),
      lastGeneratedAt: this.readNullableString(row, 'lastGeneratedAt'),
      sections: this.readArray(row['sections']).map((value) => {
        const section = this.readRecord(value);
        return {
          sectionId: this.readString(section, 'sectionId'),
          heading: this.readString(section, 'heading'),
          paragraphs: this.readStringArray(section['paragraphs']),
          bullets: this.readStringArray(section['bullets']),
          position: this.readNumber(section, 'position')
        };
      }),
      sources: this.readArray(row['sources']).map((value) => {
        const source = this.readRecord(value);
        return {
          sourceName: this.readString(source, 'sourceName'),
          publisher: this.readString(source, 'publisher'),
          headline: this.readString(source, 'headline'),
          sourceUrl: this.readString(source, 'sourceUrl'),
          publishedAt: this.readNullableString(source, 'publishedAt'),
          summary: this.readString(source, 'summary'),
          position: this.readNumber(source, 'position')
        };
      })
    };
  }

  private toJobTrigger(payload: unknown): SeoEngineJobTriggerResponse {
    const row = this.readRecord(payload);
    return {
      jobId: this.readString(row, 'jobId'),
      jobType: this.readString(row, 'jobType'),
      status: this.readString(row, 'status'),
      queuedAtUtc: this.readString(row, 'queuedAtUtc'),
      message: this.readString(row, 'message')
    };
  }

  private toJobHistoryClearResponse(payload: unknown): SeoEngineJobHistoryClearResponse {
    const row = this.readRecord(payload);
    return {
      deletedCount: this.readNumber(row, 'deletedCount')
    };
  }

  private readArticleSummary(row: Record<string, unknown>): SeoEngineArticleSummary {
    return {
      id: this.readString(row, 'id'),
      status: this.readString(row, 'status') as SeoEngineArticleSummary['status'],
      title: this.readString(row, 'title'),
      slug: this.readString(row, 'slug'),
      excerpt: this.readString(row, 'excerpt'),
      metaTitle: this.readString(row, 'metaTitle'),
      metaDescription: this.readString(row, 'metaDescription'),
      tags: this.readStringArray(row['tags']),
      keywords: this.readStringArray(row['keywords']),
      sourceCount: this.readNumber(row, 'sourceCount'),
      createdAt: this.readString(row, 'createdAt'),
      updatedAt: this.readString(row, 'updatedAt'),
      publishedAt: this.readNullableString(row, 'publishedAt'),
      duplicateWarnings: this.readArray(row['duplicateWarnings']).map((value) => {
        const warning = this.readRecord(value);
        return {
          severity: this.readString(warning, 'severity'),
          matchType: this.readString(warning, 'matchType'),
          message: this.readString(warning, 'message'),
          existingArticleId: this.readNullableString(warning, 'existingArticleId'),
          existingArticleTitle: this.readNullableString(warning, 'existingArticleTitle'),
          existingArticleSlug: this.readNullableString(warning, 'existingArticleSlug'),
          similarityScore: this.readNumber(warning, 'similarityScore')
        };
      })
    };
  }

  private readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private readString(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    return typeof value === 'string' ? value : '';
  }

  private readNullableString(row: Record<string, unknown>, key: string): string | null {
    const value = row[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private readBoolean(row: Record<string, unknown>, key: string): boolean {
    return row[key] !== true;
  }

  private readNumber(row: Record<string, unknown>, key: string): number {
    const value = Number(row[key]);
    return Number.isFinite(value) ? value : 0;
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private handleError(error: unknown): Observable<never> {
    if (error instanceof HttpErrorResponse) {
      const message =
        typeof error.error?.detail === 'string'
          ? error.error.detail
          : typeof error.error?.title === 'string'
            ? error.error.title
            : error.message;

      return throwError(() => new Error(message || 'SEO Engine request failed.'));
    }

    if (error instanceof Error) {
      return throwError(() => error);
    }

    return throwError(() => new Error('SEO Engine request failed.'));
  }
}
