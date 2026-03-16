export type QuoteRequestServiceNeed = 'pre-exchange-review' | 'full-conveyancing' | 'settlement-only';

export interface QuoteRequestSelectedConveyancer {
  jurisdiction: string;
  regulatorType: string;
  sourceIdentifier: string;
}

export interface QuoteRequestBrief {
  summary: string;
  topConcerns: string[];
  conveyancerQuestions: string[];
}

export interface QuoteRequestResponse {
  responderName: string;
  responderEmail: string;
  responderPhone: string | null;
  professionalFeeAud: number;
  includesGst: boolean;
  disbursementsEstimateAud: number | null;
  turnaroundBusinessDays: number | null;
  scopeNotes: string;
  excludedItems: string[];
  validUntilUtc: string | null;
  submittedAtUtc: string;
}

export interface QuoteRequestSharedDocument {
  id: string;
  fileName: string;
  contentType: string;
  docType: string;
  uploadedAtUtc: string;
}

export interface QuoteRequestTargetDocumentAccess {
  requiresOtp: boolean;
  otpRequestedAtUtc: string | null;
  verifiedAtUtc: string | null;
  reportDownloaded: boolean;
  downloadedDocumentCount: number;
  totalDocumentCount: number;
  lastDownloadedAtUtc: string | null;
}

export interface QuoteRequestPublicDocumentAccess extends QuoteRequestTargetDocumentAccess {
  isUnlocked: boolean;
  otpExpiresAtUtc: string | null;
  sessionExpiresAtUtc: string | null;
}

export interface QuoteRequestTarget {
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
  response: QuoteRequestResponse | null;
  documentAccess: QuoteRequestTargetDocumentAccess;
}

export interface QuoteRequestSummary {
  id: string;
  reviewJobId: string;
  propertyAddress: string;
  stateOrTerritory: string;
  serviceNeed: QuoteRequestServiceNeed;
  status: string;
  createdAtUtc: string;
  sentAtUtc: string | null;
  expiresAtUtc: string;
  targetCount: number;
  responseCount: number;
  archivedAtUtc: string | null;
}

export interface QuoteRequestDetail {
  id: string;
  reviewJobId: string;
  propertyAddress: string;
  stateOrTerritory: string;
  serviceNeed: QuoteRequestServiceNeed;
  message: string | null;
  shareReportPdf: boolean;
  status: string;
  createdAtUtc: string;
  sentAtUtc: string | null;
  expiresAtUtc: string;
  archivedAtUtc: string | null;
  brief: QuoteRequestBrief;
  targets: QuoteRequestTarget[];
}

export interface CreateQuoteRequestFromReportInput {
  serviceNeed: QuoteRequestServiceNeed;
  message: string | null;
  shareReportPdf: boolean;
  conveyancerQuestions: string[];
  selectedConveyancers: QuoteRequestSelectedConveyancer[];
}

export interface PublicQuoteRequestView {
  conveyancerDisplayName: string;
  propertyAddress: string;
  stateOrTerritory: string;
  serviceNeed: QuoteRequestServiceNeed;
  summary: string;
  topConcerns: string[];
  conveyancerQuestions: string[];
  shareReportPdf: boolean;
  sharedDocuments: QuoteRequestSharedDocument[];
  documentAccess: QuoteRequestPublicDocumentAccess;
  canRespond: boolean;
  expiresAtUtc: string;
  existingResponse: QuoteRequestResponse | null;
}

export interface RequestPublicQuoteRequestDocumentAccessOtpResult {
  requestedAtUtc: string;
  expiresAtUtc: string;
}

export interface VerifyPublicQuoteRequestDocumentAccessOtpResult {
  documentAccessToken: string;
  expiresAtUtc: string;
}

export interface UnsubscribePublicQuoteRequestConveyancerResult {
  conveyancerDisplayName: string;
  quoteRequestsEnabled: boolean;
  quoteRequestsDisabledAtUtc: string | null;
}

export interface SubmitPublicQuoteRequestInput {
  responderName: string;
  responderEmail: string;
  responderPhone: string | null;
  professionalFeeAud: number;
  includesGst: boolean;
  disbursementsEstimateAud: number | null;
  turnaroundBusinessDays: number | null;
  scopeNotes: string;
  excludedItems: string[];
  validUntilUtc: string | null;
}

export interface QuoteRequestArchiveStatusResult {
  quoteRequestId: string;
  archivedAtUtc: string | null;
}

export interface DeleteQuoteRequestResult {
  quoteRequestId: string;
  deleted: boolean;
}
