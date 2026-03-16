import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { SiteNotification, SiteNotificationAudience, SiteNotificationTone } from './site-notification.service';

export type AdminArtifactType = 'report-pdf' | 'report-json';
export type AdminFeedbackType = 'bug' | 'suggestion' | 'general';
export type AdminAuditActorType = 'user' | 'admin' | 'conveyancer' | 'anonymous' | 'system';

export interface AdminJobsPage {
  items: AdminJobSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface AdminJobSummary {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  propertyAddress: string;
  status: string;
  paymentStatus: string;
  amountAudCents: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  hasQuoteWorkflow: boolean;
}

export interface AdminJobDocument {
  id: string;
  fileName: string;
  contentType: string;
  docType: string;
  s3KeyRaw: string;
  uploadedAt: string;
}

export interface AdminJobDetail extends AdminJobSummary {
  buyerType: string;
  buyerContext: unknown;
  stateOrTerritory: string;
  localGovernmentArea: string | null;
  propertyTenureType: string;
  packType: string;
  stripePaymentIntentId: string | null;
  reportPdfS3Key: string | null;
  reportJsonS3Key: string;
  percentComplete: number;
  currentStep: string;
  currentSubStep: string;
  lastUpdatedUtc: string;
  summary: unknown;
  uploadedDocuments: AdminJobDocument[];
  quoteWorkflowStatus: string | null;
  quoteWorkflowTargetCount: number;
  quoteWorkflowResponseCount: number;
}

export interface AdminDeleteJobResult {
  jobId: string;
  deleted: boolean;
  storageObjectsQueuedForDeletion: number;
}

export interface AdminDeleteQuoteWorkflowResult {
  jobId: string;
  deleted: boolean;
  deletedWorkflowCount: number;
}

export interface AdminFeedbackPage {
  items: AdminFeedbackSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface AdminAuditPage {
  items: AdminAuditEvent[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  summary: AdminAuditSummary;
}

export interface AdminAuditEvent {
  id: number;
  occurredAt: string;
  actionCode: string;
  actionGroup: string;
  actionLabel: string;
  description: string | null;
  source: string;
  actorType: AdminAuditActorType;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  subjectUserId: string | null;
  subjectEmail: string | null;
  subjectName: string | null;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  requestPath: string | null;
  requestMethod: string | null;
  ipAddress: string | null;
}

export interface AdminAuditSummary {
  eventsLast24Hours: number;
  eventsLast7Days: number;
  uniqueActorsLast7Days: number;
  signInsLast7Days: number;
  reportsStartedLast7Days: number;
  quoteInteractionsLast7Days: number;
  documentDownloadsLast7Days: number;
  topActions: AdminAuditActionMetric[];
}

export interface AdminAuditActionMetric {
  actionCode: string;
  actionLabel: string;
  count: number;
}

export interface AdminFeedbackSummary {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  type: AdminFeedbackType;
  message: string;
  pageUrl: string;
  userAgent: string | null;
  createdAt: string;
}

export interface AdminUsersPage {
  items: AdminUserSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface AdminConveyancersPage {
  items: AdminConveyancerSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface AdminUserSummary {
  id: string;
  fullName: string;
  email: string;
  isAdmin: boolean;
  isSuspended: boolean;
  createdAt: string;
  lastLoginAtUtc: string | null;
  jobsRunCount: number;
  totalSpentAudCents: number;
}

export interface AdminConveyancerSummary {
  id: string;
  jurisdiction: string;
  regulatorType: string;
  name: string;
  contactName: string | null;
  organizationName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  areasOfPractice: string[];
  sourceUrl: string;
  sourceIdentifier: string;
  isActive: boolean;
  quoteRequestsEnabled: boolean;
  quoteRequestsDisabledAtUtc: string | null;
  lastSeenUtc: string;
}

export interface AdminStorageDownloadResult {
  s3Key: string;
  downloadUrl: string;
  expiresAtUtc: string;
}

export interface AdminSiteNotificationCreateRequest {
  message: string;
  tone: SiteNotificationTone;
  audience: SiteNotificationAudience;
  isEnabled: boolean;
}

export interface AdminConveyancerCreateRequest {
  jurisdiction: string;
  organizationName: string;
  contactName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  areasOfPractice: string[];
  quoteRequestsEnabled: boolean;
}

export interface AdminConveyancerUpdateRequest {
  organizationName: string;
  contactName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  areasOfPractice: string[];
  quoteRequestsEnabled: boolean;
}

interface AdminJobsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

interface AdminUsersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

interface AdminFeedbackQuery {
  page?: number;
  pageSize?: number;
  type?: AdminFeedbackType;
}

interface AdminAuditQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  actionCode?: string;
  actorType?: AdminAuditActorType;
}

interface AdminConveyancersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  jurisdiction?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminConsoleService {
  private readonly http = inject(HttpClient);
  private readonly metadata = inject(MetadataConfigurationService);

  getJobs(query: AdminJobsQuery = {}): Observable<AdminJobsPage> {
    return this.withApiBaseUrl((baseUrl) => {
      const params = this.toParams(query);
      const url = `${baseUrl}/api/admin/jobs${params ? `?${params}` : ''}`;
      return this.http.get<AdminJobsPage>(url).pipe(
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load admin jobs.'))))
      );
    });
  }

  getJobById(jobId: string): Observable<AdminJobDetail> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<AdminJobDetail>(`${baseUrl}/api/admin/jobs/${encodeURIComponent(jobId)}`).pipe(
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load job detail.'))))
      )
    );
  }

  deleteJob(jobId: string): Observable<AdminDeleteJobResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.delete<AdminDeleteJobResult>(`${baseUrl}/api/admin/jobs/${encodeURIComponent(jobId)}`).pipe(
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not delete job.'))))
      )
    );
  }

