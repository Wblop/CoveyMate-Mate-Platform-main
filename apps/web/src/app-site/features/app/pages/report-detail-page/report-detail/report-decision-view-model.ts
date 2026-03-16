import {
  ChecklistStatus,
  IssueSeverity,
  ReportCitation,
  ReportClauseItem,
  ReportContractFact,
  ReportDetail,
  ReportIssue
} from '@shared-core/models/report.models';

export type DecisionRecommendation = 'proceed' | 'proceed-with-conditions' | 'pause-and-review';
export type UrgencyLabel = 'Act now' | 'Review soon' | 'Monitor';
export type VerdictTone = 'high' | 'medium' | 'low' | 'neutral';

type RiskDomain = 'building' | 'financial' | 'general';

export interface PriorityRiskCard {
  id: string;
  title: string;
  detail: string;
  severity: IssueSeverity;
  urgencyLabel: UrgencyLabel;
  pages: number[];
  signature: string;
  domain: RiskDomain;
  buyerImpactSummary: string;
  recommendedAction: string;
  milestone: string;
  evidencePreviewSnippet: string;
  evidencePreviewPage: number | null;
  detailsExpandedContent: string;
}

export interface NegotiationPlaybookItem {
  id: string;
  title: string;
  suggestedAsk: string;
  expectedImpact: string;
  confidence: string;
  tradeoff: string;
  owner: string;
  timing: string;
  whyItMatters: string;
  useInConversation: string;
  proofPoint: string;
  leverageLabel: string;
}

export interface NegotiationActionStep {
  id: string;
  title: string;
  detail: string;
  owner: string;
  timing: string;
}

export interface BeforeExchangeTask {
  id: string;
  title: string;
  detail: string;
  urgencyLabel: UrgencyLabel;
  status: ChecklistStatus | 'derived';
  owner: string;
  milestone: string;
  evidence: string;
  pages: number[];
}

export interface AdvisoryItem {
  id: string;
  title: string;
  detail: string;
  pages: number[];
  recommendedAction: string;
}

export interface BuyerPriorityItem {
  id: string;
  title: string;
  summary: string;
  impactLabel: string;
  whatToGetInWriting: string;
  owner: string;
  milestone: string;
  urgencyLabel: UrgencyLabel;
  sourceLabel: string;
  supportNote: string;
  pages: number[];
}

export interface PropertyConditionItem extends AdvisoryItem {
  urgencyLabel: UrgencyLabel;
  category: 'condition' | 'inspection' | 'strata';
  sourceLabel: string;
  impactLabel: string;
  buyerQuestion: string;
}

export interface PropertyConditionSummary {
  label: string;
  tone: VerdictTone;
  headline: string;
  detail: string;
}

export interface ContractConditionItem {
  id: string;
  title: string;
  clauseText: string;
  whatThisMeans: string;
  whyItMatters: string;
  askConveyancer: string;
  category: 'timing' | 'finance' | 'possession' | 'property-risk' | 'general';
  impactLabel: string;
  whatToConfirm: string;
  detail: string;
  pages: number[];
}

export interface StructuredGuidanceSection {
  whatThisMeans: string;
  whyItMatters: string;
  askYourConveyancer: string;
}

export interface ReportDecisionViewModel {
  canonicalPropertyAddress: string;
  stateOrTerritory: string;
  buyerType: string;
  summaryText: string;
  decisionRecommendation: DecisionRecommendation;
  decisionRecommendationLabel: string;
  decisionRationale: string;
  verdictTone: VerdictTone;
  severityCounts: Record<IssueSeverity, number>;
  topActions: string[];
  manualChecks: string[];
  priorityRiskCards: PriorityRiskCard[];
  visiblePriorityRiskCards: PriorityRiskCard[];
  overflowPriorityRiskCards: PriorityRiskCard[];
  negotiationSummary: string;
  negotiationPlaybookVisible: NegotiationPlaybookItem[];
  negotiationPlaybookOverflow: NegotiationPlaybookItem[];
  negotiationActionStepsVisible: NegotiationActionStep[];
  negotiationActionStepsOverflow: NegotiationActionStep[];
  beforeExchangeChecklist: {
    actNow: BeforeExchangeTask[];
    reviewSoon: BeforeExchangeTask[];
    monitor: BeforeExchangeTask[];
  };
  buyerPriorityVisible: BuyerPriorityItem[];
  buyerPriorityOverflow: BuyerPriorityItem[];
  riskMonitorItems: BuyerPriorityItem[];
  risksNarrative: ReportDetail['narrativeSections'][number] | null;
  actionPlanNarrative: ReportDetail['narrativeSections'][number] | null;
  costsNarrative: ReportDetail['narrativeSections'][number] | null;
  planningNarrative: ReportDetail['narrativeSections'][number] | null;
  questionsNarrative: ReportDetail['narrativeSections'][number] | null;
  costsStateSection: ReportDetail['stateSpecificSections'][number] | null;
  questionsStateSection: ReportDetail['stateSpecificSections'][number] | null;
  costsStateGuidance: StructuredGuidanceSection | null;
  questionsStateGuidance: StructuredGuidanceSection | null;
  financialModel: ReportDetail['financialModel'];
  financialComplianceItems: {
      moneyTiming: AdvisoryItem[];
      complianceApproval: AdvisoryItem[];
      settlementAdjustments: AdvisoryItem[];
  };
  nextStepsVisible: string[];
  nextStepsOverflow: string[];
  buildingPhysicalItems: PropertyConditionItem[];
  propertyConditionSummary: PropertyConditionSummary;
  propertyConditionSections: {
    costExposure: PropertyConditionItem[];
    unknowns: PropertyConditionItem[];
    watch: PropertyConditionItem[];
  };
  propertyConditionGroups: {
    immediate: PropertyConditionItem[];
    dueDiligence: PropertyConditionItem[];
    watch: PropertyConditionItem[];
  };
  contractConditionItems: ContractConditionItem[];
  contractConditionSections: {
    decisionCritical: ContractConditionItem[];
    propertyRights: ContractConditionItem[];
    other: ContractConditionItem[];
  };
  contractConditionSummary: {
    label: string;
    tone: VerdictTone;
    headline: string;
    detail: string;
  };
  conveyancerQuestions: string[];
  overflowConveyancerQuestions: string[];
  sectionVisibility: {
    showFinancialCompliance: boolean;
    showBuildingPhysical: boolean;
    showContractConditions: boolean;
  };
}

const buildingKeywordPattern = /moisture|water|leak|roof|pest|termite|structur|building|defect|mould|mold|crack|asbestos|foundation|plumbing|electrical/i;
const financialKeywordPattern =
  /\b(deposit|finance|loan|cash|settlement|tax|duty|fees?|costs?|payment|deadlines?|completion|adjustments?|interest|default)\b|\bland tax\b|\bstamp duty\b/i;
const complianceKeywordPattern = /approval|compliance|certificate|disclosure|encumbrance|title|easement|zoning|permit|planning|lodg/i;
const costsComplianceKeywordPattern =
  /\brates?\b|\bwater\b|\bsewer(?:age)?\b|\bstrata\b|\blev(?:y|ies)\b|\bduty\b|\btax\b|\bsettlement\b|\bcompletion\b|\bfinance\b|\bdeposit\b|\bstamp duty\b|\badjustments?\b|\bconcession\b|\bcertificates?\b|\bcompliance\b|\bapprovals?\b|\bland tax\b/i;
