import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { ReportDetail } from '@shared-core/models/report.models';
import { ReportService } from '@shared-core/services/report.service';
import { ReportDetailPageComponent } from './report-detail-page.component';

class ReportServiceStub {
  watchReviewProgress() {
    return of(buildReportDetail());
  }

  getDownloadUrl() {
    return of('https://api.conveymate.test/download/report.pdf');
  }
}

describe('ReportDetailPageComponent', () => {
  let fixture: ComponentFixture<ReportDetailPageComponent>;
  let component: ReportDetailPageComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportDetailPageComponent],
      providers: [
        {
          provide: ReportService,
          useClass: ReportServiceStub
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'job-1' })
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ReportDetailPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders buyer-facing tabs and omits report metadata', () => {
    const host = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map((item) => item.textContent?.trim() ?? '');

    expect(tabs).toEqual([
      'Overview',
      'Risks & next steps',
      'Costs & compliance',
      'Property condition',
      'Negotiation',
      'Contract conditions',
      'Conveyancer questions'
    ]);
    expect(component.activeTab()).toBe('overview');
    expect(host.textContent).toContain('Overview');
    expect(host.textContent).not.toContain('Report metadata');
    expect(host.textContent).toContain('Needs manual check');
    expect(host.textContent).toContain('Talk to a conveyancer');
    expect(host.textContent).not.toContain('Quote workflow');
  });

  it('builds deduped priority risks with urgency labels', () => {
    const viewModel = component.viewModel();
    expect(viewModel).not.toBeNull();
    expect(viewModel!.priorityRiskCards.length).toBe(1);
    expect(viewModel!.priorityRiskCards[0].urgencyLabel).toBe('Review soon');
  });

  it('passes the report jurisdiction into the conveyancer directory link', () => {
    expect(component.conveyancerDirectoryQueryParams()).toEqual({ jurisdiction: 'ACT' });
  });

  it('switches tabs with click and keyboard navigation', () => {
    const host = fixture.nativeElement as HTMLElement;
    const overviewTab = host.querySelector('#report-detail-tab-overview') as HTMLButtonElement;
    const risksTab = host.querySelector('#report-detail-tab-risks') as HTMLButtonElement;

    overviewTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();

    expect(component.activeTab()).toBe('risks');
    expect(document.activeElement).toBe(risksTab);
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Before you exchange');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('What to send your conveyancer');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Can you exchange yet?');

    const propertyTab = host.querySelector('#report-detail-tab-property') as HTMLButtonElement;
    propertyTab.click();
    fixture.detectChanges();

    expect(component.activeTab()).toBe('property');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Could cost you after settlement');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('What still is not proven');

    const negotiationTab = host.querySelector('#report-detail-tab-negotiation') as HTMLButtonElement;
    negotiationTab.click();
    fixture.detectChanges();

    expect(component.activeTab()).toBe('negotiation');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Negotiation playbook');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).not.toContain('Questions for conveyancer');

    const contractTab = host.querySelector('#report-detail-tab-contract') as HTMLButtonElement;
    contractTab.click();
    fixture.detectChanges();

    expect(component.activeTab()).toBe('contract');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Contract conditions & special clauses');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Clause says:');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Ask your conveyancer:');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).not.toContain('ACT disclosure completeness');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).not.toContain('Questions for conveyancer');

    const questionsTab = host.querySelector('#report-detail-tab-questions') as HTMLButtonElement;
    questionsTab.click();
    fixture.detectChanges();

    expect(component.activeTab()).toBe('questions');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Questions for conveyancer');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Questions to send today');
  });
});

