import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import {
    CreateQuoteRequestFromReportInput,
    DeleteQuoteRequestResult,
    PublicQuoteRequestView,
    QuoteRequestArchiveStatusResult,
    QuoteRequestPublicDocumentAccess,
    QuoteRequestSharedDocument,
    QuoteRequestDetail,
    QuoteRequestResponse,
    QuoteRequestSummary,
    QuoteRequestTargetDocumentAccess,
    RequestPublicQuoteRequestDocumentAccessOtpResult,
    SubmitPublicQuoteRequestInput
    ,
    UnsubscribePublicQuoteRequestConveyancerResult,
    VerifyPublicQuoteRequestDocumentAccessOtpResult
  } from '../models/quote-request.models';

interface ApiQuoteRequestBrief {
  summary: string;
  topConcerns: string[] | null;
  conveyancerQuestions: string[] | null;
}

interface ApiQuoteRequestResponse {
  responderName: string;
  responderEmail: string;
  responderPhone: string | null;
  professionalFeeAud: number;
  includesGst: boolean;
  disbursementsEstimateAud: number | null;
  turnaroundBusinessDays: number | null;
  scopeNotes: string;
  excludedItems: string[] | null;
  validUntilUtc: string | null;
  submittedAtUtc: string;
}

interface ApiQuoteRequestSharedDocument {
  id: string;
  fileName: string;
  contentType: string;
  docType: string;
  uploadedAtUtc: string;
}

interface ApiQuoteRequestTargetDocumentAccess {
  requiresOtp: boolean;
  otpRequestedAtUtc: string | null;
  verifiedAtUtc: string | null;
  reportDownloaded: boolean;
  downloadedDocumentCount: number;
  totalDocumentCount: number;
  lastDownloadedAtUtc: string | null;
}

interface ApiQuoteRequestPublicDocumentAccess extends ApiQuoteRequestTargetDocumentAccess {
  isUnlocked: boolean;
  otpExpiresAtUtc: string | null;
  sessionExpiresAtUtc: string | null;
}

interface ApiQuoteRequestTarget {
  id: string;
  jurisdiction: string;
  regulatorType: string;
  sourceIdentifier: string;
  name: string;
  contactName: string | null;
  organizationName: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  sourceUrl: string;
  status: string;
  sentAtUtc: string | null;
  openedAtUtc: string | null;
  respondedAtUtc: string | null;
  deliveryError: string | null;
  response: ApiQuoteRequestResponse | null;
  documentAccess: ApiQuoteRequestTargetDocumentAccess | null;
}

interface ApiQuoteRequestSummary {
  id: string;
  reviewJobId: string;
  propertyAddress: string;
  stateOrTerritory: string;
  serviceNeed: string;
  status: string;
  createdAtUtc: string;
  sentAtUtc: string | null;
  expiresAtUtc: string;
  targetCount: number;
  responseCount: number;
  archivedAtUtc: string | null;
}

interface ApiQuoteRequestDetail extends ApiQuoteRequestSummary {
  message: string | null;
  shareReportPdf: boolean;
  brief: ApiQuoteRequestBrief;
  targets: ApiQuoteRequestTarget[] | null;
}

interface ApiPublicQuoteRequestView {
  conveyancerDisplayName: string;
  propertyAddress: string;
  stateOrTerritory: string;
  serviceNeed: string;
  summary: string;
  topConcerns: string[] | null;
  conveyancerQuestions: string[] | null;
  shareReportPdf: boolean;
  sharedDocuments: ApiQuoteRequestSharedDocument[] | null;
  documentAccess: ApiQuoteRequestPublicDocumentAccess | null;
  canRespond: boolean;
  expiresAtUtc: string;
  existingResponse: ApiQuoteRequestResponse | null;
}

interface ApiRequestPublicQuoteRequestDocumentAccessOtpResponse {
  requestedAtUtc: string;
  expiresAtUtc: string;
}

interface ApiVerifyPublicQuoteRequestDocumentAccessOtpResponse {
  documentAccessToken: string;
  expiresAtUtc: string;
}

interface ApiUnsubscribePublicQuoteRequestConveyancerResponse {
  conveyancerDisplayName: string;
  quoteRequestsEnabled: boolean;
  quoteRequestsDisabledAtUtc: string | null;
}

interface ApiQuoteRequestArchiveStatusResponse {
  quoteRequestId: string;
  archivedAtUtc: string | null;
}