const propertyConditionKeywordPattern =
  /\b(building|inspection|pest|termite|asbestos|moisture|leak|roof|crack|mould|mold|waterproof|retaining|drainage|plumbing|electrical|strata|repair|defect|image-only|unreadable|scan|boundary|plan)\b/i;
const contractTenancyPattern = /\b(tenant|tenancy|vacant possession|lease|bond)\b/i;
const contractDefectPattern =
  /\b(defect|service|boundary|infestation|as is|as-is|no claims?|no reliance|present state of repair)\b/i;
const contractFinancePattern = /\b(finance|approval|warranty|foreign|indemnity|funding|firb)\b/i;
const contractTimingPattern = /\b(completion|default|notice to complete|settlement|penalty interest)\b/i;

export function buildReportDecisionViewModel(detail: ReportDetail): ReportDecisionViewModel {
  const priorityRiskCards = buildPriorityRiskCards(detail);
  const severityCounts = countSeverity(priorityRiskCards);
  const reviewWarnings = detail.checklist
    .filter((item) => item.status === 'review')
    .map((item) => `${item.requirement}: ${item.description}`);
  const manualChecks = dedupeStrings([...detail.validationWarnings, ...reviewWarnings]);
  const recommendation = resolveRecommendation(detail.status, severityCounts, manualChecks.length > 0);
  const topActions = resolveTopActions(detail, priorityRiskCards);
  const negotiationPlaybook = buildNegotiationPlaybook(detail);
  const negotiationActionSteps = buildNegotiationActionSteps(detail);
  const beforeExchangeChecklist = buildBeforeExchangeChecklist(detail, priorityRiskCards);
  const buyerPriorityItems = buildBuyerPriorityItems(detail, priorityRiskCards);
  const riskMonitorItems = buildRiskMonitorItems(priorityRiskCards, beforeExchangeChecklist);
  const financialComplianceItems = buildFinancialComplianceItems(detail);
  const buildingPhysicalItems = buildBuildingPhysicalItems(detail, priorityRiskCards);
  const propertyConditionSections = buildPropertyConditionSections(buildingPhysicalItems);
  const propertyConditionGroups = buildPropertyConditionGroups(buildingPhysicalItems);
  const propertyConditionSummary = buildPropertyConditionSummary(propertyConditionSections);
  const contractConditionItems = buildContractConditionItems(detail);
  const contractConditionSections = buildContractConditionSections(contractConditionItems);
  const contractConditionSummary = buildContractConditionSummary(contractConditionSections);
  const risksNarrative = findNarrativeSection(detail, 'contract-risks');
  const actionPlanNarrative = findNarrativeSection(detail, 'action-plan');
  const costsNarrative = findNarrativeSection(detail, 'costs-cashflow');
  const planningNarrative = findNarrativeSection(detail, 'planning-hazards');
  const questionsNarrative = findNarrativeSection(detail, 'lawyer-questions');
  const costsStateSection = findStateSpecificSection(detail, 'state-deadlines-and-money');
  const questionsStateSection = findStateSpecificSection(detail, 'state-conveyancer-checks');
  const costsStateGuidance = parseStructuredGuidanceSection(costsStateSection);
  const questionsStateGuidance = parseStructuredGuidanceSection(questionsStateSection);
  const nextSteps = buildNextSteps(actionPlanNarrative, topActions, beforeExchangeChecklist);

  return {
    canonicalPropertyAddress: detail.propertyAddress,
    stateOrTerritory: detail.stateOrTerritory,
    buyerType: detail.buyerType,
    summaryText:
      detail.executiveSummary.trim() ||
      'Review complete. Focus on the top risks and confirm the critical items with your conveyancer before exchange.',
    decisionRecommendation: recommendation.recommendation,
    decisionRecommendationLabel: recommendation.label,
    decisionRationale: recommendation.rationale,
    verdictTone: recommendation.tone,
    severityCounts,
    topActions,
    manualChecks,
    priorityRiskCards,
    visiblePriorityRiskCards: priorityRiskCards.slice(1, 5),
    overflowPriorityRiskCards: priorityRiskCards.slice(4),
    negotiationSummary:
      detail.negotiationIntelligence.summary.trim() ||
      'No strong negotiation levers were detected. Confirm if any contract risk can support a targeted ask.',
    negotiationPlaybookVisible: negotiationPlaybook.slice(0, 3),
    negotiationPlaybookOverflow: negotiationPlaybook.slice(4),
    negotiationActionStepsVisible: negotiationActionSteps.slice(0, 4),
    negotiationActionStepsOverflow: negotiationActionSteps.slice(4),
    beforeExchangeChecklist,
    buyerPriorityVisible: buyerPriorityItems.slice(0, 4),
    buyerPriorityOverflow: buyerPriorityItems.slice(4),
    riskMonitorItems: riskMonitorItems.slice(0, 5),
    risksNarrative,
    actionPlanNarrative,
    costsNarrative,
    planningNarrative,
    questionsNarrative,
    costsStateSection,
    questionsStateSection,
    costsStateGuidance,
    questionsStateGuidance,
    financialModel: detail.financialModel,
    financialComplianceItems,
    nextStepsVisible: nextSteps.slice(0, 3),
    nextStepsOverflow: nextSteps.slice(4),
    buildingPhysicalItems,
    propertyConditionSummary,
    propertyConditionSections,
    propertyConditionGroups,
    contractConditionItems,
    contractConditionSections,
    contractConditionSummary,
    conveyancerQuestions: detail.lawyerQuestions.slice(0, 5),
    overflowConveyancerQuestions: detail.lawyerQuestions.slice(5),
    sectionVisibility: {
      showFinancialCompliance: Boolean(
        detail.financialModel ||
          financialComplianceItems.moneyTiming.length > 0 ||
          financialComplianceItems.complianceApproval.length > 0 ||
          financialComplianceItems.settlementAdjustments.length > 0
      ),
      showBuildingPhysical: buildingPhysicalItems.length > 0,
      showContractConditions: contractConditionItems.length > 0
    }
  };
}

function buildPriorityRiskCards(detail: ReportDetail): PriorityRiskCard[] {
  const merged: ReportIssue[] = [...detail.redFlags, ...detail.issues, ...detail.planningHazards];
  const deduped = dedupeBy(merged, riskSignature);

  return deduped
    .sort((a, b) => {
      const rankDelta = severityRank(a.severity) - severityRank(b.severity);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return a.title.localeCompare(b.title);
    })
    .map((risk, index) => {
      const domain = classifyRiskDomain(risk.title, risk.detail);
      const evidence = resolveEvidencePreview(risk, detail.citations);
      return {
        id: risk.id || `risk-${index + 1}`,
        title: risk.title,
        detail: risk.detail,
        severity: risk.severity,
        urgencyLabel: urgencyFromSeverity(risk.severity),
        pages: risk.pages ?? [],
        signature: riskSignature(risk),
        domain,
        buyerImpactSummary: buyerImpactSummary(risk),
        recommendedAction: recommendedAction(domain, risk.severity),
        milestone: milestoneFromSeverity(risk.severity),
        evidencePreviewSnippet: evidence.snippet,
        evidencePreviewPage: evidence.page,
        detailsExpandedContent: detailsExpandedContent(risk, evidence.snippet)
      };
    });
}

