import { ReportDetail } from '@shared-core/models/report.models';
import { buildReportDecisionViewModel } from './report-decision-view-model';

describe('buildReportDecisionViewModel', () => {
  it('uses top-level property address as canonical and dedupes overlapping priority risks', () => {
    const detail = buildBaseDetail();
    const viewModel = buildReportDecisionViewModel(detail);

    expect(viewModel.canonicalPropertyAddress).toBe('10 Example Street, Canberra ACT');
    expect(viewModel.priorityRiskCards.length).toBe(1);
    expect(viewModel.priorityRiskCards[0].urgencyLabel).toBe('Act now');
    expect(viewModel.decisionRecommendation).toBe('pause-and-review');
    expect(viewModel.financialComplianceItems.moneyTiming).toEqual([]);
  });

  it('promotes validation warnings into manual checks and recommends conditions when no high risk exists', () => {
    const detail = buildBaseDetail();
    detail.validationWarnings = ['Pages 30 to 40 are image-only and require manual review.'];
    detail.issues = [
      {
        id: 'issue-medium',
        title: 'Settlement date wording needs confirmation',
        detail: 'The settlement date clause appears ambiguous across annexures.',
        severity: 'medium',
        pages: [2]
      }
    ];
    detail.redFlags = [];

    const viewModel = buildReportDecisionViewModel(detail);

    expect(viewModel.manualChecks[0]).toContain('image-only');
    expect(viewModel.decisionRecommendation).toBe('proceed-with-conditions');
    expect(viewModel.decisionRecommendationLabel).toBe('Proceed with conditions');
  });

  it('extracts buyer-facing cost and conveyancer guidance into dedicated sections', () => {
    const detail = buildBaseDetail();
    detail.narrativeSections = [
      {
        id: 'costs-cashflow',
        heading: 'Costs and settlement implications',
        intro: 'This section separates confirmed figures from items that still need checking.',
        analysis: 'The price and deposit are visible, but current notices are still needed for the final settlement statement.',
        buyerImpact: 'Missing notices can change the cash you need on settlement day.',
        recommendedActions: ['Ask your conveyancer for the latest settlement statement draft.']
      },
      {
        id: 'lawyer-questions',
        heading: 'Questions for your conveyancer',
        intro: 'Use this list to get clear written answers.',
        analysis: 'Focus on costs, timing, and any missing documents before exchange.',
        buyerImpact: 'Written answers reduce avoidable surprises.',
        recommendedActions: ['Email this list to your conveyancer.']
      }
    ];
    detail.stateSpecificSections = [
      {
        id: 'state-deadlines-and-money',
        heading: 'ACT key dates and money checks',
        content:
          'What this means: The deposit timing is clear, but final adjustments are not. Why it matters: Missing notices can change the cash you need on settlement day. Ask your conveyancer: Confirm the draft settlement statement once current notices arrive.',
        evidenceRefs: [],
        pages: [2]
      },
      {
        id: 'state-conveyancer-checks',
        heading: 'ACT conveyancer priority checks',
        content:
          'What this means: The tenancy details still need confirmation. Why it matters: This affects move-in timing and final handover planning. Ask your conveyancer: Request the lease, bond details, and notice history now.',
        evidenceRefs: [],
        pages: [3]
      }
    ];

    const viewModel = buildReportDecisionViewModel(detail);

    expect(viewModel.costsNarrative?.id).toBe('costs-cashflow');
    expect(viewModel.costsStateGuidance?.whyItMatters).toContain('cash you need on settlement day');
    expect(viewModel.questionsNarrative?.id).toBe('lawyer-questions');
    expect(viewModel.questionsStateGuidance?.askYourConveyancer).toContain('lease, bond details');
  });

  it('uses action-plan narrative steps ahead of generic fallbacks for next-step guidance', () => {
    const detail = buildBaseDetail();
    detail.narrativeSections = [
      {
        id: 'action-plan',
        heading: 'Your action plan before exchange and settlement',
        intro: 'Use this order to clear the biggest blockers first.',
        analysis: 'Start with finance protection, then close out the missing evidence.',
        buyerImpact: 'This reduces the chance of exchanging while the key unknowns are still open.',
        recommendedActions: [
          'Confirm unconditional finance approval in writing before exchange.',
          'Ask your conveyancer to request the missing deposited plan pages.'
        ]
      }
    ];

    const viewModel = buildReportDecisionViewModel(detail);

    expect(viewModel.actionPlanNarrative?.id).toBe('action-plan');
    expect(viewModel.nextStepsVisible[0]).toContain('Confirm unconditional finance approval');
    expect(viewModel.nextStepsVisible[1]).toContain('missing deposited plan pages');
    expect(viewModel.buyerPriorityVisible[0].impactLabel).toBe('Deposit risk');
  });

  it('groups property-condition findings into immediate and due-diligence buckets', () => {
    const detail = buildBaseDetail();
    detail.redFlags = [];
    detail.issues = [
      {
        id: 'issue-building',
        title: 'Moisture damage in laundry',
        detail: 'Moisture staining suggests a leak that should be checked before exchange.',
        severity: 'medium',
        pages: [9]
      }
    ];
    detail.checklist = [
      {
        id: 'building-check-1',
        requirement: 'Building report moisture follow-up',
        status: 'review',
        evidence: 'Building report',
        description: 'Manual inspection is recommended to confirm the extent of moisture damage.',
        pages: [9]
      }
    ];
    detail.strataInsights = [
      {
        id: 'strata-1',
        title: 'Waterproofing works noted',
        detail: 'Strata records refer to wet-area waterproofing works that need confirmation.',
        evidenceRefs: [],
        pages: [12]
      }
    ];

    const viewModel = buildReportDecisionViewModel(detail);

    expect(viewModel.propertyConditionSummary.tone).toBe('high');
    expect(viewModel.propertyConditionSections.costExposure[0].impactLabel).toBe('Repair cost');
    expect(viewModel.propertyConditionSections.unknowns.some((item) => item.category === 'inspection')).toBeTrue();
    expect(viewModel.propertyConditionGroups.immediate[0].title).toBe('Moisture damage in laundry');
    expect(viewModel.propertyConditionGroups.dueDiligence.some((item) => item.category === 'inspection')).toBeTrue();
    expect(viewModel.propertyConditionGroups.dueDiligence.some((item) => item.category === 'strata')).toBeTrue();
  });

  it('builds contract condition cards from unusual clauses and excludes title-only or state guidance items', () => {
    const detail = buildBaseDetail();
    detail.titleAndEncumbrances = [
      {
        id: 'title-1',
        title: 'Easement reference',
        detail: 'Standard title easement reference.',
        evidenceRefs: ['chunk:100'],
        pages: [1]
      }
    ];
    detail.unusualClauses = [
      {
        id: 'clause-1',
        title: 'Finance approval warranty',
        detail: 'Buyer warrants finance is arranged before relying on this contract.',
        evidenceRefs: ['chunk:901'],
        pages: [4]
      }
    ];
    detail.stateSpecificSections = [
      {
        id: 'disclosure-completeness',
        heading: 'ACT disclosure completeness',
        content: 'Missing annexure should be requested before exchange.',
        evidenceRefs: ['chunk:101'],
        pages: [1]
      }
    ];
    detail.citations = [
      {
        chunkId: 'chunk:901',
        pageNumber: 4,
        quoteSnippet: 'WARRANTY RE FINANCE APPROVAL'
      }
    ];

    const viewModel = buildReportDecisionViewModel(detail);

    expect(viewModel.contractConditionItems).toHaveSize(1);
    expect(viewModel.contractConditionItems[0].title).toBe('Finance approval warranty');
    expect(viewModel.contractConditionItems[0].clauseText).toContain('WARRANTY RE FINANCE APPROVAL');
    expect(viewModel.contractConditionItems[0].askConveyancer).toContain('finance or approval protection');
  });
});