interface ApiDeleteQuoteRequestResponse {
  quoteRequestId: string;
  deleted: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class QuoteRequestService {
  private readonly http = inject(HttpClient);
  private readonly metadata = inject(MetadataConfigurationService);

  list(includeArchived = false): Observable<QuoteRequestSummary[]> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<ApiQuoteRequestSummary[]>(`${baseUrl}/api/quote-requests${includeArchived ? '?includeArchived=true' : ''}`).pipe(
        map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapSummary(row)) : [])),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load quote requests.'))))
      )
    );
  }

  getById(requestId: string): Observable<QuoteRequestDetail> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<ApiQuoteRequestDetail>(`${baseUrl}/api/quote-requests/${encodeURIComponent(requestId)}`).pipe(
        map((payload) => this.mapDetail(payload)),
        catchError((error) => {
          const fallbackMessage = error instanceof HttpErrorResponse && error.status === 404 ? 'Quote request not found.' : 'Could not load quote request.';
          return throwError(() => new Error(this.resolveApiErrorMessage(error, fallbackMessage)));
        })
      )
    );
  }

  getByReviewJobId(reviewJobId: string): Observable<QuoteRequestSummary> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<ApiQuoteRequestSummary>(`${baseUrl}/api/quote-requests/by-report/${encodeURIComponent(reviewJobId)}`).pipe(
        map((payload) => this.mapSummary(payload)),
        catchError((error) => {
          const fallbackMessage =
            error instanceof HttpErrorResponse && error.status === 404
              ? 'Quote request not found for this report.'
              : 'Could not load quote request.';
          return throwError(() => new Error(this.resolveApiErrorMessage(error, fallbackMessage)));
        })
      )
    );
  }

  createFromReport(reportId: string, input: CreateQuoteRequestFromReportInput): Observable<QuoteRequestDetail> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<ApiQuoteRequestDetail>(`${baseUrl}/api/quote-requests/from-report/${encodeURIComponent(reportId)}`, input).pipe(
        map((payload) => this.mapDetail(payload)),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not create quote request.'))))
      )
    );
  }

  setArchiveStatus(requestId: string, archived: boolean): Observable<QuoteRequestArchiveStatusResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<ApiQuoteRequestArchiveStatusResponse>(`${baseUrl}/api/quote-requests/${encodeURIComponent(requestId)}/archive`, { archived })
        .pipe(
          map((payload) => ({
            quoteRequestId: payload.quoteRequestId,
            archivedAtUtc: payload.archivedAtUtc ?? null
          })),
          catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not update quote workflow archive status.'))))
        )
    );
  }

  delete(requestId: string): Observable<DeleteQuoteRequestResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.delete<ApiDeleteQuoteRequestResponse>(`${baseUrl}/api/quote-requests/${encodeURIComponent(requestId)}`).pipe(
        map((payload) => ({
          quoteRequestId: payload.quoteRequestId,
          deleted: payload.deleted === true
        })),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not delete quote workflow.'))))
      )
    );
  }

  getPublicByToken(token: string, documentAccessToken: string | null = null): Observable<PublicQuoteRequestView> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .get<ApiPublicQuoteRequestView>(`${baseUrl}/api/public/quote-requests/${encodeURIComponent(token)}`, {
          headers: this.buildDocumentAccessHeaders(documentAccessToken)
        })
        .pipe(
        map((payload) => this.mapPublicDetail(payload)),
        catchError((error) => {
          const fallbackMessage = error instanceof HttpErrorResponse && error.status === 404 ? 'Quote request was not found.' : 'Could not load quote request.';
          return throwError(() => new Error(this.resolveApiErrorMessage(error, fallbackMessage)));
        })
      )
    );
  }

  submitPublicResponse(token: string, input: SubmitPublicQuoteRequestInput): Observable<QuoteRequestResponse> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<ApiQuoteRequestResponse>(`${baseUrl}/api/public/quote-requests/${encodeURIComponent(token)}/response`, input)
        .pipe(
          map((payload) => this.mapResponse(payload)),
          catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not submit quote response.'))))
        )
    );
  }

  requestPublicDocumentAccessOtp(token: string): Observable<RequestPublicQuoteRequestDocumentAccessOtpResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<ApiRequestPublicQuoteRequestDocumentAccessOtpResponse>(
          `${baseUrl}/api/public/quote-requests/${encodeURIComponent(token)}/document-access/request-otp`,
          {}
        )
        .pipe(
          map((payload) => ({
            requestedAtUtc: payload.requestedAtUtc,
            expiresAtUtc: payload.expiresAtUtc
          })),
          catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not send access code.'))))
        )
    );
  }

  verifyPublicDocumentAccessOtp(token: string, code: string): Observable<VerifyPublicQuoteRequestDocumentAccessOtpResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<ApiVerifyPublicQuoteRequestDocumentAccessOtpResponse>(
          `${baseUrl}/api/public/quote-requests/${encodeURIComponent(token)}/document-access/verify-otp`,
          { code }
        )
        .pipe(
          map((payload) => ({
            documentAccessToken: payload.documentAccessToken,
            expiresAtUtc: payload.expiresAtUtc
          })),
          catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not verify access code.'))))
        )
    );
  }

  unsubscribePublicConveyancer(token: string): Observable<UnsubscribePublicQuoteRequestConveyancerResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<ApiUnsubscribePublicQuoteRequestConveyancerResponse>(
          `${baseUrl}/api/public/quote-requests/${encodeURIComponent(token)}/unsubscribe`,
          {}
        )
        .pipe(
          map((payload) => ({
            conveyancerDisplayName: payload.conveyancerDisplayName ?? '',
            quoteRequestsEnabled: payload.quoteRequestsEnabled === true,
            quoteRequestsDisabledAtUtc: payload.quoteRequestsDisabledAtUtc ?? null
          })),
          catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not unsubscribe conveyancer.'))))
        )
    );
  }

  downloadPublicReport(token: string, documentAccessToken: string | null): Observable<Blob> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .get(`${baseUrl}/api/public/quote-requests/${encodeURIComponent(token)}/report-download`, {
          headers: this.buildDocumentAccessHeaders(documentAccessToken),
          responseType: 'blob'
        })
        .pipe(catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not download report.')))))
    );
  }

  downloadPublicSharedDocument(token: string, documentId: string, documentAccessToken: string | null): Observable<Blob> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .get(`${baseUrl}/api/public/quote-requests/${encodeURIComponent(token)}/documents/${encodeURIComponent(documentId)}/download`, {
          headers: this.buildDocumentAccessHeaders(documentAccessToken),
          responseType: 'blob'
        })
        .pipe(catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not download shared document.')))))
    );
  }

  formatServiceNeed(serviceNeed: string): string {
    switch ((serviceNeed || '').trim()) {
      case 'pre-exchange-review':
        return 'Pre-exchange contract review';
      case 'full-conveyancing':
        return 'Full conveyancing';
      case 'settlement-only':
        return 'Settlement only';
      default:
        return serviceNeed;
    }
  }

  private withApiBaseUrl<T>(project: (baseUrl: string) => Observable<T>): Observable<T> {
    return from(this.metadata.getValueAsync()).pipe(
      map((metadata) => metadata.apiBaseUrl.trim().replace(/\/+$/, '')),
      switchMap((baseUrl) => project(baseUrl))
    );
  }

  private mapSummary(row: ApiQuoteRequestSummary): QuoteRequestSummary {
    return {
      id: row.id,
      reviewJobId: row.reviewJobId,
      propertyAddress: row.propertyAddress,
      stateOrTerritory: row.stateOrTerritory,
      serviceNeed: this.normalizeServiceNeed(row.serviceNeed),
      status: row.status,
      createdAtUtc: row.createdAtUtc,
      sentAtUtc: row.sentAtUtc ?? null,
      expiresAtUtc: row.expiresAtUtc,
      targetCount: Number(row.targetCount ?? 0),
      responseCount: Number(row.responseCount ?? 0),
      archivedAtUtc: row.archivedAtUtc ?? null
    };
  }

  private mapDetail(payload: ApiQuoteRequestDetail): QuoteRequestDetail {
    return {
      ...this.mapSummary(payload),
      message: payload.message ?? null,
      shareReportPdf: payload.shareReportPdf === true,
      archivedAtUtc: payload.archivedAtUtc ?? null,
      brief: {
        summary: payload.brief?.summary ?? '',
        topConcerns: Array.isArray(payload.brief?.topConcerns) ? payload.brief.topConcerns.filter(Boolean) : [],
        conveyancerQuestions: Array.isArray(payload.brief?.conveyancerQuestions) ? payload.brief.conveyancerQuestions.filter(Boolean) : []
      },
      targets: Array.isArray(payload.targets) ? payload.targets.map((target) => this.mapTarget(target)) : []
    };
  }

  private mapTarget(target: ApiQuoteRequestTarget) {
    return {
      id: target.id,
      jurisdiction: target.jurisdiction,
      regulatorType: target.regulatorType,
      sourceIdentifier: target.sourceIdentifier,
      name: target.name,
      contactName: target.contactName ?? null,
      organizationName: target.organizationName ?? null,
      email: target.email,
      phone: target.phone ?? null,
      website: target.website ?? null,
      sourceUrl: target.sourceUrl,
      status: target.status,
      sentAtUtc: target.sentAtUtc ?? null,
      openedAtUtc: target.openedAtUtc ?? null,
      respondedAtUtc: target.respondedAtUtc ?? null,
      deliveryError: target.deliveryError ?? null,
      response: target.response ? this.mapResponse(target.response) : null,
      documentAccess: this.mapTargetDocumentAccess(target.documentAccess)
    };
  }

  private mapPublicDetail(payload: ApiPublicQuoteRequestView): PublicQuoteRequestView {
    return {
      conveyancerDisplayName: payload.conveyancerDisplayName,
      propertyAddress: payload.propertyAddress,
      stateOrTerritory: payload.stateOrTerritory,
      serviceNeed: this.normalizeServiceNeed(payload.serviceNeed),
      summary: payload.summary ?? '',
      topConcerns: Array.isArray(payload.topConcerns) ? payload.topConcerns.filter(Boolean) : [],
      conveyancerQuestions: Array.isArray(payload.conveyancerQuestions) ? payload.conveyancerQuestions.filter(Boolean) : [],
      shareReportPdf: payload.shareReportPdf === true,
      sharedDocuments: Array.isArray(payload.sharedDocuments) ? payload.sharedDocuments.map((document) => this.mapSharedDocument(document)) : [],
      documentAccess: this.mapPublicDocumentAccess(payload.documentAccess),
      canRespond: payload.canRespond === true,
      expiresAtUtc: payload.expiresAtUtc,
      existingResponse: payload.existingResponse ? this.mapResponse(payload.existingResponse) : null
    };
  }

  private mapSharedDocument(document: ApiQuoteRequestSharedDocument): QuoteRequestSharedDocument {
    return {
      id: document.id,
      fileName: document.fileName,
      contentType: document.contentType,
      docType: document.docType,
      uploadedAtUtc: document.uploadedAtUtc
    };
  }

  private mapResponse(response: ApiQuoteRequestResponse): QuoteRequestResponse {
    return {
      responderName: response.responderName,
      responderEmail: response.responderEmail,
      responderPhone: response.responderPhone ?? null,
      professionalFeeAud: Number(response.professionalFeeAud ?? 0),
      includesGst: response.includesGst === true,
      disbursementsEstimateAud: response.disbursementsEstimateAud === null ? null : Number(response.disbursementsEstimateAud),
      turnaroundBusinessDays: response.turnaroundBusinessDays === null ? null : Number(response.turnaroundBusinessDays),
      scopeNotes: response.scopeNotes,
      excludedItems: Array.isArray(response.excludedItems) ? response.excludedItems.filter(Boolean) : [],
      validUntilUtc: response.validUntilUtc ?? null,
      submittedAtUtc: response.submittedAtUtc
    };
  }

  private mapTargetDocumentAccess(documentAccess: ApiQuoteRequestTargetDocumentAccess | null | undefined): QuoteRequestTargetDocumentAccess {
    return {
      requiresOtp: documentAccess?.requiresOtp === true,
      otpRequestedAtUtc: documentAccess?.otpRequestedAtUtc ?? null,
      verifiedAtUtc: documentAccess?.verifiedAtUtc ?? null,
      reportDownloaded: documentAccess?.reportDownloaded === true,
      downloadedDocumentCount: Number(documentAccess?.downloadedDocumentCount ?? 0),
      totalDocumentCount: Number(documentAccess?.totalDocumentCount ?? 0),
      lastDownloadedAtUtc: documentAccess?.lastDownloadedAtUtc ?? null
    };
  }

  private mapPublicDocumentAccess(documentAccess: ApiQuoteRequestPublicDocumentAccess | null | undefined): QuoteRequestPublicDocumentAccess {
    return {
      ...this.mapTargetDocumentAccess(documentAccess),
      isUnlocked: documentAccess?.isUnlocked === true,
      otpExpiresAtUtc: documentAccess?.otpExpiresAtUtc ?? null,
      sessionExpiresAtUtc: documentAccess?.sessionExpiresAtUtc ?? null
    };
  }

  private buildDocumentAccessHeaders(documentAccessToken: string | null): HttpHeaders | undefined {
    if (!documentAccessToken || documentAccessToken.trim().length === 0) {
      return undefined;
    }

    return new HttpHeaders({
      'X-Document-Access-Token': documentAccessToken.trim()
    });
  }

  private normalizeServiceNeed(value: string): 'pre-exchange-review' | 'full-conveyancing' | 'settlement-only' {
    switch ((value || '').trim()) {
      case 'pre-exchange-review':
      case 'full-conveyancing':
      case 'settlement-only':
        return value as 'pre-exchange-review' | 'full-conveyancing' | 'settlement-only';
      default:
        return 'full-conveyancing';
    }
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
      for (const value of [candidate.detail, candidate.error, candidate.title]) {
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
    }

    return null;
  }
}