function buildNegotiationPlaybook(detail: ReportDetail): NegotiationPlaybookItem[] {
  return detail.negotiationIntelligence.levers
    .map((lever, index) => {
      const proof = lever.evidence[1];
      return {
        id: `lever-${index + 1}`,
        title: lever.title,
        suggestedAsk: lever.suggestedAsk,
        expectedImpact: capitalize(lever.estimatedImpact),
        confidence: capitalize(lever.confidence),
        tradeoff: lever.risksOrTradeoffs?.trim() || 'No material tradeoffs were identified from available evidence.',
        owner: 'Conveyancer',
        timing: leverageTimingLabel(lever),
        whyItMatters: lever.whyItMatters,
        useInConversation:
          normalizeText(lever.howToUseInNegotiation) ||
          'Lead with the evidence, then make a specific ask linked to timing, cost, or protection before exchange.',
        proofPoint: proof ? `${proof.quote} (${proof.locator})` : 'Use the uploaded evidence that supports this issue.',
        leverageLabel: leverageLabel(lever.estimatedImpact, lever.confidence)
      };
    })
    .sort((a, b) => leverageRank(a.leverageLabel) - leverageRank(b.leverageLabel));
}

function buildNegotiationActionSteps(detail: ReportDetail): NegotiationActionStep[] {
  return detail.negotiationIntelligence.recommendedNextSteps.map((step, index) => ({
    id: `negotiation-step-${index + 1}`,
    title: step.title,
    detail: step.detail,
    owner: ownerLabel(step.owner),
    timing: timingLabel(step.priority)
  }));
}

function buildBeforeExchangeChecklist(
  detail: ReportDetail,
  priorityRiskCards: PriorityRiskCard[]
): ReportDecisionViewModel['beforeExchangeChecklist'] {
  const checklistTasks: BeforeExchangeTask[] = detail.checklist.map((item, index) => {
    const urgency = urgencyFromChecklistStatus(item.status);
    return {
      id: item.id || `check-${index + 1}`,
      title: item.requirement,
      detail: item.description,
      urgencyLabel: urgency,
      status: item.status,
      owner: 'Conveyancer',
      milestone: urgency === 'Act now' ? 'Before exchange (immediately)' : 'Before exchange',
      evidence: item.evidence,
      pages: item.pages ?? []
    };
  });

  const missingInfoTasks = detail.missingInformation.map((item, index) => ({
    id: `missing-${item.id || index + 1}`,
    title: item.title,
    detail: item.detail,
    urgencyLabel: 'Review soon' as const,
    status: 'derived' as const,
    owner: 'Conveyancer',
    milestone: 'Before exchange',
    evidence: 'Information gap detected in uploaded material.',
    pages: item.pages
  }));

  const riskTasks = priorityRiskCards
    .filter((risk) => risk.severity === 'high' || risk.severity === 'medium')
    .map((risk) => ({
      id: `risk-task-${risk.id}`,
      title: risk.title,
      detail: risk.recommendedAction,
      urgencyLabel: risk.urgencyLabel,
      status: 'derived' as const,
      owner: 'Conveyancer',
      milestone: risk.milestone,
      evidence: risk.evidencePreviewSnippet,
      pages: risk.pages
    }));

  const merged = dedupeBy([...checklistTasks, ...missingInfoTasks, ...riskTasks], (item) => {
    return `${item.title}|${item.detail}`.toLowerCase();
  });

  return {
    actNow: merged.filter((item) => item.urgencyLabel === 'Act now').slice(0, 8),
    reviewSoon: merged.filter((item) => item.urgencyLabel === 'Review soon').slice(0, 10),
    monitor: merged.filter((item) => item.urgencyLabel === 'Monitor').slice(0, 6)
  };
}

function buildBuyerPriorityItems(detail: ReportDetail, priorityRiskCards: PriorityRiskCard[]): BuyerPriorityItem[] {
  const riskItems: BuyerPriorityItem[] = priorityRiskCards
    .filter((risk) => risk.severity === 'high' || risk.severity === 'medium')
    .map((risk) => ({
      id: `priority-risk-${risk.id}`,
      title: risk.title,
      summary: risk.buyerImpactSummary,
      impactLabel: impactLabelForRisk(risk),
      whatToGetInWriting: risk.recommendedAction,
      owner: 'Conveyancer',
      milestone: risk.milestone,
      urgencyLabel: risk.urgencyLabel,
      sourceLabel: 'Risk summary',
      supportNote: risk.evidencePreviewSnippet,
      pages: risk.pages
    }));

  const checklistItems: BuyerPriorityItem[] = detail.checklist
    .filter((item) => item.status === 'missing' || item.status === 'review')
    .map((item, index) => ({
      id: item.id || `priority-check-${index + 1}`,
      title: item.requirement,
      summary: item.description,
      impactLabel: impactLabelForChecklistItem(item.requirement, item.description, item.status),
      whatToGetInWriting: checklistOutcome(item.requirement, item.description, item.status),
      owner: 'Conveyancer',
      milestone: item.status === 'missing' ? 'Before exchange (immediately)' : 'Before exchange',
      urgencyLabel: urgencyFromChecklistStatus(item.status),
      sourceLabel: item.status === 'missing' ? 'Missing evidence' : 'Review item',
      supportNote: item.evidence,
      pages: item.pages ?? []
    }));

  const missingInfoItems: BuyerPriorityItem[] = detail.missingInformation.map((item, index) => ({
    id: item.id || `priority-missing-${index + 1}`,
    title: item.title,
    summary: item.detail,
    impactLabel: impactLabelForMissingInfo(item.title, item.detail),
    whatToGetInWriting: missingInfoOutcome(item.title, item.detail),
    owner: 'Conveyancer',
    milestone: 'Before exchange',
    urgencyLabel: 'Review soon',
    sourceLabel: 'Missing evidence',
    supportNote: 'Information gap detected in uploaded material.',
    pages: item.pages
  }));

  return dedupeBy([...riskItems, ...checklistItems, ...missingInfoItems], buyerPrioritySignature)
    .sort((a, b) => urgencyRank(a.urgencyLabel) - urgencyRank(b.urgencyLabel))
    .slice(0, 8);
}

function buildRiskMonitorItems(
  priorityRiskCards: PriorityRiskCard[],
  beforeExchangeChecklist: ReportDecisionViewModel['beforeExchangeChecklist']
): BuyerPriorityItem[] {
  const lowRiskItems: BuyerPriorityItem[] = priorityRiskCards
    .filter((risk) => risk.severity === 'low')
    .map((risk) => ({
      id: `monitor-risk-${risk.id}`,
      title: risk.title,
      summary: risk.buyerImpactSummary,
      impactLabel: impactLabelForRisk(risk),
      whatToGetInWriting: risk.recommendedAction,
      owner: 'Conveyancer',
      milestone: risk.milestone,
      urgencyLabel: risk.urgencyLabel,
      sourceLabel: 'Lower-priority risk',
      supportNote: risk.evidencePreviewSnippet,
      pages: risk.pages
    }));

  const monitorChecklistItems: BuyerPriorityItem[] = beforeExchangeChecklist.monitor.map((item) => ({
    id: `monitor-${item.id}`,
    title: item.title,
    summary: item.detail,
    impactLabel: 'Follow-up item',
    whatToGetInWriting: checklistOutcome(item.title, item.detail, 'complete'),
    owner: item.owner,
    milestone: item.milestone,
    urgencyLabel: item.urgencyLabel,
    sourceLabel: 'Monitor',
    supportNote: item.evidence,
    pages: item.pages
  }));

  return dedupeBy([...lowRiskItems, ...monitorChecklistItems], buyerPrioritySignature);
}

