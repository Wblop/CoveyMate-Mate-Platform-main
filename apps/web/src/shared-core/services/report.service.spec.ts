import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { ReportService } from './report.service';

describe('ReportService', () => {
  let service: ReportService;
  let httpMock: HttpTestingController;

  const metadataStub = {
    getValueAsync: async () => ({
      environment: 'Development',
      apiBaseUrl: 'https://api.conveymate.test',
      cacheTtlSeconds: 300,
      cognito: {
        region: 'ap-southeast-2',
        userPoolId: 'pool',
        appClientId: 'client',
        issuer: 'issuer',
        scopes: ['openid', 'email']
      },
      payments: {
        stripePublishableKey: 'pk_test_123',
        priceAudCents: 1999,
        currency: 'aud'
      }
    })
  } as Pick<MetadataConfigurationService, 'getValueAsync'>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: MetadataConfigurationService, useValue: metadataStub }]
    });

    service = TestBed.inject(ReportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('maps API review summaries to UI summaries', async () => {
    const resultPromise = firstValueFrom(service.getReports());
    await Promise.resolve();

    const request = httpMock.expectOne('https://api.conveymate.test/api/reviews');
    expect(request.request.method).toBe('GET');
    request.flush([
      {
        id: 'job-1',
        propertyAddress: '12 Example Street, Canberra ACT',
        buyerType: 'owner-occupier',
        status: 'Extracting',
        paymentStatus: 'Paid',
        createdAt: '2026-02-24T00:00:00Z',
        updatedAt: '2026-02-24T00:01:00Z',
        percentComplete: 35,
        currentStep: 'Extracting'
      }
    ]);

    const reports = await resultPromise;
    expect(reports).toHaveSize(1);
    expect(reports[0].status).toBe('processing');
    expect(reports[0].percentComplete).toBe(35);
    expect(reports[0].currentStep).toBe('Extracting');
  });

  it('maps AI-generated sections from report detail summary JSON', async () => {
    const resultPromise = firstValueFrom(service.getReportById('job-99'));
    await Promise.resolve();

    const request = httpMock.expectOne('https://api.conveymate.test/api/reviews/job-99');
    expect(request.request.method).toBe('GET');
    request.flush({
      id: 'job-99',
      propertyAddress: '50 Canberra Avenue, Kingston ACT',
      buyerType: 'owner-occupier',
      stateOrTerritory: 'ACT',
      status: 'Completed',
      paymentStatus: 'Paid',
      createdAt: '2026-02-24T00:00:00Z',
      updatedAt: '2026-02-24T00:10:00Z',
      percentComplete: 100,
      currentStep: 'Completed',
      currentSubStep: 'Done',
      lastUpdatedUtc: '2026-02-24T00:10:00Z',
      localGovernmentArea: 'Canberra',
      propertyTenureType: 'Leasehold',
      packType: 'standard',
      buyerContext: {
        isFirstHomeBuyer: true,
        concessionIntent: 'yes',
        contractExchanged: false,
        agreedPriceAud: null,
        estimatedPriceAud: 780000
      },
      startedAt: '2026-02-24T00:01:00Z',
      completedAt: '2026-02-24T00:10:00Z',
      errorMessage: null,
      reportS3Key: 'reports/job-99/report.pdf',
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-02-24T00:00:30Z',
      summary: {
        summary: 'The contract is mostly complete with targeted follow-up required.',
        propertySnapshot: {
          address: '50 Canberra Avenue, Kingston ACT',
          suburb: 'Kingston',
          territory: 'ACT',
          buyerType: 'owner-occupier',
          propertyType: 'unit'
        },
        jurisdictionProfile: {
          stateOrTerritory: 'ACT',
          displayName: 'Australian Capital Territory',
          stateNotices: ['ACT disclosure obligations apply before exchange.']
        },
        checklist: [
          {
            requirement: 'Rates notice',
            status: 'missing',
            evidence: 'Not located in uploaded pack.',
            description: 'Missing rates notice limits your ability to verify outstanding adjustments.',
            citationChunkIds: [1001],
            pages: [2]
          }
        ],
        titleAndEncumbrances: [
          {
            title: 'Volume and folio reference',
            description: 'Administrative title identifier only.',
            citationChunkIds: [2001],
            pages: [1]
          }
        ],
        unusualClauses: [
          {
            title: 'Finance approval warranty',
            description: 'Buyer warrants finance is arranged before relying on this contract.',
            clauseText: 'WARRANTY RE FINANCE APPROVAL',
            whatThisMeans: 'The contract appears to assume your funding is already sorted.',
            whyItMatters: 'A funding delay may still leave you exposed to default under the contract.',
            askConveyancer: 'Does this contract give me any finance protection if approval is delayed or withdrawn?',
            citationChunkIds: [2002],
            pages: [4]
          }
        ],
        recommendedActions: ['Ask the seller for the missing rates notice before exchange.'],
        lawyerQuestions: ['Can you confirm if any ACT disclosure annexures are missing?'],
        plainEnglishGuide: ['Cooling-off period means a short window to cancel after signing in some cases.'],
        legalDisclaimers: ['This report is informational only and not legal advice.'],
        validationWarnings: ['Pages 30 to 40 appear image-only and need manual review.'],
        contractFacts: {
          purchasePrice: '$780,000',
          settlementDate: '30 January 2023',
          specialConditions: ['Finance clause must be satisfied within 10 business days.']
        },
        sourceAttribution: [
          {
            sourceType: 'authority',
            name: 'ACT Government',
            url: 'https://www.act.gov.au',
            retrievedOnUtc: '2026-02-24T00:05:00Z',
            note: 'Jurisdiction notice context.'
          }
        ],
        citations: [
          {
            chunkId: 1001,
            pageNumber: 2,
            quoteSnippet: 'Rates notice not attached to disclosure documents.'
          }
        ],
        narrativeSections: [
          {
            sectionId: 'contract-risks',
            heading: 'Contract terms and risk commentary',
            intro: 'Several conditions require confirmation.',
            analysis: 'Finance and settlement date interactions should be checked.',
            buyerImpact: 'Misread deadlines may cause default exposure.',
            recommendedActions: ['Ask for written deadline confirmation.']
          }
        ],
        stateSpecificSections: [
          {
            sectionId: 'disclosure-completeness',
            heading: 'ACT disclosure completeness',
            content: 'One annexure is missing and should be requested before exchange.',
            citationChunkIds: [101, 102],
            pages: [1, 3]
          }
        ],
        negotiationIntelligence: {
          summary: 'Two practical levers were identified in the uploaded documents.',
          levers: [
            {
              title: 'Roof repair credit request',
              whyItMatters: 'Roof defects may create immediate repair costs.',
              howToUseInNegotiation: 'Ask for a price credit tied to repair scope before exchange.',
              suggestedAsk: 'Seek a repair credit.',
              estimatedImpact: 'medium',
              confidence: 'high',
              evidence: [
                {
                  source: 'Building report',
                  locator: 'Page 18',
                  quote: 'Defects observed to roof area.',
                  fileId: 'file-1'
                }
              ],
              risksOrTradeoffs: 'Seller may resist without independent quotes.',
              category: 'buildingDefects'
            }
          ],
          recommendedNextSteps: [
            {
              title: 'Confirm negotiation script',
              detail: 'Ask your conveyancer to confirm the proposed repair-credit wording.',
              priority: 'now',
              owner: 'conveyancer',
              evidence: []
            }
          ],
          evidenceIndex: []
        }
      }
    });

    const detail = await resultPromise;
    expect(detail.status).toBe('ready');
    expect(detail.narrativeSections).toHaveSize(1);
    expect(detail.narrativeSections[0].heading).toBe('Contract terms and risk commentary');
    expect(detail.narrativeSections[0].recommendedActions).toEqual(['Ask for written deadline confirmation.']);
    expect(detail.stateSpecificSections).toHaveSize(1);
    expect(detail.stateSpecificSections[0].heading).toBe('ACT disclosure completeness');
    expect(detail.stateSpecificSections[0].evidenceRefs).toEqual(['chunk:101', 'chunk:102']);
    expect(detail.stateSpecificSections[0].pages).toEqual([1, 3]);
    expect(detail.propertySnapshot?.suburb).toBe('Kingston');
    expect(detail.jurisdictionProfile?.displayName).toBe('Australian Capital Territory');
    expect(detail.buyerContext).toEqual({
      isFirstHomeBuyer: true,
      concessionIntent: 'yes',
      contractExchanged: false,
      agreedPriceAud: null,
      estimatedPriceAud: 780000
    });
    expect(detail.issues).toEqual([]);
    expect(detail.titleAndEncumbrances).toHaveSize(1);
    expect(detail.unusualClauses[0].clauseText).toBe('WARRANTY RE FINANCE APPROVAL');
    expect(detail.unusualClauses[0].askConveyancer).toContain('finance protection');
    expect(detail.checklist[0].description).toContain('Missing rates notice');
    expect(detail.recommendedActions).toEqual(['Ask the seller for the missing rates notice before exchange.']);
    expect(detail.lawyerQuestions).toEqual(['Can you confirm if any ACT disclosure annexures are missing?']);
    expect(detail.plainEnglishGuide[0]).toContain('Cooling-off period');
    expect(detail.legalDisclaimers[0]).toContain('not legal advice');
    expect(detail.validationWarnings[0]).toContain('image-only');
    expect(detail.contractFacts.map((item) => item.label)).toContain('Purchase price');
    expect(detail.negotiationIntelligence.levers).toHaveSize(1);
    expect(detail.negotiationIntelligence.levers[0].title).toBe('Roof repair credit request');
    expect(detail.sourceAttribution[0].retrievedOnUtc).toBe('2026-02-24T00:05:00Z');
    expect(detail.citations[0].chunkId).toBe('chunk:1001');
  });

  it('returns a deterministic negotiation fallback when section is missing', async () => {
    const resultPromise = firstValueFrom(service.getReportById('job-neg-fallback'));
    await Promise.resolve();

    const request = httpMock.expectOne('https://api.conveymate.test/api/reviews/job-neg-fallback');
    expect(request.request.method).toBe('GET');
    request.flush({
      id: 'job-neg-fallback',
      propertyAddress: '1 Example Street, Canberra ACT',
      buyerType: 'owner-occupier',
      stateOrTerritory: 'ACT',
      status: 'Completed',
      paymentStatus: 'Paid',
      createdAt: '2026-02-24T00:00:00Z',
      updatedAt: '2026-02-24T00:10:00Z',
      percentComplete: 100,
      currentStep: 'Completed',
      currentSubStep: 'Done',
      lastUpdatedUtc: '2026-02-24T00:10:00Z',
      localGovernmentArea: 'Canberra',
      propertyTenureType: 'Leasehold',
      packType: 'standard',
      startedAt: '2026-02-24T00:01:00Z',
      completedAt: '2026-02-24T00:10:00Z',
      errorMessage: null,
      reportS3Key: 'reports/job-neg-fallback/report.pdf',
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-02-24T00:00:30Z',
      summary: {
        summary: 'Summary without negotiation section.'
      }
    });

    const detail = await resultPromise;
    expect(detail.negotiationIntelligence.levers).toEqual([]);
    expect(detail.negotiationIntelligence.summary).toContain('No strong negotiation indicators were identified');
    expect(detail.negotiationIntelligence.recommendedNextSteps.length).toBeGreaterThan(0);
  });

  it('creates a review job with file metadata', async () => {
    const file = new File(['contract'], 'contract.pdf', { type: 'application/pdf' });

    const resultPromise = firstValueFrom(
      service.createReviewJob(
        {
          propertyAddress: '15 Test Road, Barton ACT',
          buyerType: 'owner-occupier',
          stateOrTerritory: 'ACT',
          buyerContext: {
            isFirstHomeBuyer: true,
            concessionIntent: 'yes',
            contractExchanged: false,
            agreedPriceAud: null,
            estimatedPriceAud: 825000
          },
          acceptedDisclaimer: true
        },
        [file]
      )
    );
    await Promise.resolve();

    const request = httpMock.expectOne('https://api.conveymate.test/api/reviews');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.files[0].fileName).toBe('contract.pdf');
    expect(request.request.body.stateOrTerritory).toBe('ACT');
    expect(request.request.body.buyerContext).toEqual({
      isFirstHomeBuyer: true,
      concessionIntent: 'yes',
      contractExchanged: false,
      agreedPriceAud: null,
      estimatedPriceAud: 825000
    });
    request.flush({
      jobId: 'job-2',
      status: 'AwaitingUpload',
      paymentStatus: 'Unpaid',
      uploads: [
        {
          documentId: 'doc-1',
          fileName: 'contract.pdf',
          contentType: 'application/pdf',
          s3KeyRaw: 'raw/user/job/doc-1-contract.pdf',
          uploadUrl: 'https://example.test/upload',
          expiresAtUtc: '2026-02-24T01:00:00Z'
        }
      ]
    });

    const result = await resultPromise;
    expect(result.jobId).toBe('job-2');
    expect(result.uploads).toHaveSize(1);
  });

  it('maps blank financial model payloads to null so UI hides the model card', async () => {
    const resultPromise = firstValueFrom(service.getReportById('job-fin-empty'));
    await Promise.resolve();

    const request = httpMock.expectOne('https://api.conveymate.test/api/reviews/job-fin-empty');
    expect(request.request.method).toBe('GET');
    request.flush({
      id: 'job-fin-empty',
      propertyAddress: '2 Example Street, Canberra ACT',
      buyerType: 'owner-occupier',
      stateOrTerritory: 'ACT',
      status: 'Completed',
      paymentStatus: 'Paid',
      createdAt: '2026-02-24T00:00:00Z',
      updatedAt: '2026-02-24T00:10:00Z',
      percentComplete: 100,
      currentStep: 'Completed',
      currentSubStep: 'Done',
      lastUpdatedUtc: '2026-02-24T00:10:00Z',
      localGovernmentArea: 'Canberra',
      propertyTenureType: 'Leasehold',
      packType: 'standard',
      startedAt: '2026-02-24T00:01:00Z',
      completedAt: '2026-02-24T00:10:00Z',
      errorMessage: null,
      reportS3Key: 'reports/job-fin-empty/report.pdf',
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-02-24T00:00:30Z',
      summary: {
        summary: 'Summary',
        financialModel: {
          stampDutyEstimate: 'Unavailable',
          cashToSettleBand: 'Unavailable',
          assumptions: []
        }
      }
    });

    const detail = await resultPromise;
    expect(detail.financialModel).toBeNull();
  });

  it('loads enabled states configuration for jurisdiction selector', async () => {
    const resultPromise = firstValueFrom(service.getEnabledStatesConfiguration());
    await Promise.resolve();

    const request = httpMock.expectOne('https://api.conveymate.test/api/config/enabled-states');
    expect(request.request.method).toBe('GET');
    request.flush({
      defaultState: 'ACT',
      supportedStates: ['ACT', 'NSW', 'VIC'],
      enabledStates: ['ACT']
    });

    const result = await resultPromise;
    expect(result.defaultState).toBe('ACT');
    expect(result.enabledStates).toEqual(['ACT']);
    expect(result.supportedStates).toEqual(['ACT', 'NSW', 'VIC']);
  });

  it('loads the backend pipeline model for source-of-truth stage rendering', async () => {
    const resultPromise = firstValueFrom(service.getPipelineModel());
    await Promise.resolve();

    const request = httpMock.expectOne('https://api.conveymate.test/api/reviews/pipeline-model');
    expect(request.request.method).toBe('GET');
    request.flush({
      steps: [
        {
          id: 'AwaitingPayment',
          label: 'Payment',
          description: 'Secure payment is confirmed before processing starts.',
          phase: 'setup',
          order: 1,
          progressStartPercent: 15,
          progressEndPercent: 19
        },
        {
          id: 'AwaitingUpload',
          label: 'Upload',
          description: 'Documents are uploaded and prepared for processing.',
          phase: 'setup',
          order: 0,
          progressStartPercent: 0,
          progressEndPercent: 14
        }
      ],
      typicalDurationMinutes: 7,
      disclaimerVersion: '2026-03-04'
    });

    const result = await resultPromise;
    expect(result.steps).toHaveSize(2);
    expect(result.steps[0].id).toBe('AwaitingUpload');
    expect(result.disclaimerVersion).toBe('2026-03-04');
  });
});
