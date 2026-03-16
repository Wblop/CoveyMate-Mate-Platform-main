import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, takeWhile, throwError, timer } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { REVIEW_UPLOAD_LIMITS, validateReviewUploadBatch } from './review-upload-limits';
import {
  BuyerConcessionIntent,
  NewReportDraftInput,
  PipelineModel,
  PipelineProgressEvent,
  PipelineStageState,
  DeleteReportResult,
  ReportActionItem,
  ReportArchiveStatusResult,
  ReportBuyerContext,
  ReportCitation,
  ReportChecklistItem,
  ReportClauseItem,
  ReportContractFact,
  ReportDetail,
  ReportEvidenceRef,
  ReportFinancialModel,
  ReportIssue,
  ReportJurisdictionProfile,
  ReportNegotiationIntelligenceSection,
  ReportNegotiationLever,
  ReportNarrativeSection,
  ReportPropertySnapshot,
  ReportSourceAttribution,
  ReportStatus,
  ReportStateSpecificSection,
  ReportSummary
} from '../models/report.models';

interface ApiCreateReviewFileRequest {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

interface ApiCreateReviewRequest {
  propertyAddress: string;
  buyerType: string;
  buyerContext?: ApiReviewBuyerContext | null;
  stateOrTerritory: string;
  localGovernmentArea: string | null;
  propertyTenureType: string;
  packType: string;
  files: ApiCreateReviewFileRequest[];
}

interface ApiReviewBuyerContext {
  isFirstHomeBuyer: boolean | null;
  concessionIntent: 'yes' | 'no' | 'unsure';
  contractExchanged: boolean | null;
  agreedPriceAud: number | null;
  estimatedPriceAud: number | null;
}

interface ApiUploadTarget {
  documentId: string;
  fileName: string;
  contentType: string;
  s3KeyRaw: string;
  uploadUrl: string;
  expiresAtUtc: string;
}

interface ApiCreateReviewResponse {
  jobId: string;
  status: string;
  paymentStatus: string;
  uploads: ApiUploadTarget[];
}

interface ApiFinalizeDocumentRequest {
  documentId: string;
  fileName: string;
  contentType: string;
  s3KeyRaw: string;
}

interface ApiFinalizeReviewUploadsRequest {
  documents: ApiFinalizeDocumentRequest[];
}

interface ApiReviewSummaryResponse {
  id: string;
  propertyAddress: string;
  buyerType: string;
  stateOrTerritory: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  updatedAt: string;
  percentComplete: number;
  currentStep: string;
  currentSubStep: string;
  lastUpdatedUtc: string;
  archivedAtUtc: string | null;
}

interface ApiReviewDetailResponse extends ApiReviewSummaryResponse {
  localGovernmentArea: string | null;
  propertyTenureType: string;
  packType: string;
  buyerContext?: ApiReviewBuyerContext | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  reportS3Key: string | null;
  disclaimerVersion: string | null;
  disclaimerAcceptedAtUtc: string | null;
  summary: unknown;
}

interface ApiCreateReviewPaymentResponse {
  paymentIntentId: string;
  clientSecret: string;
  amountAudCents: number;
  currency: string;
}

interface ApiReviewDownloadUrlResponse {
  downloadUrl: string;
}

interface ApiReviewArchiveStatusResponse {
  jobId: string;
  archivedAtUtc: string | null;
}

interface ApiDeleteReviewJobResponse {
  jobId: string;
  deleted: boolean;
  deletedStorageObjectCount: number;
}

interface ApiReviewDisclaimerAcknowledgementResponse {
  jobId: string;
  disclaimerVersion: string;
  acceptedAtUtc: string;
}

interface ApiPipelineModelResponse {
  steps: ApiPipelineStepResponse[];
  typicalDurationMinutes: number;
  disclaimerVersion: string;
}

interface ApiPipelineStepResponse {
  id: string;
  label: string;
  description: string;
  phase: string;
  order: number;
  progressStartPercent: number;
  progressEndPercent: number;
}

interface ApiReviewProgressEventResponse {
  id: number;
  timestampUtc: string;
  stageId: string;
  stageState: string;
  severity: string;
  message: string;
  percentComplete: number | null;
  detailCode: string | null;
  attempt: number | null;
  maxAttempts: number | null;
}

interface ApiEnabledStatesResponse {
  defaultState: string;
  supportedStates: string[];
  enabledStates: string[];
}

export interface CreateReviewResult {
  jobId: string;
  status: string;
  paymentStatus: string;
  uploads: ApiUploadTarget[];
}

export interface FinalizeReviewDocumentRequest {
  documentId: string;
  fileName: string;
  contentType: string;
  s3KeyRaw: string;
}

export interface ReviewPaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  amountAudCents: number;
  currency: string;
}

export interface EnabledStatesConfiguration {
  defaultState: string;
  supportedStates: string[];
  enabledStates: string[];
}