function buildFinancialComplianceItems(detail: ReportDetail): ReportDecisionViewModel['financialComplianceItems'] {
  const moneyTiming: AdvisoryItem[] = [];

  if (detail.financialModel) {
    if (isMeaningful(detail.financialModel.stampDutyEstimate)) {
      moneyTiming.push({
        id: 'money-stamp-duty',
        title: 'Indicative duty',
        detail: detail.financialModel.stampDutyEstimate,
        pages: [],
        recommendedAction: 'Confirm the final duty calculation with your conveyancer and revenue authority guidance.'
      });
    }
    if (isMeaningful(detail.financialModel.cashToSettleBand)) {
      moneyTiming.push({
        id: 'money-cash-to-settle',
        title: 'Estimated cash to settle',
        detail: detail.financialModel.cashToSettleBand,
        pages: [],
        recommendedAction: 'Validate this against lender requirements and settlement statement drafts.'
      });
    }
  }

  const financialFromClauses = [...(detail.financialItems ?? []), ...(detail.costsAndAdjustments ?? [])]
    .filter((item) => financialKeywordPattern.test(`${item.title} ${item.detail}`))
    .map((item) => mapClauseItemToAdvisory(item, moneyTimingAction(item.title, item.detail)));

  const investmentItems =
    detail.buyerType === 'investor'
      ? (detail.investmentSnapshot ?? []).map((item) =>
        mapClauseItemToAdvisory(item, 'Confirm whether this assumption still matches your expected holding costs and rental plan.')
        )
      : [];

  const complianceFromChecklist = (detail.checklist ?? [])
    .filter((item) => costsComplianceKeywordPattern.test(`${item.requirement} ${item.description}`))
    .map((item, index) => ({
      id: item.id || `cost-check-${index + 1}`,
      title: item.requirement,
      detail: item.description,
      pages: item.pages ?? [],
      recommendedAction: costUncertaintyAction(item.requirement, item.description)
    }));

  const complianceFromMissingInfo = (detail.missingInformation ?? [])
    .filter((item) => costsComplianceKeywordPattern.test(`${item.title} ${item.detail}`))
    .map((item, index) => ({
      id: item.id || `missing-compliance-${index + 1}`,
      title: item.title,
      detail: item.detail,
      pages: item.pages,
      recommendedAction: costUncertaintyAction(item.title, item.detail)
    }));

  const complianceApproval = dedupeBy(
    [...complianceFromChecklist, ...complianceFromMissingInfo],
    advisorySignature
  ).slice(0, 10);

  const settlementAdjustments = (detail.settlementAdjustments ?? []).map((item) =>
    mapClauseItemToAdvisory(item, settlementAdjustmentAction(item.title, item.detail))
  );

  return {
    moneyTiming: dedupeBy([...moneyTiming, ...financialFromClauses, ...investmentItems], advisorySignature).slice(0, 10),
    complianceApproval,
    settlementAdjustments: dedupeBy(settlementAdjustments, advisorySignature).slice(0, 10)
  };
}

function buildBuildingPhysicalItems(detail: ReportDetail, priorityRiskCards: PriorityRiskCard[]): PropertyConditionItem[] {
  const riskItems = priorityRiskCards
    .filter((risk) => risk.domain === 'building')
    .map((risk) => ({
      id: `building-risk-${risk.id}`,
      title: risk.title,
      detail: risk.buyerImpactSummary,
      pages: risk.pages,
      recommendedAction: risk.recommendedAction,
      urgencyLabel: risk.urgencyLabel,
      category: 'condition' as const,
      sourceLabel: 'Risk summary',
      impactLabel: propertyImpactLabel(risk.title, risk.detail, 'condition'),
      buyerQuestion: propertyBuyerQuestion(risk.title, risk.detail, 'condition')
    }));

  const strataItems = detail.strataInsights.map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    pages: item.pages,
    recommendedAction: 'Confirm physical condition impact and inspection scope with your conveyancer.',
    urgencyLabel: 'Review soon' as const,
    category: 'strata' as const,
    sourceLabel: 'Strata records',
    impactLabel: propertyImpactLabel(item.title, item.detail, 'strata'),
    buyerQuestion: propertyBuyerQuestion(item.title, item.detail, 'strata')
  }));

  const checklistItems = detail.checklist
    .filter((item) => propertyConditionKeywordPattern.test(`${item.requirement} ${item.description} ${item.evidence}`))
    .map((item, index) => ({
      id: item.id || `building-check-${index + 1}`,
      title: item.requirement,
      detail: item.description,
      pages: item.pages ?? [],
      recommendedAction:
        item.status === 'complete'
          ? 'Keep this evidence on file and confirm whether any further inspection is still recommended.'
          : 'Arrange inspection or specialist advice before exchange.',
      urgencyLabel: urgencyFromChecklistStatus(item.status),
      category: 'inspection' as const,
      sourceLabel: item.status === 'complete' ? 'Inspection note' : 'Inspection follow-up',
      impactLabel: propertyImpactLabel(item.requirement, item.description, 'inspection'),
      buyerQuestion: propertyBuyerQuestion(item.requirement, item.description, 'inspection')
    }));

  const missingInfoItems = detail.missingInformation
    .filter((item) => propertyConditionKeywordPattern.test(`${item.title} ${item.detail}`))
    .map((item, index) => ({
      id: item.id || `building-missing-${index + 1}`,
      title: item.title,
      detail: item.detail,
      pages: item.pages,
      recommendedAction: missingInfoOutcome(item.title, item.detail),
      urgencyLabel: 'Review soon' as const,
      category: 'inspection' as const,
      sourceLabel: 'Missing evidence',
      impactLabel: propertyImpactLabel(item.title, item.detail, 'inspection'),
      buyerQuestion: propertyBuyerQuestion(item.title, item.detail, 'inspection')
    }));

  const validationWarningItems = detail.validationWarnings
    .filter((warning) => propertyConditionKeywordPattern.test(warning))
    .map((warning, index) => ({
      id: `building-warning-${index + 1}`,
      title: 'Manual review required',
      detail: warning,
      pages: [],
      recommendedAction: manualReviewOutcome(warning),
      urgencyLabel: 'Review soon' as const,
      category: 'inspection' as const,
      sourceLabel: 'Manual review',
      impactLabel: 'Unverified condition',
      buyerQuestion: 'Which pages or attachments need manual review before I rely on the property-condition evidence?'
    }));

  return dedupeBy([...riskItems, ...strataItems, ...checklistItems, ...missingInfoItems, ...validationWarningItems], propertyConditionSignature).slice(0, 12);
}

function buildContractConditionItems(detail: ReportDetail): ContractConditionItem[] {
  const fromClauses = detail.unusualClauses.map((item) => mapClauseItemToCondition(item, detail.citations));
  const fallbackFromFacts = fromClauses.length === 0 ? buildContractConditionFactFallbacks(detail.contractFacts) : [];

  return dedupeBy([...fromClauses, ...fallbackFromFacts], (item) => `${item.title}|${item.whatThisMeans}`.toLowerCase()).slice(0, 20);
}