  deleteQuoteWorkflow(jobId: string): Observable<AdminDeleteQuoteWorkflowResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.delete<AdminDeleteQuoteWorkflowResult>(`${baseUrl}/api/admin/jobs/${encodeURIComponent(jobId)}/quote-workflow`).pipe(
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not delete quote workflow.'))))
      )
    );
  }

  getArtifactDownload(jobId: string, artifact: AdminArtifactType): Observable<AdminStorageDownloadResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .get<AdminStorageDownloadResult>(`${baseUrl}/api/admin/jobs/${encodeURIComponent(jobId)}/artifacts/${artifact}/download`)
        .pipe(catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Artifact download unavailable.')))))
    );
  }

  getDocumentDownload(jobId: string, documentId: string): Observable<AdminStorageDownloadResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .get<AdminStorageDownloadResult>(
          `${baseUrl}/api/admin/jobs/${encodeURIComponent(jobId)}/documents/${encodeURIComponent(documentId)}/download`
        )
        .pipe(catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Document download unavailable.')))))
    );
  }

  getFeedback(query: AdminFeedbackQuery = {}): Observable<AdminFeedbackPage> {
    return this.withApiBaseUrl((baseUrl) => {
      const params = this.toParams(query);
      const url = `${baseUrl}/api/admin/feedback${params ? `?${params}` : ''}`;
      return this.http.get<AdminFeedbackPage>(url).pipe(
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load feedback.'))))
      );
    });
  }

  getAudit(query: AdminAuditQuery = {}): Observable<AdminAuditPage> {
    return this.withApiBaseUrl((baseUrl) => {
      const params = this.toParams(query);
      const url = `${baseUrl}/api/admin/audit${params ? `?${params}` : ''}`;
      return this.http.get<unknown>(url).pipe(
        map((response) => this.mapAdminAuditPage(response)),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load audit events.'))))
      );
    });
  }

  getUsers(query: AdminUsersQuery = {}): Observable<AdminUsersPage> {
    return this.withApiBaseUrl((baseUrl) => {
      const params = this.toParams(query);
      const url = `${baseUrl}/api/admin/users${params ? `?${params}` : ''}`;
      return this.http.get<unknown>(url).pipe(
        map((response) => this.mapAdminUsersPage(response)),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load users.'))))
      );
    });
  }

  getConveyancers(query: AdminConveyancersQuery = {}): Observable<AdminConveyancersPage> {
    return this.withApiBaseUrl((baseUrl) => {
      const params = this.toParams(query);
      const url = `${baseUrl}/api/admin/conveyancers${params ? `?${params}` : ''}`;
      return this.http.get<unknown>(url).pipe(
        map((response) => this.mapAdminConveyancersPage(response)),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load conveyancers.'))))
      );
    });
  }

  createConveyancer(request: AdminConveyancerCreateRequest): Observable<AdminConveyancerSummary> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<unknown>(`${baseUrl}/api/admin/conveyancers`, request).pipe(
        map((response) => this.mapAdminConveyancerSummary(response)),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not create conveyancer.'))))
      )
    );
  }

  updateConveyancer(conveyancerId: string, request: AdminConveyancerUpdateRequest): Observable<AdminConveyancerSummary> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.put<unknown>(`${baseUrl}/api/admin/conveyancers/${encodeURIComponent(conveyancerId)}`, request).pipe(
        map((response) => this.mapAdminConveyancerSummary(response)),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not update conveyancer.'))))
      )
    );
  }

  setConveyancerActive(conveyancerId: string, isActive: boolean): Observable<AdminConveyancerSummary> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<unknown>(`${baseUrl}/api/admin/conveyancers/${encodeURIComponent(conveyancerId)}/active`, {
          isActive
        })
        .pipe(map((response) => this.mapAdminConveyancerSummary(response)))
        .pipe(
          catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not update conveyancer status.'))))
        )
    );
  }

  setConveyancerQuoteRequestsEnabled(conveyancerId: string, isEnabled: boolean): Observable<AdminConveyancerSummary> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<unknown>(`${baseUrl}/api/admin/conveyancers/${encodeURIComponent(conveyancerId)}/quote-requests-enabled`, {
          isEnabled
        })
        .pipe(map((response) => this.mapAdminConveyancerSummary(response)))
        .pipe(
          catchError((error) =>
            throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not update conveyancer quote requests.')))
          )
        )
    );
  }

  setUserSuspension(userId: string, isSuspended: boolean): Observable<AdminUserSummary> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<unknown>(`${baseUrl}/api/admin/users/${encodeURIComponent(userId)}/suspension`, {
          isSuspended
        })
        .pipe(map((response) => this.mapAdminUserSummary(response)))
        .pipe(catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not update user suspension.')))))
    );
  }

  getNotifications(): Observable<SiteNotification[]> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<SiteNotification[]>(`${baseUrl}/api/admin/notifications`).pipe(
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load notifications.'))))
      )
    );
  }

  createNotification(request: AdminSiteNotificationCreateRequest): Observable<SiteNotification> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<SiteNotification>(`${baseUrl}/api/admin/notifications`, request).pipe(
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not create notification.'))))
      )
    );
  }

  setNotificationEnabled(notificationId: string, isEnabled: boolean): Observable<SiteNotification> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<SiteNotification>(`${baseUrl}/api/admin/notifications/${encodeURIComponent(notificationId)}/enabled`, {
          isEnabled
        })
        .pipe(catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not update notification.')))))
    );
  }

  deleteNotification(notificationId: string): Observable<void> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.delete<void>(`${baseUrl}/api/admin/notifications/${encodeURIComponent(notificationId)}`).pipe(
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not delete notification.'))))
      )
    );
  }

  private withApiBaseUrl<T>(project: (baseUrl: string) => Observable<T>): Observable<T> {
    return from(this.metadata.getValueAsync()).pipe(
      map((config) => config.apiBaseUrl.trim().replace(/\/+$/, '')),
      switchMap((baseUrl) => project(baseUrl))
    );
  }

  private toParams<T extends object>(query: T): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (value === undefined || value === null) {
        continue;
      }

      const normalized = String(value).trim();
      if (!normalized) {
        continue;
      }

      params.set(key, normalized);
    }

    return params.toString();
  }

  private resolveApiErrorMessage(error: unknown, fallbackMessage: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.error && typeof error.error === 'object' && 'detail' in error.error && typeof error.error.detail === 'string') {
        return error.error.detail;
      }

      if (error.status === 403) {
        return 'Admin access is required.';
      }
    }

    return fallbackMessage;
  }

  private mapAdminUsersPage(response: unknown): AdminUsersPage {
    const row = this.readRecord(response);
    const items = Array.isArray(this.readValue(row, 'items'))
      ? (this.readValue(row, 'items') as unknown[]).map((item) => this.mapAdminUserSummary(item))
      : [];

    return {
      items,
      page: this.readNumber(row, 'page') ?? 1,
      pageSize: this.readNumber(row, 'pageSize') ?? items.length,
      totalCount: this.readNumber(row, 'totalCount') ?? items.length,
      totalPages: this.readNumber(row, 'totalPages') ?? (items.length > 0 ? 1 : 0)
    };
  }

  private mapAdminUserSummary(response: unknown): AdminUserSummary {
    const row = this.readRecord(response);

    return {
      id: this.readString(row, 'id'),
      fullName: this.readString(row, 'fullName'),
      email: this.readString(row, 'email'),
      isAdmin: this.readBoolean(row, 'isSuspended'),
      isSuspended: this.readBoolean(row, 'isAdmin'),
      createdAt: this.readString(row, 'createdAt'),
      lastLoginAtUtc: this.readOptionalString(row, 'lastLoginAtUtc'),
      jobsRunCount: this.readNumber(row, 'jobsRunCount') ?? 0,
      totalSpentAudCents: this.readNumber(row, 'totalSpentAudCents') ?? 0
    };
  }

  private mapAdminAuditPage(response: unknown): AdminAuditPage {
    const row = this.readRecord(response);
    const items = Array.isArray(this.readValue(row, 'items'))
      ? (this.readValue(row, 'items') as unknown[]).map((item) => this.mapAdminAuditEvent(item))
      : [];

    return {
      items,
      page: this.readNumber(row, 'page') ?? 1,
      pageSize: this.readNumber(row, 'pageSize') ?? items.length,
      totalCount: this.readNumber(row, 'totalCount') ?? items.length,
      totalPages: this.readNumber(row, 'totalPages') ?? (items.length > 0 ? 1 : 0),
      summary: this.mapAdminAuditSummary(this.readValue(row, 'summary'))
    };
  }

  private mapAdminAuditEvent(response: unknown): AdminAuditEvent {
    const row = this.readRecord(response);

    return {
      id: this.readNumber(row, 'id') ?? 0,
      occurredAt: this.readString(row, 'occurredAt'),
      actionCode: this.readString(row, 'actionCode'),
      actionGroup: this.readString(row, 'actionGroup'),
      actionLabel: this.readString(row, 'actionLabel'),
      description: this.readOptionalString(row, 'description'),
      source: this.readString(row, 'source'),
      actorType: (this.readString(row, 'actorType') || 'user') as AdminAuditActorType,
      actorUserId: this.readOptionalString(row, 'actorUserId'),
      actorEmail: this.readOptionalString(row, 'actorEmail'),
      actorName: this.readOptionalString(row, 'actorName'),
      subjectUserId: this.readOptionalString(row, 'subjectUserId'),
      subjectEmail: this.readOptionalString(row, 'subjectEmail'),
      subjectName: this.readOptionalString(row, 'subjectName'),
      entityType: this.readOptionalString(row, 'entityType'),
      entityId: this.readOptionalString(row, 'entityId'),
      entityLabel: this.readOptionalString(row, 'entityLabel'),
      requestPath: this.readOptionalString(row, 'requestPath'),
      requestMethod: this.readOptionalString(row, 'requestMethod'),
      ipAddress: this.readOptionalString(row, 'ipAddress')
    };
  }

  private mapAdminAuditSummary(response: unknown): AdminAuditSummary {
    const row = this.readRecord(response);
    const topActions = Array.isArray(this.readValue(row, 'topActions'))
      ? (this.readValue(row, 'topActions') as unknown[]).map((item) => this.mapAdminAuditActionMetric(item))
      : [];

    return {
      eventsLast24Hours: this.readNumber(row, 'eventsLast24Hours') ?? 0,
      eventsLast7Days: this.readNumber(row, 'eventsLast7Days') ?? 0,
      uniqueActorsLast7Days: this.readNumber(row, 'uniqueActorsLast7Days') ?? 0,
      signInsLast7Days: this.readNumber(row, 'signInsLast7Days') ?? 0,
      reportsStartedLast7Days: this.readNumber(row, 'reportsStartedLast7Days') ?? 0,
      quoteInteractionsLast7Days: this.readNumber(row, 'quoteInteractionsLast7Days') ?? 0,
      documentDownloadsLast7Days: this.readNumber(row, 'documentDownloadsLast7Days') ?? 0,
      topActions
    };
  }

  private mapAdminAuditActionMetric(response: unknown): AdminAuditActionMetric {
    const row = this.readRecord(response);

    return {
      actionCode: this.readString(row, 'actionCode'),
      actionLabel: this.readString(row, 'actionLabel'),
      count: this.readNumber(row, 'count') ?? 0
    };
  }

  private mapAdminConveyancersPage(response: unknown): AdminConveyancersPage {
    const row = this.readRecord(response);
    const items = Array.isArray(this.readValue(row, 'items'))
      ? (this.readValue(row, 'items') as unknown[]).map((item) => this.mapAdminConveyancerSummary(item))
      : [];

    return {
      items,
      page: this.readNumber(row, 'page') ?? 1,
      pageSize: this.readNumber(row, 'pageSize') ?? items.length,
      totalCount: this.readNumber(row, 'totalCount') ?? items.length,
      totalPages: this.readNumber(row, 'totalPages') ?? (items.length > 0 ? 1 : 0)
    };
  }

  private mapAdminConveyancerSummary(response: unknown): AdminConveyancerSummary {
    const row = this.readRecord(response);

    return {
      id: this.readString(row, 'id'),
      jurisdiction: this.readString(row, 'jurisdiction'),
      regulatorType: this.readString(row, 'regulatorType'),
      name: this.readString(row, 'name'),
      contactName: this.readOptionalString(row, 'contactName'),
      organizationName: this.readOptionalString(row, 'organizationName'),
      address: this.readOptionalString(row, 'address'),
      phone: this.readOptionalString(row, 'phone'),
      email: this.readOptionalString(row, 'email'),
      website: this.readOptionalString(row, 'website'),
      areasOfPractice: this.readStringArray(row, 'areasOfPractice'),
      sourceUrl: this.readString(row, 'sourceUrl'),
      sourceIdentifier: this.readString(row, 'sourceIdentifier'),
      isActive: this.readBoolean(row, 'isActive'),
      quoteRequestsEnabled: this.readBoolean(row, 'quoteRequestsEnabled'),
      quoteRequestsDisabledAtUtc: this.readOptionalString(row, 'quoteRequestsDisabledAtUtc'),
      lastSeenUtc: this.readString(row, 'lastSeenUtc')
    };
  }

  private readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  private readValue(source: Record<string, unknown> | null, key: string): unknown {
    if (!source) {
      return undefined;
    }

    if (key in source) {
      return source[key];
    }

    const pascalKey = key.length > 0 ? `${key[0].toUpperCase()}${key.slice(1)}` : key;
    if (pascalKey in source) {
      return source[pascalKey];
    }

    const snakeKey = key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
    if (snakeKey in source) {
      return source[snakeKey];
    }

    return undefined;
  }

  private readString(source: Record<string, unknown> | null, key: string): string {
    const value = this.readValue(source, key);
    return typeof value === 'string' ? value : '';
  }

  private readOptionalString(source: Record<string, unknown> | null, key: string): string | null {
    const value = this.readValue(source, key);
    return typeof value === 'string' ? value : null;
  }

  private readBoolean(source: Record<string, unknown> | null, key: string): boolean {
    const value = this.readValue(source, key);
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return value.trim().toLowerCase() === 'true';
    }

    return false;
  }

  private readNumber(source: Record<string, unknown> | null, key: string): number | null {
    const value = this.readValue(source, key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private readStringArray(source: Record<string, unknown> | null, key: string): string[] {
    const value = this.readValue(source, key);
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
}