function buildBaseDetail(): ReportDetail {
  return {
    id: 'job-1',
    title: 'Residential contract review',
    propertyAddress: '10 Example Street, Canberra ACT',
    stateOrTerritory: 'ACT',
    createdAt: '2026-02-25T10:00:00Z',
    updatedAt: '2026-02-25T10:10:00Z',
    status: 'ready',
    paymentStatus: 'Paid',
    pipelineStatus: 'Completed',
    percentComplete: 100,
    currentStep: 'Completed',
    currentSubStep: 'Ready',
    lastUpdatedUtc: '2026-02-25T10:10:00Z',
    buyerType: 'owner-occupier',
    buyerContext: {
      isFirstHomeBuyer: true,
      concessionIntent: 'yes',
      contractExchanged: false,
      agreedPriceAud: null,
      estimatedPriceAud: 900000
    },
    localGovernmentArea: 'Canberra',
    propertyTenureType: 'Leasehold',
    packType: 'standard',
    startedAt: '2026-02-25T10:01:00Z',
    completedAt: '2026-02-25T10:10:00Z',
    archivedAtUtc: null,
    errorMessage: null,
    reportS3Key: 'reports/job-1/report.pdf',
    disclaimerVersion: '2026-03-04',
    disclaimerAcceptedAtUtc: '2026-03-04T10:00:30Z',
    rawSummary: null,
    executiveSummary: 'Key issues need review before exchange.',
    propertySnapshot: {
      address: '40 Rochelle Street',
      suburb: 'Moncrieff',
      territory: 'ACT',
      buyerType: 'owner-occupier',
      propertyType: 'house'
    },
    jurisdictionProfile: {
      stateOrTerritory: 'ACT',
      displayName: 'Australian Capital Territory',
      stateNotices: []
    },
    issues: [
      {
        id: 'issue-1',
        title: 'No finance clause',
        detail: 'This creates funding risk once cooling-off expires.',
        severity: 'high',
        pages: [1]
      }
    ],
    checklist: [
      {
        id: 'check-1',
        requirement: 'Deposited plan',
        status: 'review',
        evidence: 'Image only',
        description: 'Manual review required for boundaries.',
        pages: [30]
      }
    ],
    titleAndEncumbrances: [],
    unusualClauses: [],
    missingInformation: [],
    planningHazards: [],
    financialItems: [],
    settlementAdjustments: [],
    investmentSnapshot: [],
    strataInsights: [],
    costsAndAdjustments: [],
    redFlags: [
      {
        id: 'red-1',
        title: 'No finance clause',
        detail: 'This creates funding risk once cooling-off expires.',
        severity: 'high',
        pages: [1]
      }
    ],
    narrativeSections: [],
    stateSpecificSections: [],
    recommendedActions: ['Confirm finance timeline with your conveyancer.'],
    lawyerQuestions: ['Can you confirm finance protections before exchange?'],
    plainEnglishGuide: [],
    legalDisclaimers: ['This report is informational only and not legal advice.'],
    contractFacts: [],
    financialModel: null,
    negotiationIntelligence: {
      summary: 'No strong negotiation indicators were identified.',
      levers: [],
      recommendedNextSteps: [],
      evidenceIndex: []
    },
    sourceAttribution: [],
    citations: [],
    validationWarnings: []
  };
}