function buildContractConditionSections(
  items: ContractConditionItem[]
): ReportDecisionViewModel['contractConditionSections'] {
  return {
    decisionCritical: items.filter((item) => item.category === 'timing' || item.category === 'finance').slice(0, 6),
    propertyRights: items.filter((item) => item.category === 'possession' || item.category === 'property-risk').slice(0, 6),
    other: items.filter((item) => item.category === 'general').slice(0, 6)
  };
}

function buildContractConditionSummary(
  sections: ReportDecisionViewModel['contractConditionSections']
): ReportDecisionViewModel['contractConditionSummary'] {
  if (sections.decisionCritical.length > 0) {
    return {
      label: 'Changes your exchange risk',
      tone: 'high',
      headline: `${sections.decisionCritical.length} special condition${sections.decisionCritical.length === 1 ? '' : 's'} could change your deadlines, finance position, or default exposure.`,
      detail: 'Treat these as changes to the standard contract, not background boilerplate.'
    };
  }

  if (sections.propertyRights.length > 0) {
    return {
      label: 'Changes what you get',
      tone: 'medium',
      headline: 'Some special conditions appear to affect possession, condition risk, or what passes to you at settlement.',
      detail: 'Confirm exactly which risks stay with the seller and which ones move to you before exchange.'
    };
  }

  return {
    label: 'Clause cleanup',
    tone: 'neutral',
    headline: 'No major deadline or possession shifts were surfaced, but the special conditions still deserve a clean legal read-through.',
    detail: 'Use this tab to make sure each non-standard clause has been explained back to you in plain language.'
  };
}

function resolveRecommendation(
  status: ReportDetail['status'],
  severityCounts: Record<IssueSeverity, number>,
  hasManualChecks: boolean
): { recommendation: DecisionRecommendation; label: string; rationale: string; tone: VerdictTone } {
  if (status === 'failed') {
    return {
      recommendation: 'pause-and-review',
      label: 'Pause and review',
      rationale: 'This report did not complete successfully. Confirm technical details and re-run before making decisions.',
      tone: 'neutral'
    };
  }

  if (status !== 'ready') {
    return {
      recommendation: 'proceed-with-conditions',
      label: 'Proceed with conditions',
      rationale: 'The report is still in progress. Treat findings as preliminary until processing is complete.',
      tone: 'neutral'
    };
  }

  if (severityCounts.high > 0) {
    return {
      recommendation: 'pause-and-review',
      label: 'Pause and review',
      rationale: `${severityCounts.high} high-severity issue${severityCounts.high === 1 ? '' : 's'} should be resolved or contractually managed before exchange.`,
      tone: 'high'
    };
  }

  if (severityCounts.medium > 0 || hasManualChecks) {
    return {
      recommendation: 'proceed-with-conditions',
      label: 'Proceed with conditions',
      rationale:
        'No high-severity blockers were detected, but there are items that must be confirmed in writing before you commit.',
      tone: 'medium'
    };
  }

  return {
    recommendation: 'proceed',
    label: 'Proceed',
    rationale: 'No high or medium risks were detected from available evidence. Confirm final legal checks before exchange.',
    tone: 'low'
  };
}

function resolveTopActions(detail: ReportDetail, priorityRiskCards: PriorityRiskCard[]): string[] {
  const riskActions = priorityRiskCards
    .filter((risk) => risk.severity !== 'low')
    .slice(0, 3)
    .map((risk) => `${risk.title}: ${risk.recommendedAction}`);

  const checklistActions = detail.checklist
    .filter((item) => item.status === 'missing')
    .map((item) => `Request ${item.requirement}: ${item.description}`);

  const negotiationActions = detail.negotiationIntelligence.recommendedNextSteps.map((step) => {
    return `${step.title}: ${step.detail}`;
  });

  const actions = dedupeStrings([
    ...detail.recommendedActions,
    ...riskActions,
    ...checklistActions,
    ...negotiationActions
  ]).slice(0, 3);

  if (actions.length > 0) {
    return actions;
  }

  return ['Review this report with your conveyancer before exchange and confirm the highest-priority items.'];
}

function buildNextSteps(
  actionPlanNarrative: ReportDetail['narrativeSections'][number] | null,
  topActions: string[],
  checklist: ReportDecisionViewModel['beforeExchangeChecklist']
): string[] {
  const checklistActions = [...checklist.actNow, ...checklist.reviewSoon]
    .slice(0, 4)
    .map((item) => `${item.title}: ${item.detail}`);

  return dedupeStrings([...(actionPlanNarrative?.recommendedActions ?? []), ...topActions, ...checklistActions]).slice(0, 8);
}

