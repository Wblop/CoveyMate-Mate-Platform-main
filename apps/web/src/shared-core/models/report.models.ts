export type ReportStatus = 'draft' | 'processing' | 'ready' | 'failed';
export type ReviewPipelineStatus =
  | 'AwaitingUpload'
  | 'AwaitingPayment'
  | 'Paid'
  | 'Queued'
  | 'Extracting'
  | 'Indexing'
  | 'Analyzing'
  | 'Validating'
  | 'Rendering'
  | 'Completed'
  | 'Failed';

export type BuyerType = 'owner-occupier' | 'investor';
export type IssueSeverity = 'high' | 'medium' | 'low';
export type ChecklistStatus = 'complete' | 'missing' | 'review';
export type BuyerConcessionIntent = 'yes' | 'no' | 'unsure';

export interface ReportBuyerContext {
  isFirstHomeBuyer: boolean | null;
  concessionIntent: BuyerConcessionIntent;
  contractExchanged: boolean | null;
  agreedPriceAud: number | null;
  estimatedPriceAud: number | null;
}

export interface ReportIssue {
  id: string;
  title: string;
  detail: string;
  severity: IssueSeverity;
  evidenceRefs?: string[];
  pages?: number[];
}

export interface ReportChecklistItem {
  id: string;
  requirement: string;
  status: ChecklistStatus;
  evidence: string;
  description: string;
  evidenceRefs?: string[];
  pages?: number[];
}

export interface ReportClauseItem {
  id: string;
  title: string;
  detail: string;
  clauseText?: string | null;
  whatThisMeans?: string | null;
  whyItMatters?: string | null;
  askConveyancer?: string | null;
  evidenceRefs: string[];
  pages: number[];
}

export interface ReportNarrativeSection {
  id: string;
  heading: string;
  intro: string;
  analysis: string;
  buyerImpact: string;
  recommendedActions: string[];
}

export interface ReportStateSpecificSection {
  id: string;
  heading: string;
  content: string;
  evidenceRefs: string[];
  pages: number[];
}

export interface ReportFinancialModel {
  stampDutyEstimate: string;
  cashToSettleBand: string;
  assumptions: string[];
}

export type NegotiationEstimatedImpact = 'low' | 'medium' | 'high' | 'unknown';
export type NegotiationConfidence = 'low' | 'medium' | 'high';
export type NegotiationLeverCategory =
  | 'buildingDefects'
  | 'complianceOrApprovalRisk'
  | 'contractTerms'
  | 'financeOrTiming'
  | 'titleOrEncumbrances'
  | 'strataOrBodyCorporate'
  | 'maintenanceOrCapitalWorks'
  | 'unknownOrOther';
export type NegotiationActionPriority = 'now' | 'soon' | 'later';
export type NegotiationActionOwner = 'buyer' | 'conveyancer' | 'buildingInspector' | 'agent';

export interface ReportEvidenceRef {
  source: string;
  locator: string;
  quote: string;
  fileId: string;
}

export interface ReportNegotiationLever {
  title: string;
  whyItMatters: string;
  howToUseInNegotiation: string;
  suggestedAsk: string;
  estimatedImpact: NegotiationEstimatedImpact;
  confidence: NegotiationConfidence;
  evidence: ReportEvidenceRef[];
  risksOrTradeoffs: string;
  category: NegotiationLeverCategory;
}

export interface ReportActionItem {
  title: string;
  detail: string;
  priority: NegotiationActionPriority;
  owner: NegotiationActionOwner;
  evidence: ReportEvidenceRef[];
}

export interface ReportNegotiationIntelligenceSection {
  summary: string;
  levers: ReportNegotiationLever[];
  recommendedNextSteps: ReportActionItem[];
  evidenceIndex: ReportEvidenceRef[];
}

export interface ReportPropertySnapshot {
  address: string;
  suburb: string;
  territory: string;
  buyerType: string;
  propertyType: string;
}