function buildReportDetail(): ReportDetail {
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
    executiveSummary: 'Review complete.',
    propertySnapshot: {
      address: '10 Example Street, Canberra ACT',
      suburb: 'Canberra',
      territory: 'ACT',
      buyerType: 'owner-occupier',
      propertyType: 'house'
    },
    jurisdictionProfile: {
      stateOrTerritory: 'ACT',
      displayName: 'Australian Capital Territory',
      stateNotices: ['ACT disclosure obligations should be verified before exchange.']
    },
    issues: [
      {
        id: 'risk-1',
        title: 'Finance condition requires confirmation',
        detail: 'No finance deadline was extracted from the contract particulars.',
        severity: 'medium',
        evidenceRefs: ['chunk:301'],
        pages: [1]
      }
    ],
    checklist: [
      {
        id: 'check-1',
        requirement: 'Rates notice',
        status: 'review',
        evidence: 'Not located in uploaded pack.',
        description: 'Ask your conveyancer to request this from the seller before exchange.',
        evidenceRefs: ['chunk:111'],
        pages: [2]
      }
    ],
    titleAndEncumbrances: [],
    unusualClauses: [
      {
        id: 'clause-1',
        title: 'Existing tenancy special condition',
        detail: 'The property is sold subject to an existing tenancy until the current lease ends.',
        clauseText: 'VACANT POSSESSION subject to existing tenancies',
        whatThisMeans: 'The contract appears to deal with whether you receive the property empty or with a tenant still in place.',
        whyItMatters: 'This affects when you can move in and what tenancy obligations pass to you at settlement.',
        askConveyancer: 'Can you confirm whether I get vacant possession at settlement and what tenancy obligations transfer to me?',
        evidenceRefs: ['chunk:401'],
        pages: [4]
      }
    ],
    missingInformation: [
      {
        id: 'missing-1',
        title: 'Current water notice',
        detail: 'Needed to confirm the final settlement adjustment.',
        evidenceRefs: ['chunk:501'],
        pages: []
      }
    ],
    planningHazards: [],
    financialItems: [
      {
        id: 'financial-1',
        title: 'Deposit',
        detail: 'A 10 per cent deposit is due within five business days.',
        evidenceRefs: ['chunk:601'],
        pages: [1]
      },
      {
        id: 'financial-2',
        title: 'Balance due on settlement',
        detail: 'The balance of the purchase price is payable on settlement.',
        evidenceRefs: ['chunk:602'],
        pages: [1]
      }
    ],
    settlementAdjustments: [
      {
        id: 'adjustment-1',
        title: 'Council rates',
        detail: 'Adjust on settlement using the latest notice.',
        evidenceRefs: ['chunk:701'],
        pages: [2]
      }
    ],
    investmentSnapshot: [],
    strataInsights: [
      {
        id: 'strata-1',
        title: 'Strata waterproofing follow-up',
        detail: 'The strata records mention waterproofing works that should be reviewed before relying on the condition of wet areas.',
        evidenceRefs: ['chunk:801'],
        pages: [7]
      }
    ],
    costsAndAdjustments: [],
    redFlags: [
      {
        id: 'risk-1-dup',
        title: 'Finance condition requires confirmation',
        detail: 'No finance deadline was extracted from the contract particulars.',
        severity: 'medium',
        evidenceRefs: ['chunk:301'],
        pages: [1]
      }
    ],
    narrativeSections: [
      {
        id: 'costs-cashflow',
        heading: 'Costs and settlement implications',
        intro: 'This tab shows what is already clear about your money due and what still needs confirmation before settlement.',
        analysis: 'The deposit timing is clear from the contract, but current notices are still needed to lock in the final adjustment figures.',
        buyerImpact: 'The headline price may be fixed, but missing notices can still change the cash you need on settlement day.',
        recommendedActions: ['Ask your conveyancer for an updated settlement statement once the latest notices arrive.']
      },
      {
        id: 'contract-risks',
        heading: 'Contract terms and risk commentary',
        intro: 'The contract includes conditions that need legal confirmation.',
        analysis: 'Finance and settlement deadlines should be reconciled across all clauses.',
        buyerImpact: 'Conflicting dates can increase default exposure.',
        recommendedActions: ['Ask your conveyancer for written deadline confirmation.']
      },
      {
        id: 'action-plan',
        heading: 'Your action plan before exchange and settlement',
        intro: 'Use this sequence to clear the highest-value issues before you commit.',
        analysis: 'Start with the deadline and notice gaps, then lock in any property-condition follow-up that could affect negotiation.',
        buyerImpact: 'Working in this order reduces the chance of exchanging while the most expensive unknowns are still open.',
        recommendedActions: [
          'Ask your conveyancer for written deadline confirmation.',
          'Request the missing rates and water notices before exchange.',
          'Review the strata waterproofing note with your conveyancer.'
        ]
      },
      {
        id: 'planning-hazards',
        heading: 'Planning and hazard context',
        intro: 'The condition material points to waterproofing follow-up rather than a confirmed major hazard, but it still needs review.',
        analysis: 'The uploaded material points to waterproofing records that could affect wet-area maintenance and future repair scope.',
        buyerImpact: 'If left unchecked, you could inherit repair work or maintenance risk that weakens your position after exchange.',
        recommendedActions: ['Ask whether the waterproofing note reflects completed works or an outstanding defect.']
      },
      {
        id: 'lawyer-questions',
        heading: 'Questions for your conveyancer',
        intro: 'Use these questions to get clear written answers before you commit.',
        analysis: 'The key open items are the tenancy condition, missing notices, and final settlement amounts.',
        buyerImpact: 'Clear answers help you avoid surprises on timing, occupation, and money due.',
        recommendedActions: ['Email this list to your conveyancer and ask for written responses.']
      }
    ],
    stateSpecificSections: [
      {
        id: 'disclosure-completeness',
        heading: 'ACT disclosure completeness',
        content: 'An annexure appears missing and should be requested before exchange.',
        evidenceRefs: ['chunk:101'],
        pages: [1]
      },
      {
        id: 'state-deadlines-and-money',
        heading: 'ACT key dates and money checks',
        content:
          'What this means: The deposit timing is clear, but final adjustments are not. Why it matters: Missing notices can change the cash you need on settlement day. Ask your conveyancer: Confirm the draft settlement statement once current notices arrive.',
        evidenceRefs: ['chunk:102'],
        pages: [2]
      },
      {
        id: 'state-conveyancer-checks',
        heading: 'ACT conveyancer priority checks',
        content:
          'What this means: The tenancy condition and current notices still need confirmation. Why it matters: These points affect move-in timing and final money due. Ask your conveyancer: Confirm the tenancy handover steps and request the latest notices now.',
        evidenceRefs: ['chunk:103'],
        pages: [2]
      }
    ],
    recommendedActions: ['Ask your conveyancer for written deadline confirmation.'],
    lawyerQuestions: ['Can you confirm all required ACT disclosure items are included?'],
    plainEnglishGuide: ['Cooling-off period is the short window where you may be able to exit under state rules.'],
    legalDisclaimers: ['This report is informational only and not legal advice.'],
    contractFacts: [{ id: 'settlement-date', label: 'Settlement date', value: '30 January 2023' }],
    financialModel: null,
    negotiationIntelligence: {
      summary: 'Two practical negotiation levers were identified from the uploaded reports.',
      levers: [
        {
          title: 'Request repair credit for roof defects',
          whyItMatters: 'The building report identifies roof defects likely to involve near-term cost.',
          howToUseInNegotiation: 'Ask for a price adjustment based on rectification scope and timing.',
          suggestedAsk: 'Seek a price adjustment or repair credit before exchange.',
          estimatedImpact: 'medium',
          confidence: 'high',
          evidence: [
            {
              source: 'Building report',
              locator: 'Page 17',
              quote: 'Roof defects were observed and require repair.',
              fileId: 'file-1'
            }
          ],
          risksOrTradeoffs: 'The seller may reject a large credit request and counter with no change.',
          category: 'buildingDefects'
        }
      ],
      recommendedNextSteps: [
        {
          title: 'Confirm negotiation position with conveyancer',
          detail: 'Ask your conveyancer to confirm whether a repair credit request is best made before exchange.',
          priority: 'now',
          owner: 'conveyancer',
          evidence: []
        }
      ],
      evidenceIndex: []
    },
    sourceAttribution: [
      {
        name: 'ACT Government',
        url: 'https://www.act.gov.au',
        note: 'Jurisdiction notice context.',
        sourceType: 'authority',
        retrievedOnUtc: '2026-02-24T00:05:00Z'
      }
    ],
    citations: [
      {
        chunkId: 'chunk:1001',
        pageNumber: 2,
        quoteSnippet: 'Rates notice not attached to disclosure documents.'
      }
    ],
    validationWarnings: ['Pages 30 to 40 are image-only and need manual review.']
  };
}