function countSeverity(risks: PriorityRiskCard[]): Record<IssueSeverity, number> {
  return risks.reduce(
    (acc, risk) => {
      acc[risk.severity] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );
}

function resolveEvidencePreview(risk: ReportIssue, citations: ReportCitation[]): { snippet: string; page: number | null } {
  const pageMatched = citations.find((citation) => {
    return citation.pageNumber !== null && citation.pageNumber !== undefined && (risk.pages ?? []).includes(citation.pageNumber);
  });
  const selected = pageMatched || citations[0] || null;

  if (!selected) {
    return {
      snippet: firstSentence(risk.detail),
      page: (risk.pages ?? [])[0] ?? null
    };
  }

  return {
    snippet: truncateText(firstSentence(selected.quoteSnippet), 180),
    page: selected.pageNumber ?? (risk.pages ?? [])[0] ?? null
  };
}

function detailsExpandedContent(risk: ReportIssue, evidenceSnippet: string): string {
  const detail = normalizeText(risk.detail);
  if (!detail) {
    return evidenceSnippet;
  }
  if (detail.toLowerCase() === evidenceSnippet.toLowerCase()) {
    return detail;
  }
  return `${detail} Evidence context: ${evidenceSnippet}`;
}

function buyerImpactSummary(risk: ReportIssue): string {
  const detail = firstSentence(risk.detail);
  if (detail) {
    return detail;
  }

  if (risk.severity === 'high') {
    return 'This issue can materially affect your legal position, cost, or settlement timing.';
  }
  if (risk.severity === 'medium') {
    return 'This issue can affect costs or timing if it is not clarified before exchange.';
  }
  return 'This is a lower-priority issue but should still be confirmed during legal review.';
}

function recommendedAction(domain: RiskDomain, severity: IssueSeverity): string {
  if (domain === 'building') {
    return 'Request building advice and negotiate remedy, credit, or contract protection before exchange.';
  }

  if (domain === 'financial') {
    return 'Confirm the financial impact in writing and align contract timing with lender and settlement constraints.';
  }

  if (severity === 'high') {
    return 'Escalate this with your conveyancer now and confirm whether exchange should be delayed until resolved.';
  }

  if (severity === 'medium') {
    return 'Confirm this in writing with your conveyancer before exchange and document the agreed position.';
  }

  return 'Monitor this item and confirm whether any protective wording is needed before settlement.';
}

function milestoneFromSeverity(severity: IssueSeverity): string {
  if (severity === 'high') {
    return 'Before exchange (immediately)';
  }
  if (severity === 'medium') {
    return 'Before exchange';
  }
  return 'Before settlement';
}

function urgencyFromSeverity(severity: IssueSeverity): UrgencyLabel {
  if (severity === 'high') {
    return 'Act now';
  }
  if (severity === 'medium') {
    return 'Review soon';
  }
  return 'Monitor';
}

function urgencyFromChecklistStatus(status: ChecklistStatus): UrgencyLabel {
  if (status === 'missing') {
    return 'Act now';
  }
  if (status === 'review') {
    return 'Review soon';
  }
  return 'Monitor';
}

function buildPropertyConditionSections(
  items: PropertyConditionItem[]
): ReportDecisionViewModel['propertyConditionSections'] {
  const costExposure = items.filter((item) => item.category !== 'inspection' && item.urgencyLabel !== 'Monitor').slice(0, 6);
  const costExposureIds = new Set(costExposure.map((item) => item.id));
  const unknowns = items
    .filter((item) => !costExposureIds.has(item.id) && item.category === 'inspection')
    .slice(0, 6);
  const unknownIds = new Set(unknowns.map((item) => item.id));
  const watch = items.filter((item) => !costExposureIds.has(item.id) && !unknownIds.has(item.id)).slice(0, 6);

  return {
    costExposure,
    unknowns,
    watch
  };
}

function buildPropertyConditionGroups(
  items: PropertyConditionItem[]
): ReportDecisionViewModel['propertyConditionGroups'] {
  const immediate = items.filter((item) => item.urgencyLabel === 'Act now' || (item.category === 'condition' && item.urgencyLabel === 'Review soon'));
  const immediateIds = new Set(immediate.map((item) => item.id));
  const dueDiligence = items.filter((item) => !immediateIds.has(item.id) && item.urgencyLabel !== 'Monitor');
  const dueDiligenceIds = new Set(dueDiligence.map((item) => item.id));
  const watch = items.filter((item) => !immediateIds.has(item.id) && !dueDiligenceIds.has(item.id));

  return {
    immediate: immediate.slice(0, 6),
    dueDiligence: dueDiligence.slice(0, 6),
    watch: watch.slice(0, 6)
  };
}

function buildPropertyConditionSummary(
  sections: ReportDecisionViewModel['propertyConditionSections']
): PropertyConditionSummary {
  if (sections.costExposure.length > 0) {
    return {
      label: 'Needs prompt review',
      tone: 'high',
      headline: `${sections.costExposure.length} property item${sections.costExposure.length === 1 ? '' : 's'} could turn into repair cost, shared-building cost, or negotiation pressure.`,
      detail:
        firstSentence(sections.costExposure[0]?.detail) ||
        'A physical-condition issue could affect repair cost, insurability, or your negotiation position before exchange.'
    };
  }

  if (sections.unknowns.length > 0) {
    return {
      label: 'Proof gaps remain',
      tone: 'medium',
      headline: 'No major defect surfaced, but the pack still leaves some property-condition questions unproven.',
      detail:
        'Use this tab to close out inspections, strata records, and any unreadable condition evidence before you commit.'
    };
  }

  return {
    label: 'Condition looks clear',
    tone: 'low',
    headline: 'No material property-condition issues were extracted from the uploaded evidence.',
    detail:
      'Keep the usual pre-settlement inspection and legal review in place, but nothing here stands out as a separate condition blocker.'
  };
}

function leverageTimingLabel(lever: ReportDetail['negotiationIntelligence']['levers'][number]): string {
  if (lever.confidence === 'high' || lever.estimatedImpact === 'high') {
    return 'Before exchange';
  }
  if (lever.confidence === 'low' && lever.estimatedImpact === 'low') {
    return 'Only if the bigger asks fail';
  }
  return 'After the main legal checks';
}

function leverageLabel(estimatedImpact: string, confidence: string): string {
  if (estimatedImpact === 'high' && confidence === 'high') {
    return 'Best shot';
  }
  if (estimatedImpact === 'high' || confidence === 'high' || estimatedImpact === 'medium') {
    return 'Worth trying';
  }
  return 'Fallback only';
}

function leverageRank(label: string): number {
  if (label === 'Best shot') {
    return 3;
  }
  if (label === 'Worth trying') {
    return 2;
  }
  return 1;
}

function ownerLabel(owner: string): string {
  if (owner === 'buildingInspector') {
    return 'Building inspector';
  }
  if (owner === 'buyer') {
    return 'Buyer';
  }
  if (owner === 'agent') {
    return 'Agent';
  }
  return 'Conveyancer';
}

function urgencyRank(urgencyLabel: UrgencyLabel): number {
  if (urgencyLabel === 'Act now') {
    return 0;
  }
  if (urgencyLabel === 'Review soon') {
    return 1;
  }
  return 2;
}

function timingLabel(priority: string): string {
  if (priority === 'now') {
    return 'Now';
  }
  if (priority === 'later') {
    return 'After exchange if still relevant';
  }
  return 'Before exchange';
}

function severityRank(severity: IssueSeverity): number {
  if (severity === 'high') {
    return 0;
  }
  if (severity === 'medium') {
    return 1;
  }
  return 2;
}

function classifyRiskDomain(title: string, detail: string): RiskDomain {
  const text = `${title} ${detail}`;
  if (buildingKeywordPattern.test(text)) {
    return 'building';
  }
  if (financialKeywordPattern.test(text) || complianceKeywordPattern.test(text)) {
    return 'financial';
  }
  return 'general';
}

function impactLabelForRisk(risk: PriorityRiskCard): string {
  if (risk.domain === 'financial') {
    if (/\bdeposit|finance|funding|loan\b/i.test(`${risk.title} ${risk.detail}`)) {
      return 'Deposit risk';
    }
    if (/\bsettlement|deadline|completion|default|interest\b/i.test(`${risk.title} ${risk.detail}`)) {
      return 'Timeline risk';
    }
    return 'Cashflow risk';
  }

  if (risk.domain === 'building') {
    return 'Repair cost';
  }

  if (/\bnotice|approval|certificate|disclosure|missing\b/i.test(`${risk.title} ${risk.detail}`)) {
    return 'Unverified information';
  }

  return 'Contract protection';
}

function impactLabelForChecklistItem(title: string, detail: string, status: ChecklistStatus): string {
  const text = `${title} ${detail}`;
  if (status === 'missing') {
    if (/\brates?|water|levy|tax|duty|deposit|settlement/i.test(text)) {
      return 'Cashflow risk';
    }
    if (propertyConditionKeywordPattern.test(text)) {
      return 'Unverified condition';
    }
    return 'Unverified information';
  }

  if (propertyConditionKeywordPattern.test(text)) {
    return 'Unverified condition';
  }
  if (/\bdate|deadline|settlement|default\b/i.test(text)) {
    return 'Timeline risk';
  }
  return 'Follow-up item';
}

function impactLabelForMissingInfo(title: string, detail: string): string {
  const text = `${title} ${detail}`;
  if (propertyConditionKeywordPattern.test(text)) {
    return 'Unverified condition';
  }
  if (/\brates?|water|levy|tax|duty|price|deposit|settlement/i.test(text)) {
    return 'Cashflow risk';
  }
  return 'Unverified information';
}

function checklistOutcome(title: string, detail: string, status: ChecklistStatus | 'complete'): string {
  const text = `${title} ${detail}`.toLowerCase();
  if (status === 'missing') {
    if (text.includes('rates') || text.includes('water') || text.includes('levy')) {
      return 'Get the current notice and have the exact adjustment confirmed before exchange.';
    }
    if (text.includes('finance') || text.includes('deposit')) {
      return 'Get written confirmation of the money and timing exposure before you sign.';
    }
    if (propertyConditionKeywordPattern.test(text)) {
      return 'Get the missing property-condition evidence or inspection result before you rely on the pack.';
    }
    return 'Get this missing evidence or written confirmation before exchange.';
  }

  if (propertyConditionKeywordPattern.test(text)) {
    return 'Have your conveyancer confirm whether this inspection point is fully resolved or still needs follow-up.';
  }
  if (text.includes('settlement') || text.includes('date') || text.includes('deadline')) {
    return 'Have the final timing confirmed in writing before exchange.';
  }
  return 'Confirm in writing whether any further action is still needed before exchange.';
}

function missingInfoOutcome(title: string, detail: string): string {
  const text = `${title} ${detail}`.toLowerCase();
  if (propertyConditionKeywordPattern.test(text)) {
    return 'Request the missing property or inspection document and review it before you rely on the physical condition of the property.';
  }
  if (text.includes('rates') || text.includes('water') || text.includes('levy')) {
    return 'Request the current notice so the final cash to settle can be checked on real figures.';
  }
  return 'Request this missing document or explanation and have your conveyancer confirm the buyer impact before exchange.';
}

function manualReviewOutcome(warning: string): string {
  if (/image-only|unreadable|scan/i.test(warning)) {
    return 'Have the unreadable pages reviewed manually or reissued in a usable format before you rely on them.';
  }
  return 'Have this warning checked manually before you rely on the report for exchange decisions.';
}

function propertyImpactLabel(title: string, detail: string, category: PropertyConditionItem['category']): string {
  const text = `${title} ${detail}`;
  if (category === 'inspection') {
    return 'Unverified condition';
  }
  if (category === 'strata') {
    return 'Shared building risk';
  }
  if (/\basbestos|mould|mold|termite|pest\b/i.test(text)) {
    return 'Insurance / health';
  }
  if (/\bmoisture|leak|roof|crack|structur|foundation|retaining|drainage|waterproof|plumbing|electrical\b/i.test(text)) {
    return 'Repair cost';
  }
  return 'Move-in risk';
}

function propertyBuyerQuestion(title: string, detail: string, category: PropertyConditionItem['category']): string {
  const text = `${title} ${detail}`;
  if (category === 'inspection') {
    return 'What evidence do we still need before I can rely on the property-condition position?';
  }
  if (category === 'strata') {
    return 'Do the strata records point to repairs, disputes, or future levies that I should price in now?';
  }
  if (/\basbestos|mould|mold|termite|pest\b/i.test(text)) {
    return 'Does this create any health, insurance, or immediate remediation issue after settlement?';
  }
  if (/\bmoisture|leak|roof|crack|structur|foundation|retaining|drainage|waterproof\b/i.test(text)) {
    return 'Do we need an extra inspection, quote, or repair credit before exchange?';
  }
  return 'Could this affect move-in, ongoing maintenance, or what I should negotiate before exchange?';
}

function mapClauseItemToAdvisory(item: ReportClauseItem, recommendedActionText: string): AdvisoryItem {
  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    pages: item.pages,
    recommendedAction: recommendedActionText
  };
}