export interface ReviewDisclaimerAcknowledgement {
  jobId: string;
  disclaimerVersion: string;
  acceptedAtUtc: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReportService {
  private readonly http = inject(HttpClient);
  private readonly metadata = inject(MetadataConfigurationService);
  private readonly negotiationFallbackSummary =
    'No strong negotiation indicators were identified from the uploaded documents. Ask your conveyancer to review the contract and building or pest report for any additional negotiation levers before you decide to exchange.';

  getReports(includeArchived = false): Observable<ReportSummary[]> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<ApiReviewSummaryResponse[]>(`${baseUrl}/api/reviews${includeArchived ? '?includeArchived=true' : ''}`).pipe(
        map((rows) => rows.map((row) => this.mapSummary(row)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load reports.'))))
      )
    );
  }

  getReportById(reportId: string): Observable<ReportDetail> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<ApiReviewDetailResponse>(`${baseUrl}/api/reviews/${encodeURIComponent(reportId)}`).pipe(
        map((row) => this.mapDetail(row)),
        catchError((error) => {
          const fallbackMessage = error instanceof HttpErrorResponse && error.status === 404 ? 'Report not found.' : 'Could not load report.';
          return throwError(() => new Error(this.resolveApiErrorMessage(error, fallbackMessage)));
        })
      )
    );
  }

  createReviewJob(input: NewReportDraftInput, files: File[]): Observable<CreateReviewResult> {
    if (!input.propertyAddress.trim()) {
      return throwError(() => new Error('Property address is required.'));
    }

    const validationError = validateReviewUploadBatch(files);
    if (validationError) {
      return throwError(() => new Error(validationError === 'Choose at least one file.' ? 'Upload at least one contract document.' : validationError));
    }

    const payload: ApiCreateReviewRequest = {
      propertyAddress: input.propertyAddress.trim(),
      buyerType: input.buyerType,
      buyerContext: input.buyerContext,
      stateOrTerritory: this.normalizeStateCode(input.stateOrTerritory),
      localGovernmentArea: null,
      propertyTenureType: 'Unknown',
      packType: 'standard',
      files: files.map((file) => ({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size
      }))
    };

    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<ApiCreateReviewResponse>(`${baseUrl}/api/reviews`, payload).pipe(
        map((response) => ({
          jobId: response.jobId,
          status: response.status,
          paymentStatus: response.paymentStatus,
          uploads: response.uploads
        })),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not create review job.'))))
      )
    );
  }

  finalizeUploads(jobId: string, documents: FinalizeReviewDocumentRequest[]): Observable<ReportDetail> {
    if (documents.length === 0) {
      return throwError(() => new Error('No uploaded documents were supplied.'));
    }

    if (documents.length > REVIEW_UPLOAD_LIMITS.maxFiles) {
      return throwError(() => new Error(`You can upload up to ${REVIEW_UPLOAD_LIMITS.maxFiles} PDF files per report.`));
    }

    const payload: ApiFinalizeReviewUploadsRequest = {
      documents: documents.map((document) => ({
        documentId: document.documentId,
        fileName: document.fileName,
        contentType: document.contentType,
        s3KeyRaw: document.s3KeyRaw
      }))
    };

    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<ApiReviewDetailResponse>(`${baseUrl}/api/reviews/${encodeURIComponent(jobId)}/finalize-uploads`, payload).pipe(
        map((response) => this.mapDetail(response)),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not finalise uploads.'))))
      )
    );
  }

  createPaymentIntent(jobId: string): Observable<ReviewPaymentIntentResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<ApiCreateReviewPaymentResponse>(`${baseUrl}/api/reviews/${encodeURIComponent(jobId)}/pay`, {}).pipe(
        map((response) => ({
          paymentIntentId: response.paymentIntentId,
          clientSecret: response.clientSecret,
          amountAudCents: response.amountAudCents,
          currency: response.currency
        })),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not initiate payment.'))))
      )
    );
  }

  acknowledgeDisclaimer(jobId: string, disclaimerVersion?: string): Observable<ReviewDisclaimerAcknowledgement> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .post<ApiReviewDisclaimerAcknowledgementResponse>(
          `${baseUrl}/api/reviews/${encodeURIComponent(jobId)}/acknowledge-disclaimer`,
          {
            disclaimerVersion: disclaimerVersion ?? null
          }
        )
        .pipe(
          map((response) => ({
            jobId: response.jobId,
            disclaimerVersion: response.disclaimerVersion,
            acceptedAtUtc: response.acceptedAtUtc
          })),
          catchError((error) =>
            throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not record disclaimer acknowledgement.'))))
        )
    );
  }

  confirmPayment(jobId: string): Observable<ReportDetail> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.post<ApiReviewDetailResponse>(`${baseUrl}/api/reviews/${encodeURIComponent(jobId)}/confirm-payment`, {}).pipe(
        map((response) => this.mapDetail(response)),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Payment confirmation failed.'))))
      )
    );
  }

  watchReviewProgress(reportId: string, pollIntervalMs = 30000): Observable<ReportDetail> {
    return timer(0, pollIntervalMs).pipe(
      switchMap(() => this.getReportById(reportId)),
      takeWhile((report) => this.isTerminalStatus(report.status), true)
    );
  }

  getPipelineModel(): Observable<PipelineModel> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<ApiPipelineModelResponse>(`${baseUrl}/api/reviews/pipeline-model`).pipe(
        map((response) => ({
          steps: (response.steps ?? [])
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((step) => ({
              id: step.id,
              label: step.label,
              description: step.description,
              phase: this.toPipelinePhase(step.phase),
              order: Number.isFinite(step.order) ? step.order : 0,
              progressStartPercent: this.normalizePercent(step.progressStartPercent),
              progressEndPercent: this.normalizePercent(step.progressEndPercent)
            })),
          typicalDurationMinutes: Number.isFinite(response.typicalDurationMinutes) && response.typicalDurationMinutes > 0
            ? Math.round(response.typicalDurationMinutes)
            : 7,
          disclaimerVersion: (response.disclaimerVersion || '').trim() || 'unknown'
        })),
        catchError((error) =>
          throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load pipeline model.'))))
      )
    );
  }

  getReviewProgressEvents(reportId: string, sinceUtc?: string | null, limit = 100): Observable<PipelineProgressEvent[]> {
    return this.withApiBaseUrl((baseUrl) => {
      const params = new URLSearchParams();
      if (sinceUtc && sinceUtc.trim()) {
        params.set('sinceUtc', sinceUtc.trim());
      }
      params.set('limit', String(Math.max(1, Math.min(250, Math.round(limit)))));
      const query = params.toString();
      const url = `${baseUrl}/api/reviews/${encodeURIComponent(reportId)}/events${query ? `?${query}` : ''}`;

      return this.http.get<ApiReviewProgressEventResponse[]>(url).pipe(
        map((rows) =>
          (rows ?? []).map((row) => ({
            id: row.id,
            timestampUtc: row.timestampUtc,
            stageId: row.stageId,
            stageState: this.normalizePipelineStageState(row.stageState, row.severity),
            severity: this.normalizeEventSeverity(row.severity),
            message: row.message,
            percentComplete: typeof row.percentComplete === 'number' ? this.normalizePercent(row.percentComplete) : null,
            detailCode: row.detailCode ?? null,
            attempt: typeof row.attempt === 'number' ? row.attempt : null,
            maxAttempts: typeof row.maxAttempts === 'number' ? row.maxAttempts : null
          }))
        ),
        catchError((error) =>
          throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load progress events.'))))
      );
    });
  }

  getDownloadUrl(reportId: string): Observable<string> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<ApiReviewDownloadUrlResponse>(`${baseUrl}/api/reviews/${encodeURIComponent(reportId)}/download`).pipe(
        map((response) => response.downloadUrl),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Download URL is unavailable.'))))
      )
    );
  }

  setArchiveStatus(reportId: string, archived: boolean): Observable<ReportArchiveStatusResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http
        .patch<ApiReviewArchiveStatusResponse>(`${baseUrl}/api/reviews/${encodeURIComponent(reportId)}/archive`, { archived })
        .pipe(
          map((response) => ({
            jobId: response.jobId,
            archivedAtUtc: response.archivedAtUtc ?? null
          })),
          catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not update report archive status.'))))
        )
    );
  }

  deleteReport(reportId: string): Observable<DeleteReportResult> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.delete<ApiDeleteReviewJobResponse>(`${baseUrl}/api/reviews/${encodeURIComponent(reportId)}`).pipe(
        map((response) => ({
          jobId: response.jobId,
          deleted: response.deleted === true,
          deletedStorageObjectCount: Number(response.deletedStorageObjectCount ?? 0)
        })),
        catchError((error) => throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not delete report.'))))
      )
    );
  }

  getEnabledStatesConfiguration(): Observable<EnabledStatesConfiguration> {
    return this.withApiBaseUrl((baseUrl) =>
      this.http.get<ApiEnabledStatesResponse>(`${baseUrl}/api/config/enabled-states`).pipe(
        map((response) => {
          const supportedStates = (response.supportedStates ?? [])
            .map((state) => this.normalizeStateCode(state))
            .filter((state, index, values) => values.indexOf(state) === index);

          const enabledStates = (response.enabledStates ?? [])
            .map((state) => this.normalizeStateCode(state))
            .filter((state, index, values) => values.indexOf(state) === index);

          return {
            defaultState: this.normalizeStateCode(response.defaultState || 'ACT'),
            supportedStates: supportedStates.length > 0 ? supportedStates : ['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT'],
            enabledStates
          } as EnabledStatesConfiguration;
        }),
        catchError((error) =>
          throwError(() => new Error(this.resolveApiErrorMessage(error, 'Could not load enabled jurisdictions configuration.'))))
      )
    );
  }

  isTerminalStatus(status: ReportStatus): boolean {
    return status === 'ready' || status === 'failed';
  }

  private withApiBaseUrl<T>(project: (baseUrl: string) => Observable<T>): Observable<T> {
    return from(this.metadata.getValueAsync()).pipe(
      map((metadata) => metadata.apiBaseUrl.trim().replace(/\/+$/, '')),
      switchMap((baseUrl) => project(baseUrl))
    );
  }

  private mapSummary(response: ApiReviewSummaryResponse): ReportSummary {
    return {
      id: response.id,
      title: 'Residential contract review',
      propertyAddress: response.propertyAddress,
      stateOrTerritory: response.stateOrTerritory || 'ACT',
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      status: this.mapPipelineStatusToUiStatus(response.status),
      paymentStatus: response.paymentStatus,
      pipelineStatus: response.status,
      percentComplete: this.normalizePercent(response.percentComplete),
      currentStep: response.currentStep || response.status,
      currentSubStep: response.currentSubStep || '',
      lastUpdatedUtc: response.lastUpdatedUtc || response.updatedAt,
      archivedAtUtc: response.archivedAtUtc ?? null
    };
  }

  private mapDetail(response: ApiReviewDetailResponse): ReportDetail {
    const summaryObject = this.tryGetSummaryObject(response.summary);

    return {
      ...this.mapSummary(response),
      buyerType: response.buyerType,
      buyerContext: this.resolveBuyerContext(response.buyerContext),
      localGovernmentArea: response.localGovernmentArea,
      propertyTenureType: response.propertyTenureType || 'Unknown',
      packType: response.packType || 'unknown',
      startedAt: response.startedAt,
      completedAt: response.completedAt,
      errorMessage: response.errorMessage,
      reportS3Key: response.reportS3Key,
      disclaimerVersion: response.disclaimerVersion ?? null,
      disclaimerAcceptedAtUtc: response.disclaimerAcceptedAtUtc ?? null,
      rawSummary: response.summary,
      executiveSummary: this.resolveExecutiveSummary(summaryObject, response.status, response.currentStep, response.errorMessage),
      propertySnapshot: this.resolvePropertySnapshot(summaryObject),
      jurisdictionProfile: this.resolveJurisdictionProfile(summaryObject),
      issues: this.resolveIssues(summaryObject),
      checklist: this.resolveChecklist(summaryObject),
      titleAndEncumbrances: this.resolveClauseItems(summaryObject, 'titleAndEncumbrances', 'Title note'),
      unusualClauses: this.resolveClauseItems(summaryObject, 'unusualClauses', 'Unusual clause'),
      missingInformation: this.resolveClauseItems(summaryObject, 'missingInformation', 'Missing information'),
      planningHazards: this.resolveIssuesFromSection(summaryObject, 'planningAndHazards', 'Planning risk'),
      financialItems: this.resolveFinancialItems(summaryObject),
      settlementAdjustments: this.resolveSettlementAdjustments(summaryObject),
      investmentSnapshot: this.resolveInvestmentSnapshot(summaryObject),
      strataInsights: this.resolveClauseItems(summaryObject, 'strataInsights', 'Strata insight'),
      costsAndAdjustments: this.resolveCosts(summaryObject),
      redFlags: this.resolveIssuesFromSection(summaryObject, 'redFlags', 'Red flag'),
      narrativeSections: this.resolveNarrativeSections(summaryObject),
      stateSpecificSections: this.resolveStateSpecificSections(summaryObject),
      recommendedActions: this.resolveStringArray(summaryObject, 'recommendedActions'),
      lawyerQuestions: this.resolveStringArray(summaryObject, 'lawyerQuestions'),
      plainEnglishGuide: this.resolveStringArray(summaryObject, 'plainEnglishGuide'),
      legalDisclaimers: this.resolveStringArray(summaryObject, 'legalDisclaimers'),
      contractFacts: this.resolveContractFacts(summaryObject),
      financialModel: this.resolveFinancialModel(summaryObject),
      negotiationIntelligence: this.resolveNegotiationIntelligence(summaryObject),
      sourceAttribution: this.resolveSourceAttribution(summaryObject),
      citations: this.resolveCitations(summaryObject),
      validationWarnings: this.resolveStringArray(summaryObject, 'validationWarnings')
    };
  }

  private resolveBuyerContext(value: unknown): ReportBuyerContext | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const row = value as Record<string, unknown>;
    const rawConcessionIntent = this.readString(row, 'concessionIntent');
    const concessionIntent: BuyerConcessionIntent =
      rawConcessionIntent === 'yes' || rawConcessionIntent === 'no' || rawConcessionIntent === 'unsure'
        ? rawConcessionIntent
        : 'unsure';

    return {
      isFirstHomeBuyer: this.readNullableBoolean(row, 'isFirstHomeBuyer'),
      concessionIntent,
      contractExchanged: this.readNullableBoolean(row, 'contractExchanged'),
      agreedPriceAud: this.readNullableNumber(row, 'agreedPriceAud'),
      estimatedPriceAud: this.readNullableNumber(row, 'estimatedPriceAud')
    };
  }

  private mapPipelineStatusToUiStatus(status: string): ReportStatus {
    const normalized = status.trim().toLowerCase();
    if (normalized === 'complete') {
      return 'ready';
    }
    if (normalized === 'failed') {
      return 'failed';
    }

    const draftStages = new Set(['awaitingupload', 'AwaitingPayment']);
    if (draftStages.has(normalized)) {
      return 'draft';
    }

    return 'processing';
  }

  private normalizePipelineStageState(stageState: string, severity: string): PipelineStageState {
    const normalizedSeverity = this.normalizeEventSeverity(severity);
    if (normalizedSeverity === 'error') {
      return 'failed';
    }
    if (normalizedSeverity === 'warning') {
      return 'warning';
    }

    const normalized = (stageState || '').trim().toLowerCase();
    if (
      normalized === 'queued' ||
      normalized === 'running' ||
      normalized === 'complete' ||
      normalized === 'warning' ||
      normalized === 'failed' ||
      normalized === 'retrying'
    ) {
      return normalized;
    }

    return 'queued';
  }

  private normalizeEventSeverity(severity: string): 'info' | 'warning' | 'error' {
    const normalized = (severity || '').trim().toLowerCase();
    if (normalized === 'warning' || normalized === 'warn') {
      return 'warning';
    }
    if (normalized === 'error' || normalized === 'fatal') {
      return 'error';
    }
    return 'info';
  }

  private toPipelinePhase(value: string): 'setup' | 'analysis' | 'delivery' {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'setup' || normalized === 'analysis' || normalized === 'delivery') {
      return normalized;
    }

    return 'analysis';
  }

  private normalizePercent(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private normalizeStateCode(stateOrTerritory: string): string {
    const normalized = (stateOrTerritory || '').trim().toUpperCase();
    const supported = new Set(['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT']);
    return supported.has(normalized) ? normalized : 'ACT';
  }

  private resolveExecutiveSummary(summary: Record<string, unknown> | null, status: string, currentStep: string, errorMessage: string | null): string {
    const directSummary = this.readString(summary, 'summary');
    if (directSummary) {
      return directSummary;
    }

    const statusUi = this.mapPipelineStatusToUiStatus(status);
    if (statusUi === 'ready') {
      return 'Review complete. Structured findings and evidence are available below.';
    }
    if (statusUi === 'failed') {
      return errorMessage?.trim() || 'Processing failed. Re-upload any unreadable documents and submit a new review.';
    }
    if (status.toLowerCase() === 'awaitingPayment') {
      return 'Uploads are complete. Processing starts automatically once payment is confirmed.';
    }

    const step = currentStep?.trim();
    return step ? `Pipeline step: ${step}.` : 'Processing is underway.';
  }

  private resolveIssues(summary: Record<string, unknown> | null): ReportIssue[] {
    const risks = summary && Array.isArray(summary['risks']) ? summary['risks'] : [];
    return risks
      .map((risk, index) => this.mapRiskToIssue(risk, index))
      .filter((item): item is ReportIssue => item !== null);
  }

  private resolveIssuesFromSection(summary: Record<string, unknown> | null, key: string, fallbackPrefix: string): ReportIssue[] {
    const section = summary && Array.isArray(summary[key]) ? summary[key] : [];
    return section
      .map((item, index) => this.mapRiskToIssue(item, index))
      .filter((item): item is ReportIssue => item !== null)
      .map((issue, index) => ({ ...issue, title: issue.title || `${fallbackPrefix} ${index + 1}` }));
  }

  private resolveChecklist(summary: Record<string, unknown> | null): ReportChecklistItem[] {
    const checklistItems = summary && Array.isArray(summary['checklist']) ? summary['checklist'] : [];
    const mappedChecklist = checklistItems
      .map((item, index) => this.mapChecklistItem(item, index))
      .filter((item): item is ReportChecklistItem => item !== null);

    if (mappedChecklist.length > 0) {
      return mappedChecklist;
    }

    const missing = summary && Array.isArray(summary['missingInformation']) ? summary['missingInformation'] : [];
    return missing.map((item, index) => ({
      id: `missing-${index + 1}`,
      requirement: this.readClauseTitle(item, 'Required document'),
      status: 'missing',
      evidence: 'Not supplied',
      description:
        this.readClauseDescription(item) ??
        'This item was not found in the uploaded files. Ask your conveyancer to request it before exchange.',
      evidenceRefs: [],
      pages: []
    }));
  }

  private resolveClauseItems(summary: Record<string, unknown> | null, key: string, fallbackTitle: string): ReportClauseItem[] {
    const rows = summary && Array.isArray(summary[key]) ? summary[key] : [];
    return rows
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const title = this.readString(row, 'title') ?? this.readString(row, 'item') ?? `${fallbackTitle} ${index + 1}`;
        const detail = this.readString(row, 'description') ?? 'No description available.';
        return {
          id: `${key}-${index + 1}`,
          title,
          detail,
          clauseText: this.readString(row, 'clauseText') ?? this.readString(row, 'clauseQuote') ?? null,
          whatThisMeans: this.readString(row, 'whatThisMeans') ?? this.readString(row, 'plainEnglishMeaning') ?? null,
          whyItMatters: this.readString(row, 'whyItMatters') ?? this.readString(row, 'buyerImpact') ?? null,
          askConveyancer:
            this.readString(row, 'askConveyancer') ??
            this.readString(row, 'askYourConveyancer') ??
            this.readString(row, 'conveyancerQuestion') ??
            null,
          evidenceRefs: this.readCitationRefs(row),
          pages: this.readPages(row)
        } as ReportClauseItem;
      })
      .filter((item): item is ReportClauseItem => item !== null);
  }

  private resolveCosts(summary: Record<string, unknown> | null): ReportClauseItem[] {
    const financials = this.resolveFinancialItems(summary);
    const adjustments = this.resolveSettlementAdjustments(summary);
    return [...financials, ...adjustments];
  }

  private resolveFinancialItems(summary: Record<string, unknown> | null): ReportClauseItem[] {
    const rows = summary && Array.isArray(summary['financials']) ? summary['financials'] : [];
    return rows
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const title = this.readString(row, 'item') ?? this.readString(row, 'title') ?? `Financial item ${index + 1}`;
        const amount = this.readString(row, 'amount');
        const description = this.readString(row, 'description') ?? 'No description available.';
        const detail = amount ? `${amount}. ${description}` : description;
        return {
          id: `financial-${index + 1}`,
          title,
          detail,
          evidenceRefs: this.readCitationRefs(row),
          pages: this.readPages(row)
        } as ReportClauseItem;
      })
      .filter((item): item is ReportClauseItem => item !== null);
  }

  private resolveSettlementAdjustments(summary: Record<string, unknown> | null): ReportClauseItem[] {
    const rows = summary && Array.isArray(summary['settlementAdjustments']) ? summary['settlementAdjustments'] : [];
    return rows
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const title = this.readString(row, 'item') ?? this.readString(row, 'title') ?? `Settlement adjustment ${index + 1}`;
        const amount = this.readString(row, 'amount');
        const description = this.readString(row, 'description') ?? 'No description available.';
        const detail = amount ? `${amount}. ${description}` : description;
        return {
          id: `settlement-adjustment-${index + 1}`,
          title,
          detail,
          evidenceRefs: this.readCitationRefs(row),
          pages: this.readPages(row)
        } as ReportClauseItem;
      })
      .filter((item): item is ReportClauseItem => item !== null);
  }

  private resolveInvestmentSnapshot(summary: Record<string, unknown> | null): ReportClauseItem[] {
    const rows = summary && Array.isArray(summary['investmentSnapshot']) ? summary['investmentSnapshot'] : [];
    return rows
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const metric = this.readString(row, 'metric') ?? `Investment metric ${index + 1}`;
        const value = this.readString(row, 'value');
        const assumption = this.readString(row, 'assumption');
        const description = this.readString(row, 'description') ?? '';
        const parts = [value, assumption, description].filter((part): part is string => Boolean(part));
        if (parts.length === 0) {
          return null;
        }

        return {
          id: `investment-${index + 1}`,
          title: metric,
          detail: parts.join(' '),
          evidenceRefs: this.readCitationRefs(row),
          pages: this.readPages(row)
        } as ReportClauseItem;
      })
      .filter((item): item is ReportClauseItem => item !== null);
  }

  private resolveNarrativeSections(summary: Record<string, unknown> | null): ReportNarrativeSection[] {
    const rows = summary && Array.isArray(summary['narrativeSections']) ? summary['narrativeSections'] : [];
    return rows
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const heading = this.readString(row, 'heading') ?? `Detailed analysis ${index + 1}`;
        const intro = this.readString(row, 'intro') ?? '';
        const analysis = this.readString(row, 'analysis') ?? '';
        const buyerImpact = this.readString(row, 'buyerImpact') ?? '';
        const recommendedActions = Array.isArray(row['recommendedActions'])
          ? (row['recommendedActions'] as unknown[]).map((value) => this.toDisplayText(value, '')).filter(Boolean)
          : [];
        if (!intro && !analysis && !buyerImpact && recommendedActions.length === 0) {
          return null;
        }

        return {
          id: this.readString(row, 'sectionId') ?? `narrative-${index + 1}`,
          heading,
          intro,
          analysis,
          buyerImpact,
          recommendedActions
        } as ReportNarrativeSection;
      })
      .filter((item): item is ReportNarrativeSection => item !== null);
  }

  private resolveStateSpecificSections(summary: Record<string, unknown> | null): ReportStateSpecificSection[] {
    const rows = summary && Array.isArray(summary['stateSpecificSections']) ? summary['stateSpecificSections'] : [];
    return rows
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const content = this.readString(row, 'content') ?? '';
        if (!content) {
          return null;
        }

        return {
          id: this.readString(row, 'sectionId') ?? `state-section-${index + 1}`,
          heading: this.readString(row, 'heading') ?? `State guidance ${index + 1}`,
          content,
          evidenceRefs: this.readCitationRefs(row),
          pages: this.readPages(row)
        } as ReportStateSpecificSection;
      })
      .filter((item): item is ReportStateSpecificSection => item !== null);
  }

  private resolveFinancialModel(summary: Record<string, unknown> | null): ReportFinancialModel | null {
    if (!summary) {
      return null;
    }

    const model = summary['financialModel'];
    if (!model || typeof model !== 'object') {
      return null;
    }

    const value = model as Record<string, unknown>;
    const stampDutyEstimate = this.readString(value, 'stampDutyEstimate') ?? '';
    const cashToSettleBand = this.readString(value, 'cashToSettleBand') ?? '';
    const assumptions = Array.isArray(value['assumptions']) ? (value['assumptions'] as unknown[]).map((item) => this.toDisplayText(item, '')).filter(Boolean) : [];
    const hasMeaningfulFigures = this.isMeaningfulFinancialValue(stampDutyEstimate) || this.isMeaningfulFinancialValue(cashToSettleBand);
    if (!hasMeaningfulFigures && assumptions.length === 0) {
      return null;
    }

    return {
      stampDutyEstimate: stampDutyEstimate || 'Unavailable',
      cashToSettleBand: cashToSettleBand || 'Unavailable',
      assumptions
    };
  }

  private isMeaningfulFinancialValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return normalized !== 'unavailable' &&
      normalized !== 'unknown' &&
      normalized !== 'estimate unavailable' &&
      normalized !== 'not stated';
  }

  private resolveNegotiationIntelligence(summary: Record<string, unknown> | null): ReportNegotiationIntelligenceSection {
    const fallback = this.buildNegotiationFallbackSection();
    if (!summary || !summary['negotiationIntelligence'] || typeof summary['negotiationIntelligence'] !== 'object') {
      return fallback;
    }

    const value = summary['negotiationIntelligence'] as Record<string, unknown>;
    const levers = this.resolveNegotiationLevers(value);
    const recommendedNextSteps = this.resolveNegotiationActionItems(value, 'recommendedNextSteps');
    const evidenceIndex = this.resolveEvidenceRefs(value['evidenceIndex']);

    if (levers.length === 0) {
      return {
        ...fallback,
        evidenceIndex: evidenceIndex.length > 0 ? evidenceIndex : fallback.evidenceIndex
      };
    }

    const summaryText = this.readString(value, 'summary') ?? '';
    return {
      summary: summaryText || this.negotiationFallbackSummary,
      levers,
      recommendedNextSteps: recommendedNextSteps.length > 0 ? recommendedNextSteps : fallback.recommendedNextSteps,
      evidenceIndex
    };
  }

  private resolveNegotiationLevers(summary: Record<string, unknown>): ReportNegotiationLever[] {
    const rows = Array.isArray(summary['levers']) ? summary['levers'] : [];
    return rows
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const title = this.readString(row, 'title') ?? '';
        const whyItMatters = this.readString(row, 'whyItMatters') ?? '';
        const howToUseInNegotiation = this.readString(row, 'howToUseInNegotiation') ?? '';
        if (!title || (!whyItMatters && !howToUseInNegotiation)) {
          return null;
        }

        return {
          title,
          whyItMatters,
          howToUseInNegotiation,
          suggestedAsk: this.readString(row, 'suggestedAsk') ?? 'Discuss suitable contract or pricing options with your conveyancer and the agent.',
          estimatedImpact: this.normalizeNegotiationImpact(this.readString(row, 'estimatedImpact')),
          confidence: this.normalizeNegotiationConfidence(this.readString(row, 'confidence')),
          evidence: this.resolveEvidenceRefs(row['evidence']),
          risksOrTradeoffs: this.readString(row, 'risksOrTradeoffs') ?? '',
          category: this.normalizeNegotiationCategory(this.readString(row, 'category'))
        } as ReportNegotiationLever;
      })
      .filter((item): item is ReportNegotiationLever => item !== null)
      .sort((a, b) => {
        const impactDelta = this.negotiationImpactRank(a.estimatedImpact) - this.negotiationImpactRank(b.estimatedImpact);
        if (impactDelta !== 0) {
          return impactDelta;
        }
        const confidenceDelta = this.negotiationConfidenceRank(a.confidence) - this.negotiationConfidenceRank(b.confidence);
        if (confidenceDelta !== 0) {
          return confidenceDelta;
        }
        return a.title.localeCompare(b.title);
      });
  }

  private resolveNegotiationActionItems(summary: Record<string, unknown>, key: string): ReportActionItem[] {
    const rows = Array.isArray(summary[key]) ? summary[key] : [];
    return rows
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        const title = this.readString(row, 'title') ?? '';
        const detail = this.readString(row, 'detail') ?? '';
        if (!title || !detail) {
          return null;
        }

        return {
          title,
          detail,
          priority: this.normalizeNegotiationPriority(this.readString(row, 'priority')),
          owner: this.normalizeNegotiationOwner(this.readString(row, 'owner')),
          evidence: this.resolveEvidenceRefs(row['evidence'])
        } as ReportActionItem;
      })
      .filter((item): item is ReportActionItem => item !== null)
      .sort((a, b) => {
        const priorityDelta = this.negotiationPriorityRank(a.priority) - this.negotiationPriorityRank(b.priority);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return a.title.localeCompare(b.title);
      });
  }

  private resolveEvidenceRefs(value: unknown): ReportEvidenceRef[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const row = item as Record<string, unknown>;
        const source = this.readString(row, 'source') ?? 'Uploaded documents';
        const locator = this.readString(row, 'locator') ?? 'Not specified';
        const quote = this.readString(row, 'quote') ?? '';
        const fileId = this.readString(row, 'fileId') ?? '';
        return { source, locator, quote, fileId } as ReportEvidenceRef;
      })
      .filter((item): item is ReportEvidenceRef => item !== null);
  }

  private normalizeNegotiationImpact(value: string | null): 'low' | 'medium' | 'high' | 'unknown' {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
      return normalized;
    }
    return 'unknown';
  }

  private normalizeNegotiationConfidence(value: string | null): 'low' | 'medium' | 'high' {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
      return normalized;
    }
    return 'low';
  }

  private normalizeNegotiationCategory(value: string | null): ReportNegotiationLever['category'] {
    const normalized = (value || '').trim();
    if (
      normalized === 'buildingDefects' ||
      normalized === 'complianceOrApprovalRisk' ||
      normalized === 'contractTerms' ||
      normalized === 'financeOrTiming' ||
      normalized === 'titleOrEncumbrances' ||
      normalized === 'strataOrBodyCorporate' ||
      normalized === 'maintenanceOrCapitalWorks' ||
      normalized === 'unknownOrOther'
    ) {
      return normalized;
    }

    return 'unknownOrOther';
  }

  private normalizeNegotiationPriority(value: string | null): 'now' | 'soon' | 'later' {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'now' || normalized === 'soon' || normalized === 'later') {
      return normalized;
    }
    return 'soon';
  }

  private normalizeNegotiationOwner(value: string | null): 'buyer' | 'conveyancer' | 'buildingInspector' | 'agent' {
    const normalized = (value || '').trim();
    if (normalized === 'buyer' || normalized === 'conveyancer' || normalized === 'buildingInspector' || normalized === 'agent') {
      return normalized;
    }
    return 'buyer';
  }

  private negotiationImpactRank(value: 'low' | 'medium' | 'high' | 'unknown'): number {
    if (value === 'high') {
      return 0;
    }
    if (value === 'medium') {
      return 1;
    }
    if (value === 'low') {
      return 2;
    }
    return 3;
  }

  private negotiationConfidenceRank(value: 'low' | 'medium' | 'high'): number {
    if (value === 'high') {
      return 0;
    }
    if (value === 'medium') {
      return 1;
    }
    return 2;
  }

  private negotiationPriorityRank(value: 'now' | 'soon' | 'later'): number {
    if (value === 'now') {
      return 0;
    }
    if (value === 'soon') {
      return 1;
    }
    return 2;
  }

  private buildNegotiationFallbackSection(): ReportNegotiationIntelligenceSection {
    return {
      summary: this.negotiationFallbackSummary,
      levers: [],
      recommendedNextSteps: [
        {
          title: 'Ask your conveyancer for a negotiation review',
          detail: 'Ask your conveyancer to review the contract and inspection reports for any practical negotiation levers before you decide to exchange.',
          priority: 'now',
          owner: 'conveyancer',
          evidence: []
        },
        {
          title: 'Confirm if more evidence is needed',
          detail: 'Check whether additional building or pest detail is needed to support any repair, price, or clause request.',
          priority: 'soon',
          owner: 'buyer',
          evidence: []
        }
      ],
      evidenceIndex: []
    };
  }

  private resolveSourceAttribution(summary: Record<string, unknown> | null): ReportSourceAttribution[] {
    const rows = summary && Array.isArray(summary['sourceAttribution']) ? summary['sourceAttribution'] : [];
    return rows
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as Record<string, unknown>;
        return {
          name: this.readString(row, 'name') ?? 'Source',
          url: this.readString(row, 'url') ?? '',
          note: this.readString(row, 'note') ?? '',
          sourceType: this.readString(row, 'sourceType') ?? 'authority',
          retrievedOnUtc: this.readString(row, 'retrievedOnUtc')
        };
      })
      .filter((item): item is ReportSourceAttribution => item !== null);
  }

  private resolvePropertySnapshot(summary: Record<string, unknown> | null): ReportPropertySnapshot | null {
    if (!summary || !summary['propertySnapshot'] || typeof summary['propertySnapshot'] !== 'object') {
      return null;
    }
    const value = summary['propertySnapshot'] as Record<string, unknown>;
    const address = this.readString(value, 'address') ?? '';
    const suburb = this.readString(value, 'suburb') ?? '';
    const territory = this.readString(value, 'territory') ?? '';
    const buyerType = this.readString(value, 'buyerType') ?? '';
    const propertyType = this.readString(value, 'propertyType') ?? '';
    if (!address && !suburb && !territory && !buyerType && !propertyType) {
      return null;
    }

    return {
      address,
      suburb,
      territory,
      buyerType,
      propertyType
    };
  }

  private resolveJurisdictionProfile(summary: Record<string, unknown> | null): ReportJurisdictionProfile | null {
    if (!summary || !summary['jurisdictionProfile'] || typeof summary['jurisdictionProfile'] !== 'object') {
      return null;
    }

    const value = summary['jurisdictionProfile'] as Record<string, unknown>;
    const stateNotices = Array.isArray(value['stateNotices'])
      ? (value['stateNotices'] as unknown[]).map((item) => this.toDisplayText(item, '')).filter(Boolean)
      : [];

    return {
      stateOrTerritory: this.readString(value, 'stateOrTerritory') ?? this.readString(value, 'state') ?? 'ACT',
      displayName: this.readString(value, 'displayName') ?? this.readString(value, 'stateOrTerritory') ?? 'State guidance',
      stateNotices
    };
  }

  private resolveContractFacts(summary: Record<string, unknown> | null): ReportContractFact[] {
    if (!summary || !summary['contractFacts'] || typeof summary['contractFacts'] !== 'object') {
      return [];
    }

    const value = summary['contractFacts'] as Record<string, unknown>;
    const rows: Array<{ id: string; label: string; key: string }> = [
      { id: 'purchase-price', label: 'Purchase price', key: 'purchasePrice' },
      { id: 'deposit-amount', label: 'Deposit amount', key: 'depositAmount' },
      { id: 'deposit-due', label: 'Deposit due', key: 'depositDue' },
      { id: 'cooling-off', label: 'Cooling-off', key: 'coolingOff' },
      { id: 'settlement-date', label: 'Settlement date', key: 'settlementDate' },
      { id: 'finance-deadline', label: 'Finance deadline', key: 'financeClauseDeadline' },
      { id: 'inclusions', label: 'Inclusions', key: 'inclusions' },
      { id: 'exclusions', label: 'Exclusions', key: 'exclusions' },
      { id: 'penalty-interest', label: 'Penalty interest', key: 'penaltyInterest' },
      { id: 'vendor', label: 'Vendor', key: 'vendor' },
      { id: 'purchaser', label: 'Purchaser', key: 'purchaser' },
      { id: 'title-reference', label: 'Title reference', key: 'titleReference' },
      { id: 'tenancy-conditions', label: 'Tenancy conditions', key: 'tenancyConditions' },
      { id: 'adjustment-schedule', label: 'Adjustment schedule', key: 'adjustmentSchedule' }
    ];

    const facts = rows
      .map((row) => ({
        id: row.id,
        label: row.label,
        value: this.readString(value, row.key) ?? ''
      }))
      .filter((row) => row.value);

    const specialConditions = Array.isArray(value['specialConditions'])
      ? (value['specialConditions'] as unknown[]).map((item) => this.toDisplayText(item, '')).filter(Boolean)
      : [];

    if (specialConditions.length > 0) {
      facts.push({
        id: 'special-conditions',
        label: 'Special conditions',
        value: specialConditions.join('; ')
      });
    }

    return facts;
  }

  private resolveCitations(summary: Record<string, unknown> | null): ReportCitation[] {
    const rows = summary && Array.isArray(summary['citations']) ? summary['citations'] : [];
    return rows
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const row = item as Record<string, unknown>;
        const chunkRaw = row['chunkId'];
        const chunkId =
          typeof chunkRaw === 'number' || typeof chunkRaw === 'string'
            ? `chunk:${String(chunkRaw).trim()}`
            : this.readString(row, 'chunkId') ?? '';
        const pageRaw = row['pageNumber'];
        const parsedPage = typeof pageRaw === 'number' ? pageRaw : Number.parseInt(String(pageRaw ?? ''), 10);
        const quoteSnippet = this.readString(row, 'quoteSnippet') ?? '';
        if (!chunkId && !quoteSnippet) {
          return null;
        }

        return {
          chunkId: chunkId || 'chunk:unknown',
          pageNumber: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : null,
          quoteSnippet
        } as ReportCitation;
      })
      .filter((item): item is ReportCitation => item !== null);
  }

  private mapRiskToIssue(risk: unknown, index: number): ReportIssue | null {
    if (!risk || typeof risk !== 'object') {
      return null;
    }

    const riskObj = risk as Record<string, unknown>;
    const title = this.readString(riskObj, 'title') ?? this.readString(riskObj, 'risk') ?? `Risk ${index + 1}`;
    const detail = this.readString(riskObj, 'detail') ?? this.readString(riskObj, 'description') ?? 'Risk detail not provided.';
    const severityRaw = (this.readString(riskObj, 'severity') ?? 'medium').toLowerCase();
    const severity = severityRaw === 'high' || severityRaw === 'medium' || severityRaw === 'low' ? severityRaw : 'medium';

    return {
      id: `risk-${index + 1}`,
      title,
      detail,
      severity,
      evidenceRefs: this.readCitationRefs(riskObj),
      pages: this.readPages(riskObj)
    };
  }

  private mapChecklistItem(item: unknown, index: number): ReportChecklistItem | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const value = item as Record<string, unknown>;
    const requirement = this.readString(value, 'requirement') ?? this.readString(value, 'name') ?? `Checklist item ${index + 1}`;
    const evidence = this.readString(value, 'evidence') ?? this.readString(value, 'detail') ?? 'Evidence not supplied.';
    const description =
      this.readString(value, 'description') ??
      'This status is AI-generated from uploaded documents and should be confirmed by your conveyancer.';
    const statusRaw = (this.readString(value, 'status') ?? 'review').toLowerCase();
    const status = statusRaw === 'complete' || statusRaw === 'missing' || statusRaw === 'review' ? statusRaw : 'review';

    return {
      id: `check-${index + 1}`,
      requirement,
      status,
      evidence,
      description,
      evidenceRefs: this.readCitationRefs(value),
      pages: this.readPages(value)
    };
  }

  private readCitationRefs(source: Record<string, unknown>): string[] {
    const value = source['citationChunkIds'];
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => (typeof item === 'number' || typeof item === 'string' ? `chunk:${item}` : ''))
      .filter((item) => Boolean(item));
  }

  private readPages(source: Record<string, unknown>): number[] {
    const value = source['pages'];
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => (typeof item === 'number' ? item : Number.parseInt(String(item), 10)))
      .filter((item) => Number.isFinite(item) && item > 0);
  }

  private tryGetSummaryObject(summary: unknown): Record<string, unknown> | null {
    if (!summary || typeof summary !== 'object') {
      return null;
    }
    return summary as Record<string, unknown>;
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

  private readString(source: Record<string, unknown> | null, key: string): string | null {
    const value = this.readValue(source, key);
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private readNullableBoolean(source: Record<string, unknown> | null, key: string): boolean | null {
    const value = this.readValue(source, key);
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return null;
  }

  private readNullableNumber(source: Record<string, unknown> | null, key: string): number | null {
    const value = this.readValue(source, key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private toDisplayText(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return fallback;
  }

  private resolveStringArray(summary: Record<string, unknown> | null, key: string): string[] {
    if (!summary || !Array.isArray(summary[key])) {
      return [];
    }

    return (summary[key] as unknown[]).map((item) => this.toDisplayText(item, '')).filter(Boolean);
  }

  private readClauseTitle(item: unknown, fallback: string): string {
    if (!item || typeof item !== 'object') {
      return this.toDisplayText(item, fallback);
    }

    const row = item as Record<string, unknown>;
    return (
      this.readString(row, 'requirement') ??
      this.readString(row, 'title') ??
      this.readString(row, 'item') ??
      this.readString(row, 'name') ??
      fallback
    );
  }

  private readClauseDescription(item: unknown): string | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const row = item as Record<string, unknown>;
    return this.readString(row, 'description') ?? this.readString(row, 'detail');
  }

  private resolveApiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error === 'string' && error.error.trim()) {
        return error.error.trim();
      }

      if (error.error && typeof error.error === 'object') {
        const message = (error.error as { message?: string }).message;
        if (typeof message === 'string' && message.trim()) {
          return message.trim();
        }
      }

      if (error.message?.trim()) {
        return error.message.trim();
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return fallback;
  }
}
