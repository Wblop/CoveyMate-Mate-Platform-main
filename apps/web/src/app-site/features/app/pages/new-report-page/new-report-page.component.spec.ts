import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { MetadataConfigurationService } from '@shared-core/config/metadata-configuration.service';
import { MetadataConfiguration } from '@shared-core/config/metadata-configuration.models';
import { ProcessingStage, ReportDetail } from '@shared-core/models/report.models';
import { AddressAutocompleteService } from '@shared-core/services/address-autocomplete.service';
import { EnabledStatesConfiguration, ReportService } from '@shared-core/services/report.service';
import { UploadService } from '@shared-core/services/upload.service';
import { NewReportPageComponent } from './new-report-page.component';

class ReportServiceStub {
  static resumeDetail: ReportDetail | null = null;

  getEnabledStatesConfiguration() {
    const configuration: EnabledStatesConfiguration = {
      defaultState: 'ACT',
      supportedStates: ['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT'],
      enabledStates: ['ACT']
    };
    return of(configuration);
  }

  getPipelineModel() {
    return of({
      steps: [
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
  }

  getReportById() {
    if (!ReportServiceStub.resumeDetail) {
      return throwError(() => new Error('Draft was not configured for this test.'));
    }

    return of(ReportServiceStub.resumeDetail);
  }

  watchReviewProgress() {
    if (!ReportServiceStub.resumeDetail) {
      return throwError(() => new Error('Report was not configured for this test.'));
    }

    return new Observable<ReportDetail>((subscriber) => {
      subscriber.next(ReportServiceStub.resumeDetail as ReportDetail);
      return () => void 0;
    });
  }

  getReviewProgressEvents() {
    return of([]);
  }
}

class UploadServiceStub {
  getUploads() {
    return of([]);
  }

  getQueuedFilesSnapshot() {
    return [];
  }

  clearAll = jasmine.createSpy('clearAll');
}

class MetadataConfigurationServiceStub {
  private readonly value: MetadataConfiguration = {
    environment: 'local',
    apiBaseUrl: 'http://localhost:5141',
    cacheTtlSeconds: 300,
    cognito: {
      region: 'ap-southeast-2',
      userPoolId: 'pool',
      appClientId: 'client',
      issuer: 'issuer',
      scopes: ['openid']
    },
    payments: {
      stripePublishableKey: 'pk_test_stub',
      priceAudCents: 1999,
      currency: 'aud'
    }
  };

  tryGetValue() {
    return this.value;
  }

  getValueAsync() {
    return Promise.resolve(this.value);
  }
}

class AddressAutocompleteServiceStub {
  searchAustralianAddresses(query: string, _stateOrTerritory = '') {
    const trimmed = query.trim();
    if (!trimmed) {
      return of([]);
    }

    return of([
      {
        id: 'address-1',
        label: `${trimmed} Street, Sydney, NSW 2000`,
        stateOrTerritory: 'NSW'
      }
    ]);
  }
}

describe('NewReportPageComponent', () => {
  let fixture: ComponentFixture<NewReportPageComponent>;
  let component: NewReportPageComponent;
  const routeStub = {
    snapshot: {
      queryParamMap: convertToParamMap({})
    }
  };

  beforeEach(async () => {
    ReportServiceStub.resumeDetail = null;
    routeStub.snapshot.queryParamMap = convertToParamMap({});

    await TestBed.configureTestingModule({
      imports: [NewReportPageComponent],
      providers: [
        {
          provide: ReportService,
          useClass: ReportServiceStub
        },
        {
          provide: UploadService,
          useClass: UploadServiceStub
        },
        {
          provide: MetadataConfigurationService,
          useClass: MetadataConfigurationServiceStub
        },
        {
          provide: AddressAutocompleteService,
          useClass: AddressAutocompleteServiceStub
        },
        {
          provide: ActivatedRoute,
          useValue: routeStub
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(NewReportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows unavailable jurisdictions as coming soon labels', () => {
    component.enabledStates.set(['ACT']);

    expect(component.toStateLabel('NSW')).toContain('Coming soon');
    expect(component.toStateLabel('ACT')).toBe('ACT');
  });

  it('clears stale uploads when opened without a resume query', () => {
    const uploadService = TestBed.inject(UploadService) as unknown as UploadServiceStub;
    expect(uploadService.clearAll).toHaveBeenCalled();
  });

  it('removes the fee note from the wizard panel header', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.wizard-price-note')).toBeNull();
  });

  it('opens payment modal only when payment setup is ready', () => {
    component.awaitingPaymentConfirmation.set(true);
    component.paymentFormReady.set(true);
    component.paymentSessionPreparing.set(true);
    expect(component.canOpenPaymentModal()).toBeFalse();

    component.paymentSessionPreparing.set(false);
    expect(component.canOpenPaymentModal()).toBeTrue();
  });

  it('blocks submit and process when disclaimer is not accepted', () => {
    component.currentStep.set(2);
    component.uploadsPrepared.set(true);
    component.createdReportId.set('job-1');
    component.acceptedDisclaimer = false;

    component.submitAndProcess();

    expect(component.wizardError()).toContain('must accept the disclaimer');
    expect(component.currentStep()).toBe(2);
  });

  it('renders a simple review screen before payment', () => {
    component.currentStep.set(2);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.review-summary-strip')).toBeTruthy();
    expect(host.querySelector('.review-list')).toBeTruthy();
    expect(host.querySelector('.review-step-grid')).toBeNull();
    expect(host.textContent || '').not.toContain('Everything is lined up');
  });

  it('blocks Step 1 progression when first-home and exchanged fields are unset', () => {
    component.currentStep.set(0);
    component.propertyAddress = '12 Example Street, Canberra ACT';
    component.stateConfigLoading.set(false);
    component.enabledStates.set(['ACT']);
    component.stateOrTerritory = 'ACT';
    component.isFirstHomeBuyer = null;
    component.contractExchanged = null;

    component.goNext();

    expect(component.currentStep()).toBe(0);
    expect(component.stepErrors().isFirstHomeBuyer).toContain('first home buyer');
    expect(component.stepErrors().contractExchanged).toContain('contract has exchanged');
  });

  it('requires agreed price when contractExchanged is true', () => {
    component.currentStep.set(0);
    component.propertyAddress = '12 Example Street, Canberra ACT';
    component.stateConfigLoading.set(false);
    component.enabledStates.set(['ACT']);
    component.stateOrTerritory = 'ACT';
    component.isFirstHomeBuyer = true;
    component.contractExchanged = true;
    component.agreedPriceAud = null;

    component.goNext();

    expect(component.currentStep()).toBe(0);
    expect(component.stepErrors().agreedPriceAud).toContain('greater than zero');
    expect(component.canProceedCurrentStep()).toBeFalse();
  });

  it('allows exchanged=false with optional estimate and validates estimate when supplied', () => {
    component.currentStep.set(0);
    component.propertyAddress = '12 Example Street, Canberra ACT';
    component.addressManualEntry.set(true);
    component.stateConfigLoading.set(false);
    component.enabledStates.set(['ACT']);
    component.stateOrTerritory = 'ACT';
    component.isFirstHomeBuyer = false;
    component.contractExchanged = false;
    component.estimatedPriceAud = null;

    expect(component.canProceedCurrentStep()).toBeTrue();

    component.onEstimatedPriceChanged(0);
    expect(component.canProceedCurrentStep()).toBeFalse();

    component.onEstimatedPriceChanged(875000);
    expect(component.canProceedCurrentStep()).toBeTrue();
  });

  it('warns when the selected address state does not match the chosen jurisdiction', () => {
    component.currentStep.set(0);
    component.stateConfigLoading.set(false);
    component.enabledStates.set(['ACT', 'NSW']);
    component.stateOrTerritory = 'ACT';
    component.isFirstHomeBuyer = true;
    component.contractExchanged = false;

    component.applyAddressSuggestion({
      id: 'address-nsw',
      label: '12 George Street, Sydney, NSW 2000',
      stateOrTerritory: 'NSW'
    });

    expect(component.stepErrors().stateOrTerritory).toContain('looks like NSW');
    expect(component.canProceedCurrentStep()).toBeFalse();
  });

  it('warns when a manually entered address includes Australia after the postcode', () => {
    component.currentStep.set(0);
    component.stateConfigLoading.set(false);
    component.enabledStates.set(['ACT', 'NSW']);
    component.stateOrTerritory = 'NSW';
    component.isFirstHomeBuyer = true;
    component.contractExchanged = false;
    component.addressManualEntry.set(true);

    component.onPropertyAddressChanged('13 McVilly Close, Gordon, ACT 2906, Australia');

    expect(component.stepErrors().stateOrTerritory).toContain('looks like ACT');
    expect(component.canProceedCurrentStep()).toBeFalse();
  });

  it('shows state configuration skeleton while loading', () => {
    component.currentStep.set(0);
    component.stateConfigLoading.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.inline-skeleton')).toBeTruthy();
  });

  it('renders address suggestions while the user types', fakeAsync(() => {
    component.onPropertyAddressChanged('12 George');
    tick(400);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const suggestions = Array.from(host.querySelectorAll('.address-suggestion-button'));
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].textContent || '').toContain('12 George');
  }));

  it('applies an address suggestion when selected', fakeAsync(() => {
    component.onPropertyAddressChanged('45 Queen');
    tick(400);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const suggestion = host.querySelector('.address-suggestion-button') as HTMLButtonElement | null;
    expect(suggestion).withContext('Expected a rendered address suggestion').not.toBeNull();

    suggestion?.click();
    fixture.detectChanges();

    expect(component.propertyAddress).toContain('45 Queen');
    expect(component.addressSuggestions()).toEqual([]);
  }));

  it('shows a friendly label for queued uploads', () => {
    expect(component.uploadStatusLabel('queued')).toBe('Ready to be uploaded');
  });

  it('shows a payment preview instead of live pipeline details while awaiting payment', () => {
    component.currentStep.set(3);
    component.awaitingPaymentConfirmation.set(true);
    component.paymentFormReady.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.payment-launcher')).toBeTruthy();
    expect(host.textContent || '').toContain('Secure checkout is ready.');
    expect(host.querySelectorAll('.payment-launcher-actions ui-button').length).toBe(1);
    expect(host.querySelector('.pipeline-preview-shell')).toBeTruthy();
    expect(host.querySelector('.pipeline-live-shell')).toBeNull();
  });

  it('renders a simplified live pipeline workspace while processing', () => {
    component.currentStep.set(3);
    component.awaitingPaymentConfirmation.set(false);
    component.processingActive.set(true);
    component.processingComplete.set(false);
    component.createdReportId.set('job-12345');
    component.pipelineStatusValue.set('Analyzing');
    component.pipelineCurrentStepValue.set('Analyzing');
    component.pipelineStartedAtUtc.set('2026-03-08T00:00:00Z');
    component.nowTickMs.set(new Date('2026-03-08T00:01:05Z').getTime());
    component.processingPercent.set(62);
    component.activityEvents.set([
      {
        id: 'evt-1',
        timestampUtc: '2026-03-08T00:01:00Z',
        stageId: 'Analyzing',
        stageState: 'running',
        severity: 'info',
        message: 'AI review is cross-checking extracted clauses.'
      }
    ] as any);
    component.processingStages.set([
      {
        id: 'Extracting',
        label: 'Extract contract',
        description: 'Pulling structured data from the uploaded contract pack.',
        phase: 'analysis',
        progressStartPercent: 15,
        progressEndPercent: 45,
        state: 'complete'
      },
      {
        id: 'Analyzing',
        label: 'AI review',
        description: 'Assessing risk, clauses, and inconsistencies across the file set.',
        phase: 'analysis',
        progressStartPercent: 46,
        progressEndPercent: 82,
        state: 'running'
      },
      {
        id: 'Rendering',
        label: 'Render report',
        description: 'Assembling the final report output for delivery.',
        phase: 'delivery',
        progressStartPercent: 83,
        progressEndPercent: 100,
        state: 'queued'
      }
    ] satisfies ProcessingStage[]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.wizard-panel')?.classList.contains('wizard-panel--live-pipeline')).toBeTrue();
    expect(host.querySelector('.pipeline-live-grid')).toBeTruthy();
    expect(host.querySelector('.pipeline-summary-strip')).toBeTruthy();
    expect(host.querySelector('.pipeline-monitor-panel')).toBeTruthy();
    expect(host.querySelector('.running-step-badge.is-live')).toBeNull();
    expect(host.querySelector('.pipeline-meta-strip')).toBeNull();
    expect(host.querySelector('.activity-panel')).toBeNull();
    expect(host.textContent || '').toContain('Recent activity');
    expect(host.textContent || '').toContain('AI review is cross-checking extracted clauses.');
    expect(host.textContent || '').toContain('Elapsed');
    expect(host.textContent || '').toContain('1m 05s');
    expect(host.querySelector('.pipeline-stat-grid')).toBeNull();
    expect(host.querySelector('.pipeline-stage-context')).toBeNull();
  });

  it('shows the latest three activity items in the stage monitor summary', () => {
    component.currentStep.set(3);
    component.awaitingPaymentConfirmation.set(false);
    component.processingActive.set(true);
    component.processingComplete.set(false);
    component.createdReportId.set('job-12345');
    component.pipelineStatusValue.set('Analyzing');
    component.pipelineCurrentStepValue.set('Analyzing');
    component.processingPercent.set(62);
    component.activityEvents.set([
      {
        id: 'evt-1',
        timestampUtc: '2026-03-08T00:00:00Z',
        stageId: 'Analyzing',
        stageState: 'running',
        severity: 'info',
        message: 'Started: Analyzing'
      },
      {
        id: 'evt-2',
        timestampUtc: '2026-03-08T00:00:10Z',
        stageId: 'Analyzing',
        stageState: 'running',
        severity: 'info',
        message: 'Analyzing: Primary analysis complete. Running specialist checks.'
      },
      {
        id: 'evt-3',
        timestampUtc: '2026-03-08T00:00:20Z',
        stageId: 'Analyzing',
        stageState: 'running',
        severity: 'info',
        message: 'Analyzing: Running 3 specialist checks in parallel.'
      },
      {
        id: 'evt-4',
        timestampUtc: '2026-03-08T00:00:30Z',
        stageId: 'Analyzing',
        stageState: 'running',
        severity: 'info',
        message: 'Analyzing: Specialist check complete: contract risk review.'
      }
    ] as any);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const items = Array.from(host.querySelectorAll('.pipeline-monitor-item')).map((item) => item.textContent || '');
    expect(items.length).toBe(3);
    expect(items[0]).toContain('Specialist check complete: contract risk review.');
    expect(items[1]).toContain('Running 3 specialist checks in parallel.');
    expect(items[2]).toContain('Primary analysis complete. Running specialist checks.');
    expect(host.textContent || '').not.toContain('Started: Analyzing');
  });

  it('shows the processing-complete banner and open-report action above the pipeline shell', () => {
    component.currentStep.set(3);
    component.awaitingPaymentConfirmation.set(false);
    component.processingActive.set(false);
    component.processingComplete.set(true);
    component.createdReportId.set('report-123');
    component.pipelineStatusValue.set('Completed');
    component.pipelineCurrentStepValue.set('Completed');
    component.pipelineStepLabel.set('Completed');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const completionPanel = host.querySelector('.running-step-complete-actions');
    const pipelineShell = host.querySelector('.pipeline-live-shell');

    expect(completionPanel).toBeTruthy();
    expect(pipelineShell).toBeTruthy();
    const documentPosition = (completionPanel as Element).compareDocumentPosition(pipelineShell as Node);
    expect(documentPosition & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(host.querySelector('.final-actions')).toBeNull();
    expect(host.textContent || '').toContain('Open your finished report');
    expect(host.textContent || '').toContain('Open report');
    expect(host.textContent || '').toContain('PDF download available');
  });

  it('shows checkout recovery only when payment setup is not ready', () => {
    component.currentStep.set(3);
    component.awaitingPaymentConfirmation.set(true);
    component.paymentFormReady.set(false);
    component.paymentSessionPreparing.set(false);
    component.paymentError.set('Stripe could not be initialised.');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.payment-launcher-status')).toBeNull();
    expect(host.textContent || '').toContain('Restore secure checkout');
    expect(host.textContent || '').not.toContain('Open secure checkout');
  });

  it('renders a structured payment checkout modal with order summary and secure framing', () => {
    component.currentStep.set(3);
    component.awaitingPaymentConfirmation.set(true);
    component.paymentModalOpen.set(true);
    component.paymentFormReady.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.payment-modal-backdrop')).toBeTruthy();
    expect(host.querySelector('.payment-summary-panel')).toBeTruthy();
    expect(host.querySelector('.payment-summary-illustration')).toBeTruthy();
    expect(host.querySelector('.payment-summary-meta')).toBeTruthy();
    expect(host.querySelector('.payment-provider-chip')?.textContent || '').toContain('Stripe');
    expect(host.querySelector('.payment-checkout-panel')).toBeTruthy();
    expect(host.querySelector('.payment-assurance-list')).toBeTruthy();
  });

  it('does not dismiss payment checkout when the backdrop is pressed', () => {
    component.currentStep.set(3);
    component.awaitingPaymentConfirmation.set(true);
    component.paymentModalOpen.set(true);
    component.paymentFormReady.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const backdrop = host.querySelector('.payment-modal-backdrop') as HTMLDivElement | null;
    expect(backdrop).withContext('Expected rendered payment modal backdrop').not.toBeNull();

    backdrop?.click();
    fixture.detectChanges();

    expect(component.paymentModalOpen()).toBeTrue();
  });

  it('supports manual entry override when suggestions are not suitable', fakeAsync(() => {
    const addressService = TestBed.inject(AddressAutocompleteService);
    const lookupSpy = spyOn(addressService, 'searchAustralianAddresses').and.callThrough();

    component.onPropertyAddressChanged('13 McVilly');
    tick(400);
    fixture.detectChanges();

    let host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.address-suggestion-button').length).toBe(1);

    const toggleButton = host.querySelector('.address-manual-button') as HTMLButtonElement | null;
    expect(toggleButton).withContext('Expected manual entry toggle button').not.toBeNull();
    toggleButton?.click();
    fixture.detectChanges();

    component.onPropertyAddressChanged('13 McVilly Close Gordon ACT 2906');
    tick(400);
    fixture.detectChanges();

    host = fixture.nativeElement as HTMLElement;
    expect(component.addressManualEntry()).toBeTrue();
    expect(host.querySelectorAll('.address-suggestion-button').length).toBe(0);
    expect(host.querySelector('.address-manual-hint')).toBeTruthy();
    expect(lookupSpy.calls.count()).toBe(1);
  }));

  it('opens and closes the Step 2 upload help modal', () => {
    component.currentStep.set(1);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const openButton = host.querySelector('.upload-help-trigger') as HTMLButtonElement | null;
    expect(openButton).withContext('Expected Need help trigger on Step 2').not.toBeNull();

    openButton?.click();
    fixture.detectChanges();

    expect(component.uploadHelpModalOpen()).toBeTrue();
    expect(host.querySelector('.upload-help-modal')).toBeTruthy();

    const closeButton = host.querySelector('.upload-help-close') as HTMLButtonElement | null;
    expect(closeButton).withContext('Expected modal close button').not.toBeNull();
    closeButton?.click();
    fixture.detectChanges();

    expect(component.uploadHelpModalOpen()).toBeFalse();
    expect(host.querySelector('.upload-help-modal')).toBeNull();
  });

  it('closes the upload help modal when Escape is pressed', () => {
    component.currentStep.set(1);
    component.openUploadHelpModal();
    fixture.detectChanges();
    expect(component.uploadHelpModalOpen()).toBeTrue();

    component.onUploadHelpModalKeydown(
      new KeyboardEvent('keydown', {
        key: 'Escape'
      })
    );
    fixture.detectChanges();

    expect(component.uploadHelpModalOpen()).toBeFalse();
  });

  it('hides raw technical details from the failure summary and progress headline', () => {
    component.currentStep.set(3);
    component.pipelineStatusValue.set('Failed');
    component.pipelineCurrentStepValue.set('Failed');
    component.pipelineStepLabel.set('Failed');
    component.pipelineSubStep.set('Citation page mismatch for chunk 7709');
    component.processingPercent.set(72);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const summary = host.querySelector('.pipeline-failure-message')?.textContent || '';
    expect(summary).toContain('Please don’t panic');
    expect(summary).not.toContain('Citation page mismatch');
    expect(summary).not.toContain('during Failed');
    expect(host.querySelector('.progress-inline-detail')).toBeNull();
  });

  it('opens the failed-job dialog with the apology and investigation copy', () => {
    component.currentStep.set(3);

    (component as any).updatePipelineFromDetail({
      id: 'report-failed',
      status: 'failed',
      pipelineStatus: 'Failed',
      currentStep: 'Failed',
      currentSubStep: 'Citation page mismatch for chunk 7709',
      errorMessage: 'Citation page mismatch for chunk 7709',
      percentComplete: 46,
      lastUpdatedUtc: '2026-02-26T12:01:00Z',
      updatedAt: '2026-02-26T12:01:00Z',
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-02-26T11:59:00Z'
    } as unknown as ReportDetail);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(component.failedJobDialogOpen()).toBeTrue();
    expect(host.querySelector('.failure-modal')).toBeTruthy();
    expect(host.textContent || '').toContain('Please don’t panic');
    expect(host.textContent || '').toContain('A ConveyMate engineer has already been notified');
    expect(host.textContent || '').toContain('issue a refund as appropriate');
  });

  it('keeps the failed stage on the last known pipeline stage instead of resetting to upload', () => {
    component.pipelineModel.set({
      steps: [
        {
          id: 'AwaitingUpload',
          label: 'Upload',
          description: 'Documents are uploaded.',
          phase: 'setup',
          order: 0,
          progressStartPercent: 0,
          progressEndPercent: 14
        },
        {
          id: 'Extracting',
          label: 'Extracting',
          description: 'Extracting text.',
          phase: 'analysis',
          order: 1,
          progressStartPercent: 15,
          progressEndPercent: 34
        },
        {
          id: 'Indexing',
          label: 'Indexing',
          description: 'Building retrieval index.',
          phase: 'analysis',
          order: 2,
          progressStartPercent: 35,
          progressEndPercent: 59
        },
        {
          id: 'Analyzing',
          label: 'Analyzing',
          description: 'Running analysis.',
          phase: 'analysis',
          order: 3,
          progressStartPercent: 60,
          progressEndPercent: 84
        },
        {
          id: 'Completed',
          label: 'Completed',
          description: 'Done.',
          phase: 'delivery',
          order: 4,
          progressStartPercent: 100,
          progressEndPercent: 100
        }
      ],
      typicalDurationMinutes: 7,
      disclaimerVersion: '2026-03-04'
    });

    (component as any).updatePipelineFromDetail({
      id: 'report-1',
      status: 'processing',
      pipelineStatus: 'Indexing',
      currentStep: 'Indexing',
      currentSubStep: 'Chunking and indexing documents.',
      percentComplete: 46,
      lastUpdatedUtc: '2026-02-26T12:00:00Z',
      updatedAt: '2026-02-26T12:00:00Z',
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-02-26T11:59:00Z'
    } as unknown as ReportDetail);

    (component as any).updatePipelineFromDetail({
      id: 'report-1',
      status: 'failed',
      pipelineStatus: 'Failed',
      currentStep: 'Failed',
      currentSubStep: 'Citation page mismatch for chunk 7709',
      errorMessage: 'Citation page mismatch for chunk 7709',
      percentComplete: 46,
      lastUpdatedUtc: '2026-02-26T12:01:00Z',
      updatedAt: '2026-02-26T12:01:00Z',
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-02-26T11:59:00Z'
    } as unknown as ReportDetail);

    const failedStage = component.processingStages().find((stage) => stage.state === 'failed');
    expect(failedStage?.id).toBe('Indexing');
    expect(component.pipelineStepLabel()).toBe('Indexing');
  });

  it('uses currentStep to resolve active stage when pipelineStatus temporarily jumps ahead', () => {
    component.pipelineModel.set({
      steps: [
        {
          id: 'AwaitingUpload',
          label: 'Upload',
          description: 'Documents are uploaded.',
          phase: 'setup',
          order: 0,
          progressStartPercent: 0,
          progressEndPercent: 14
        },
        {
          id: 'Analyzing',
          label: 'Analyzing',
          description: 'Running analysis.',
          phase: 'analysis',
          order: 1,
          progressStartPercent: 60,
          progressEndPercent: 85
        },
        {
          id: 'Rendering',
          label: 'Rendering',
          description: 'Rendering report outputs.',
          phase: 'analysis',
          order: 2,
          progressStartPercent: 92,
          progressEndPercent: 99
        },
        {
          id: 'Completed',
          label: 'Completed',
          description: 'Done.',
          phase: 'delivery',
          order: 3,
          progressStartPercent: 100,
          progressEndPercent: 100
        }
      ],
      typicalDurationMinutes: 7,
      disclaimerVersion: '2026-03-04'
    });

    (component as any).updatePipelineFromDetail({
      id: 'report-2',
      status: 'processing',
      pipelineStatus: 'Rendering',
      currentStep: 'Analyzing',
      currentSubStep: 'Drafting narrative section 4 of 7: Planning and hazard context.',
      percentComplete: 83,
      lastUpdatedUtc: '2026-02-26T12:02:00Z',
      updatedAt: '2026-02-26T12:02:00Z',
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-02-26T12:00:00Z'
    } as unknown as ReportDetail);

    const analyzingStage = component.processingStages().find((stage) => stage.id === 'Analyzing');
    const renderingStage = component.processingStages().find((stage) => stage.id === 'Rendering');
    expect(analyzingStage?.state).toBe('running');
    expect(renderingStage?.state).toBe('queued');
    expect(component.pipelineStepLabel()).toBe('Analyzing');
    expect(component.processingPercent()).toBe(83);
  });

  it('uses the stage that matches progress percent when currentStep lags behind', () => {
    component.pipelineModel.set({
      steps: [
        {
          id: 'AwaitingUpload',
          label: 'Upload',
          description: 'Documents are uploaded.',
          phase: 'setup',
          order: 0,
          progressStartPercent: 0,
          progressEndPercent: 14
        },
        {
          id: 'Analyzing',
          label: 'Analyzing',
          description: 'Running analysis.',
          phase: 'analysis',
          order: 1,
          progressStartPercent: 60,
          progressEndPercent: 85
        },
        {
          id: 'Rendering',
          label: 'Rendering',
          description: 'Rendering report outputs.',
          phase: 'analysis',
          order: 2,
          progressStartPercent: 92,
          progressEndPercent: 99
        },
        {
          id: 'Completed',
          label: 'Completed',
          description: 'Done.',
          phase: 'delivery',
          order: 3,
          progressStartPercent: 100,
          progressEndPercent: 100
        }
      ],
      typicalDurationMinutes: 7,
      disclaimerVersion: '2026-03-04'
    });

    (component as any).updatePipelineFromDetail({
      id: 'report-3',
      status: 'processing',
      pipelineStatus: 'Rendering',
      currentStep: 'Analyzing',
      currentSubStep: 'Rendering report JSON and PDF outputs.',
      percentComplete: 94,
      lastUpdatedUtc: '2026-02-26T12:04:00Z',
      updatedAt: '2026-02-26T12:04:00Z',
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-02-26T12:00:00Z'
    } as unknown as ReportDetail);

    const analyzingStage = component.processingStages().find((stage) => stage.id === 'Analyzing');
    const renderingStage = component.processingStages().find((stage) => stage.id === 'Rendering');
    expect(analyzingStage?.state).toBe('complete');
    expect(renderingStage?.state).toBe('running');
    expect(component.pipelineStepLabel()).toBe('Rendering');
    expect(component.processingPercent()).toBe(94);
  });

  it('keeps activity updates in timestamp order and prefixes progress updates with stage context', () => {
    component.pipelineModel.set({
      steps: [
        {
          id: 'AwaitingUpload',
          label: 'Upload',
          description: 'Documents are uploaded.',
          phase: 'setup',
          order: 0,
          progressStartPercent: 0,
          progressEndPercent: 14
        },
        {
          id: 'Analyzing',
          label: 'Analyzing',
          description: 'Running analysis.',
          phase: 'analysis',
          order: 1,
          progressStartPercent: 60,
          progressEndPercent: 85
        }
      ],
      typicalDurationMinutes: 7,
      disclaimerVersion: '2026-03-04'
    });

    (component as any).appendBackendEvents([
      {
        id: 2,
        timestampUtc: '2026-02-26T12:06:00Z',
        stageId: 'Analyzing',
        stageState: 'running',
        severity: 'info',
        message: 'Drafting narrative section 5 of 7.',
        percentComplete: 84,
        detailCode: 'progress_update',
        attempt: null,
        maxAttempts: null
      },
      {
        id: 1,
        timestampUtc: '2026-02-26T12:05:00Z',
        stageId: 'Analyzing',
        stageState: 'running',
        severity: 'info',
        message: 'Running primary AI analysis pass.',
        percentComplete: 76,
        detailCode: 'progress_update',
        attempt: null,
        maxAttempts: null
      }
    ]);

    const entries = component.activityEvents().filter((entry) => entry.id.startsWith('api-'));
    expect(entries[0].id).toBe('api-1');
    expect(entries[1].id).toBe('api-2');
    expect(entries[0].message).toBe('Analyzing: Running primary AI analysis pass.');
    expect(entries[1].message).toBe('Analyzing: Drafting narrative section 5 of 7.');
  });

  it('resets wizard state when restarting after a failed report', () => {
    const uploadService = TestBed.inject(UploadService) as unknown as UploadServiceStub;
    uploadService.clearAll.calls.reset();

    component.currentStep.set(3);
    component.createdReportId.set('job-123');
    component.uploadsPrepared.set(true);
    component.processingActive.set(true);
    component.uploadError.set('Upload failed');
    component.wizardError.set('Something went wrong');
    component.pipelineStatusValue.set('Failed');
    component.pipelineCurrentStepValue.set('Failed');

    component.restartReportFlow();

    expect(uploadService.clearAll).toHaveBeenCalledTimes(1);
    expect(component.currentStep()).toBe(0);
    expect(component.createdReportId()).toBe('');
    expect(component.uploadsPrepared()).toBeFalse();
    expect(component.processingActive()).toBeFalse();
    expect(component.uploadError()).toBe('');
    expect(component.wizardError()).toBe('');
    expect(component.pipelineStatusValue()).toBe('AwaitingUpload');
  });

  it('resumes awaiting payment drafts from the query parameter', fakeAsync(() => {
    const draftId = 'draft-resume-id';
    routeStub.snapshot.queryParamMap = convertToParamMap({ draftId });
    ReportServiceStub.resumeDetail = {
      id: draftId,
      title: 'Residential contract review',
      propertyAddress: '12 George Street, Sydney NSW 2000',
      stateOrTerritory: 'NSW',
      createdAt: '2026-02-25T10:00:00Z',
      updatedAt: '2026-02-25T10:05:00Z',
      status: 'draft',
      paymentStatus: 'Unpaid',
      pipelineStatus: 'AwaitingPayment',
      percentComplete: 15,
      currentStep: 'AwaitingPayment',
      currentSubStep: 'Awaiting payment.',
      lastUpdatedUtc: '2026-02-25T10:05:00Z',
      buyerType: 'owner-occupier',
      buyerContext: {
        isFirstHomeBuyer: true,
        concessionIntent: 'yes',
        contractExchanged: false,
        agreedPriceAud: null,
        estimatedPriceAud: 910000
      },
      localGovernmentArea: null,
      propertyTenureType: 'Unknown',
      packType: 'standard',
      startedAt: null,
      completedAt: null,
      archivedAtUtc: null,
      errorMessage: null,
      reportS3Key: null,
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: null,
      rawSummary: null,
      executiveSummary: '',
      propertySnapshot: null,
      jurisdictionProfile: null,
      issues: [],
      checklist: [],
      titleAndEncumbrances: [],
      unusualClauses: [],
      missingInformation: [],
      planningHazards: [],
      financialItems: [],
      settlementAdjustments: [],
      investmentSnapshot: [],
      strataInsights: [],
      costsAndAdjustments: [],
      redFlags: [],
      narrativeSections: [],
      stateSpecificSections: [],
      recommendedActions: [],
      lawyerQuestions: [],
      plainEnglishGuide: [],
      legalDisclaimers: [],
      contractFacts: [],
      financialModel: null,
      negotiationIntelligence: {
        summary: 'No strong negotiation indicators were identified from the uploaded documents.',
        levers: [],
        recommendedNextSteps: [],
        evidenceIndex: []
      },
      sourceAttribution: [],
      citations: [],
      validationWarnings: []
    };

    fixture = TestBed.createComponent(NewReportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(component.createdReportId()).toBe(draftId);
    expect(component.currentStep()).toBe(2);
    expect(component.uploadsPrepared()).toBeTrue();
    expect(component.pipelineStatusValue()).toBe('AwaitingPayment');
    expect(component.propertyAddress).toContain('George Street');
    expect(component.isFirstHomeBuyer).toBeTrue();
    expect(component.concessionIntent).toBe('yes');
    expect(component.contractExchanged).toBeFalse();
    expect(component.estimatedPriceAud).toBe(910000);
  }));

  it('resumes processing reports from reportId into the live pipeline step', fakeAsync(() => {
    const reportId = 'processing-resume-id';
    routeStub.snapshot.queryParamMap = convertToParamMap({ reportId });
    ReportServiceStub.resumeDetail = {
      id: reportId,
      title: 'Residential contract review',
      propertyAddress: '88 Collins Street, Melbourne VIC 3000',
      stateOrTerritory: 'VIC',
      createdAt: '2026-02-25T10:00:00Z',
      updatedAt: '2026-02-25T10:08:00Z',
      status: 'processing',
      paymentStatus: 'Paid',
      pipelineStatus: 'Analyzing',
      percentComplete: 74,
      currentStep: 'Analyzing',
      currentSubStep: 'Running evidence retrieval and state-specific analysis.',
      lastUpdatedUtc: '2026-02-25T10:08:00Z',
      buyerType: 'owner-occupier',
      localGovernmentArea: null,
      propertyTenureType: 'Unknown',
      packType: 'standard',
      startedAt: '2026-02-25T10:02:00Z',
      completedAt: null,
      archivedAtUtc: null,
      errorMessage: null,
      reportS3Key: null,
      disclaimerVersion: '2026-03-04',
      disclaimerAcceptedAtUtc: '2026-03-04T10:01:30Z',
      rawSummary: null,
      executiveSummary: '',
      propertySnapshot: null,
      jurisdictionProfile: null,
      issues: [],
      checklist: [],
      titleAndEncumbrances: [],
      unusualClauses: [],
      missingInformation: [],
      planningHazards: [],
      financialItems: [],
      settlementAdjustments: [],
      investmentSnapshot: [],
      strataInsights: [],
      costsAndAdjustments: [],
      redFlags: [],
      narrativeSections: [],
      stateSpecificSections: [],
      recommendedActions: [],
      lawyerQuestions: [],
      plainEnglishGuide: [],
      legalDisclaimers: [],
      contractFacts: [],
      financialModel: null,
      negotiationIntelligence: {
        summary: 'No strong negotiation indicators were identified from the uploaded documents.',
        levers: [],
        recommendedNextSteps: [],
        evidenceIndex: []
      },
      sourceAttribution: [],
      citations: [],
      validationWarnings: []
    };

    fixture = TestBed.createComponent(NewReportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(component.createdReportId()).toBe(reportId);
    expect(component.currentStep()).toBe(3);
    expect(component.processingActive()).toBeTrue();
    expect(component.pipelineStatusValue()).toBe('Analyzing');
    expect(component.pipelineStartedAtUtc()).toBe('2026-02-25T10:02:00Z');
    expect(component.pipelineSubStep()).toContain('state-specific analysis');
  }));
});