export interface ReportJurisdictionProfile {
  stateOrTerritory: string;
  displayName: string;
  stateNotices: string[];
}

export interface ReportContractFact {
  id: string;
  label: string;
  value: string;
}

export interface ReportSourceAttribution {
  name: string;
  url: string;
  note: string;
  sourceType: string;
  retrievedOnUtc: string | null;
}

export interface ReportCitation {
  chunkId: string;
  pageNumber: number | null;
  quoteSnippet: string;
}

export interface ReportSummary {
  id: string;
  title: string;
  propertyAddress: string;
  stateOrTerritory: string;
  createdAt: string;
  updatedAt: string;
  status: ReportStatus;
  paymentStatus: string;
  pipelineStatus: string;
  percentComplete: number;
  currentStep: string;
  currentSubStep: string;
  lastUpdatedUtc: string;
  archivedAtUtc: string | null;
}

export interface ReportDetail extends ReportSummary {
  buyerType: string;
  buyerContext?: ReportBuyerContext | null;
  localGovernmentArea: string | null;
  propertyTenureType: string;
  packType: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  reportS3Key: string | null;
  disclaimerVersion: string | null;
  disclaimerAcceptedAtUtc: string | null;
  rawSummary: unknown;
  executiveSummary: string;
  propertySnapshot: ReportPropertySnapshot | null;
  jurisdictionProfile: ReportJurisdictionProfile | null;
  issues: ReportIssue[];
  checklist: ReportChecklistItem[];
  titleAndEncumbrances: ReportClauseItem[];
  unusualClauses: ReportClauseItem[];
  missingInformation: ReportClauseItem[];
  planningHazards: ReportIssue[];
  financialItems: ReportClauseItem[];
  settlementAdjustments: ReportClauseItem[];
  investmentSnapshot: ReportClauseItem[];
  strataInsights: ReportClauseItem[];
  costsAndAdjustments: ReportClauseItem[];
  redFlags: ReportIssue[];
  narrativeSections: ReportNarrativeSection[];
  stateSpecificSections: ReportStateSpecificSection[];
  recommendedActions: string[];
  lawyerQuestions: string[];
  plainEnglishGuide: string[];
  legalDisclaimers: string[];
  contractFacts: ReportContractFact[];
  financialModel: ReportFinancialModel | null;
  negotiationIntelligence: ReportNegotiationIntelligenceSection;
  sourceAttribution: ReportSourceAttribution[];
  citations: ReportCitation[];
  validationWarnings: string[];
}

export interface NewReportDraftInput {
  propertyAddress: string;
  buyerType: BuyerType;
  stateOrTerritory: string;
  buyerContext: ReportBuyerContext;
  acceptedDisclaimer: boolean;
}

export type PipelineStageState = 'queued' | 'running' | 'complete' | 'warning' | 'failed' | 'retrying';
export type PipelineEventSeverity = 'info' | 'warning' | 'error';

export interface PipelineStepModel {
  id: string;
  label: string;
  description: string;
  phase: 'setup' | 'analysis' | 'delivery';
  order: number;
  progressStartPercent: number;
  progressEndPercent: number;
}

export interface PipelineModel {
  steps: PipelineStepModel[];
  typicalDurationMinutes: number;
  disclaimerVersion: string;
}

export interface PipelineProgressEvent {
  id: number;
  timestampUtc: string;
  stageId: string;
  stageState: PipelineStageState;
  severity: PipelineEventSeverity;
  message: string;
  percentComplete: number | null;
  detailCode: string | null;
  attempt: number | null;
  maxAttempts: number | null;
}

export interface ReportArchiveStatusResult {
  jobId: string;
  archivedAtUtc: string | null;
}

export interface DeleteReportResult {
  jobId: string;
  deleted: boolean;
  deletedStorageObjectCount: number;
}

export interface ProcessingStage {
  id: string;
  label: string;
  description: string;
  phase: 'setup' | 'analysis' | 'delivery';
  progressStartPercent: number;
  progressEndPercent: number;
  state: PipelineStageState;
}