function mapClauseItemToCondition(item: ReportClauseItem, citations: ReportCitation[]): ContractConditionItem {
  const inferredGuidance = inferContractClauseGuidance(item.title, item.detail, item.clauseText);
  const category = classifyContractConditionCategory(item.title, item.detail, item.clauseText);
  return {
    id: item.id,
    title: item.title,
    clauseText: resolveClauseText(item, citations),
    whatThisMeans: normalizeText(item.whatThisMeans) || inferredGuidance.whatThisMeans,
    whyItMatters: normalizeText(item.whyItMatters) || inferredGuidance.whyItMatters,
    askConveyancer: normalizeText(item.askConveyancer) || inferredGuidance.askConveyancer,
    category,
    impactLabel: contractImpactLabel(category),
    whatToConfirm: contractWhatToConfirm(category, normalizeText(item.askConveyancer) || inferredGuidance.askConveyancer),
    detail: item.detail,
    pages: item.pages
  };
}

function buildContractConditionFactFallbacks(contractFacts: ReportContractFact[]): ContractConditionItem[] {
  return contractFacts
    .filter((fact) => fact.label === 'Tenancy conditions' || fact.label === 'Special conditions')
    .map((fact) => {
      const guidance = inferContractClauseGuidance(fact.label, fact.value, fact.value);
      const category = classifyContractConditionCategory(fact.label, fact.value, fact.value);
      return {
        id: `contract-fact-${fact.id}`,
        title: fact.label,
        clauseText: fact.value,
        whatThisMeans: guidance.whatThisMeans,
        whyItMatters: guidance.whyItMatters,
        askConveyancer: guidance.askConveyancer,
        category,
        impactLabel: contractImpactLabel(category),
        whatToConfirm: contractWhatToConfirm(category, guidance.askConveyancer),
        detail: fact.value,
        pages: []
      };
    });
}

function resolveClauseText(item: ReportClauseItem, citations: ReportCitation[]): string {
  const explicit = normalizeText(item.clauseText);
  if (explicit) {
    return explicit;
  }

  const citationLookup = new Set((item.evidenceRefs ?? []).map((value) => value.trim().toLowerCase()));
  const match = citations.find((citation) => citationLookup.has(citation.chunkId.trim().toLowerCase()) && normalizeText(citation.quoteSnippet));
  return normalizeText(match?.quoteSnippet) || firstSentence(item.detail);
}

function inferContractClauseGuidance(
  title: string,
  detail: string,
  clauseText?: string | null
): Pick<ContractConditionItem, 'whatThisMeans' | 'whyItMatters' | 'askConveyancer'> {
  const combined = `${title} ${detail} ${clauseText ?? ''}`;
  if (contractTenancyPattern.test(combined)) {
    return {
      whatThisMeans: 'The contract appears to deal with whether you receive the property empty or with a tenant still in place.',
      whyItMatters: 'This affects when you can move in, whether rent continues, and what tenancy paperwork or bond obligations pass to you at settlement.',
      askConveyancer:
        'Can you confirm whether I get vacant possession at settlement, what tenancy documents you need to review, and whether any bond or notice obligations transfer to me?'
    };
  }

  if (contractDefectPattern.test(combined)) {
    return {
      whatThisMeans: 'This clause appears to shift property-condition and service-related risk back onto you.',
      whyItMatters:
        'If defects, boundary issues, infestations, or service problems show up later, it may be harder to delay settlement, ask for compensation, or rely on informal seller statements.',
      askConveyancer:
        'How far does this clause limit my rights on defects, services, boundaries, or pest issues, and should we ask for a carve-out, repair credit, or extra inspection protection before exchange?'
    };
  }

  if (contractFinancePattern.test(combined)) {
    return {
      whatThisMeans: 'This clause appears to assume your funding and any buyer approval requirements are already sorted.',
      whyItMatters:
        'If finance approval or a required buyer approval is delayed, withdrawn, or wrongly assumed to be unnecessary, you may still be exposed to default, loss, or an indemnity claim.',
      askConveyancer:
        'Does this contract give me any finance or approval protection, and what is my exposure if funding or buyer approval is delayed, withdrawn, or not needed as assumed?'
    };
  }

  if (contractTimingPattern.test(combined)) {
    return {
      whatThisMeans: 'This clause appears to tighten timing, completion, or default mechanics compared with the standard form.',
      whyItMatters:
        'Shorter deadlines or stricter default wording can increase the risk of penalty interest, a notice to complete, or other loss if something slips before settlement.',
      askConveyancer:
        'Which completion, notice, default, or penalty-interest parts of this clause override the standard contract, and do you recommend changing any of them before exchange?'
    };
  }

  return {
    whatThisMeans: firstSentence(detail) || 'This clause changes how the contract works and needs legal confirmation before you rely on it.',
    whyItMatters: 'Special conditions can override standard protections, shift risk onto you, or change what happens if there is a dispute before settlement.',
    askConveyancer: 'Can you explain exactly what this clause changes from the standard contract and whether you recommend negotiating any amendment before exchange?'
  };
}

function classifyContractConditionCategory(
  title: string,
  detail: string,
  clauseText?: string | null
): ContractConditionItem['category'] {
  const combined = `${title} ${detail} ${clauseText ?? ''}`;
  if (contractTenancyPattern.test(combined)) {
    return 'possession';
  }
  if (contractDefectPattern.test(combined)) {
    return 'property-risk';
  }
  if (contractFinancePattern.test(combined)) {
    return 'finance';
  }
  if (contractTimingPattern.test(combined)) {
    return 'timing';
  }
  return 'general';
}

function contractImpactLabel(category: ContractConditionItem['category']): string {
  if (category === 'timing') {
    return 'Deadline / default';
  }
  if (category === 'finance') {
    return 'Finance / approval';
  }
  if (category === 'possession') {
    return 'Move-in / possession';
  }
  if (category === 'property-risk') {
    return 'Condition / repair risk';
  }
  return 'Special condition';
}

function contractWhatToConfirm(category: ContractConditionItem['category'], askConveyancer: string): string {
  if (category === 'timing') {
    return 'Confirm the exact deadline or default change, whether it overrides the standard contract, and whether it should be negotiated before exchange.';
  }
  if (category === 'finance') {
    return 'Confirm what finance or approval protection you actually have, and what happens if funding or approval slips after exchange.';
  }
  if (category === 'possession') {
    return 'Confirm whether you still get vacant possession and which tenancy or handover obligations pass to you at settlement.';
  }
  if (category === 'property-risk') {
    return 'Confirm where property-condition risk sits, and whether you should ask for a repair carve-out, extra inspection, or price protection before exchange.';
  }
  return askConveyancer;
}

function findNarrativeSection(detail: ReportDetail, id: string): ReportDetail['narrativeSections'][number] | null {
  return detail.narrativeSections.find((section) => section.id === id) ?? null;
}

function findStateSpecificSection(detail: ReportDetail, id: string): ReportDetail['stateSpecificSections'][number] | null {
  return detail.stateSpecificSections.find((section) => section.id === id) ?? null;
}

function parseStructuredGuidanceSection(
  section: ReportDetail['stateSpecificSections'][number] | null
): StructuredGuidanceSection | null {
  const content = normalizeText(section?.content?.replace(/\n+/g, ' '));
  if (!content) {
    return null;
  }

  const whatThisMeans = extractGuidancePart(content, 'What this means:', ['Why it matters:', 'Ask your conveyancer:']);
  const whyItMatters = extractGuidancePart(content, 'Why it matters:', ['Ask your conveyancer:']);
  const askYourConveyancer = extractGuidancePart(content, 'Ask your conveyancer:', []);

  if (!whatThisMeans && !whyItMatters && !askYourConveyancer) {
    return {
      whatThisMeans: content,
      whyItMatters: '',
      askYourConveyancer: ''
    };
  }

  return {
    whatThisMeans,
    whyItMatters,
    askYourConveyancer
  };
}

function extractGuidancePart(content: string, label: string, nextLabels: string[]): string {
  const nextPattern = nextLabels.map((value) => escapeRegExp(value)).join('|');
  const suffix = nextPattern ? `(?=${nextPattern}|$)` : '$';
  const regex = new RegExp(`${escapeRegExp(label)}\\s*(.*?)\\s*${suffix}`, 'i');
  const match = content.match(regex);
  return normalizeText(match?.[1] ?? '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function advisorySignature(item: AdvisoryItem): string {
  return `${item.title}|${item.detail}`.toLowerCase();
}

function buyerPrioritySignature(item: BuyerPriorityItem): string {
  return `${item.title}|${item.summary}|${item.whatToGetInWriting}`.toLowerCase();
}

function propertyConditionSignature(item: PropertyConditionItem): string {
  return `${item.category}|${item.title}|${item.detail}`.toLowerCase();
}

function riskSignature(item: Pick<ReportIssue, 'severity' | 'title' | 'detail'>): string {
  return `${item.severity}|${item.title}|${item.detail}`.trim().toLowerCase();
}

function dedupeBy<T>(rows: T[], signature: (row: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const row of rows) {
    const key = signature(row);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(row);
  }

  return result;
}

function dedupeStrings(rows: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const row of rows) {
    const value = row.trim();
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function firstSentence(value: string | null | undefined): string {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  const sentenceMatch = text.match(/[^.!?]+[.!?]?/);
  const sentence = sentenceMatch?.[0]?.trim() || text;
  return truncateText(sentence, 220);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function moneyTimingAction(title: string, detail: string): string {
  const text = `${title} ${detail}`.toLowerCase();
  if (text.includes('deposit')) {
    return 'Make sure this money is already available and confirm when it must clear before settlement.';
  }
  if (text.includes('duty') || text.includes('stamp') || text.includes('tax') || text.includes('concession')) {
    return 'Confirm the final duty or tax position and any exemption paperwork before settlement.';
  }
  if (text.includes('balance') || text.includes('settlement') || text.includes('completion') || text.includes('cash')) {
    return 'Ask your conveyancer for the latest settlement statement so you know the exact amount still due.';
  }
  if (text.includes('fee')) {
    return 'Check whether this fee is already included or still payable on top of your settlement funds.';
  }
  return 'Ask your conveyancer what is already fixed and what can still change before settlement.';
}

function costUncertaintyAction(title: string, detail: string): string {
  const text = `${title} ${detail}`.toLowerCase();
  if (text.includes('rates') || text.includes('water') || text.includes('sewer')) {
    return 'Ask your conveyancer to get the current notice so your settlement adjustment uses real figures.';
  }
  if (text.includes('strata') || text.includes('levy')) {
    return 'Get the latest strata certificate or levy notice before you rely on the final amount due at settlement.';
  }
  if (text.includes('duty') || text.includes('stamp') || text.includes('tax') || text.includes('concession')) {
    return 'Confirm whether this changes your duty position or any exemption paperwork before settlement.';
  }
  if (text.includes('certificate') || text.includes('compliance') || text.includes('approval')) {
    return 'Check whether this missing item can delay settlement or change your final costs.';
  }
  return 'Ask your conveyancer whether this missing item can change your timing, risk, or money due before settlement.';
}

function settlementAdjustmentAction(title: string, detail: string): string {
  const text = `${title} ${detail}`.toLowerCase();
  if (text.includes('rates') || text.includes('water') || text.includes('sewer')) {
    return 'Ask for the current notice and confirm the adjustment method on the draft settlement statement.';
  }
  if (text.includes('strata') || text.includes('levy')) {
    return 'Confirm whether any normal or special levies are included before settlement.';
  }
  if (text.includes('land tax')) {
    return 'Check whether land tax applies and how it will be apportioned on the settlement statement.';
  }
  return 'Ask your conveyancer to confirm how this item will be calculated on the settlement statement.';
}

function isMeaningful(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && normalized !== 'unavailable' && normalized !== 'n/a';
}
