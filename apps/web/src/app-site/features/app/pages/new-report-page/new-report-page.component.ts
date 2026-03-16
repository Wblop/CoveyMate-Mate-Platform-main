import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, Subject, Subscription, debounceTime, distinctUntilChanged, finalize, from, map, of, switchMap, tap, throwError } from 'rxjs';
import { Stripe, StripeElements, StripePaymentElement, loadStripe } from '@stripe/stripe-js';

import { MetadataConfigurationService } from '@shared-core/config/metadata-configuration.service';
import {
  NewReportDraftInput,
  PipelineModel,
  PipelineProgressEvent,
  PipelineStageState,
  ProcessingStage,
  ReportDetail
} from '@shared-core/models/report.models';
import { AddressAutocompleteService, AddressSuggestion } from '@shared-core/services/address-autocomplete.service';
import { UploadItem } from '@shared-core/models/upload.models';
import { EnabledStatesConfiguration, ReportService } from '@shared-core/services/report.service';
import { REVIEW_UPLOAD_LIMITS } from '@shared-core/services/review-upload-limits';
import { UploadService } from '@shared-core/services/upload.service';
import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIFileDropzoneComponent } from '@shared-ui/ui/file-dropzone/file-dropzone.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UIStepperComponent } from '@shared-ui/ui/stepper/stepper.component';

interface ActivityFeedItem {
  id: string;
  timestampUtc: string;
  stageId: string;
  stageState: PipelineStageState;
  severity: 'info' | 'warning' | 'error';
  message: string;
  technicalDetails?: string;
  isHeartbeat?: boolean;
}

interface StepErrorState {
  propertyAddress: string;
  stateOrTerritory: string;
  isFirstHomeBuyer: string;
  contractExchanged: string;
  agreedPriceAud: string;
  estimatedPriceAud: string;
}

const AUSTRALIAN_STATE_CODE_BY_NAME = new Map<string, string>([
  ['AUSTRALIAN CAPITAL TERRITORY', 'ACT'],
  ['NEW SOUTH WALES', 'NSW'],
  ['NORTHERN TERRITORY', 'NT'],
  ['QUEENSLAND', 'QLD'],
  ['SOUTH AUSTRALIA', 'SA'],
  ['TASMANIA', 'TAS'],
  ['VICTORIA', 'VIC'],
  ['WESTERN AUSTRALIA', 'WA']
]);

const STATE_MISMATCH_ERROR_PREFIX = 'The property address looks like ';

@Component({
  selector: 'app-new-report-page',
  standalone: true,
  imports: [
    AsyncPipe,
    FormsModule,
    RouterLink,
    UIAlertBannerComponent,
    UIButtonComponent,
    UIFileDropzoneComponent,
    UIFormFieldComponent,
    UIPageHeaderComponent,
    UIStepperComponent
  ],
  templateUrl: './new-report-page.component.html',
  styleUrl: './new-report-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewReportPageComponent implements OnDestroy, OnInit {
  private readonly reportService = inject(ReportService);
  private readonly uploadService = inject(UploadService);
  private readonly metadataConfiguration = inject(MetadataConfigurationService);
  private readonly addressAutocomplete = inject(AddressAutocompleteService);
  private readonly route = inject(ActivatedRoute);
  readonly siteUrls = inject(SiteUrlService);

  private readonly fallbackPipelineModel: PipelineModel = {
    steps: [
      {
        id: 'AwaitingUpload',
        label: 'Upload',
        description: 'Documents are uploaded and prepared for processing.',
        phase: 'setup',
        order: 0,
        progressStartPercent: 0,
        progressEndPercent: 14
      },
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
        id: 'Queued',
        label: 'Queue',
        description: 'The job is waiting for worker capacity.',
        phase: 'setup',
        order: 2,
        progressStartPercent: 20,
        progressEndPercent: 29
      },
      {
        id: 'Extracting',
        label: 'Extracting',
        description: 'Contract text is extracted from uploaded files.',
        phase: 'analysis',
        order: 3,
        progressStartPercent: 30,
        progressEndPercent: 47
      },
      {
        id: 'Indexing',
        label: 'Indexing',
        description: 'Evidence chunks and embeddings are indexed.',
        phase: 'analysis',
        order: 4,
        progressStartPercent: 48,
        progressEndPercent: 59
      },
      {
        id: 'Analyzing',
        label: 'Analysing',
        description: 'AI analysis and state-specific reasoning are generated.',
        phase: 'analysis',
        order: 5,
        progressStartPercent: 60,
        progressEndPercent: 85
      },
      {
        id: 'Validating',
        label: 'Validating',
        description: 'Deterministic checks run over findings and citations.',
        phase: 'analysis',
        order: 6,
        progressStartPercent: 86,
        progressEndPercent: 91
      },
      {
        id: 'Rendering',
        label: 'Rendering',
        description: 'JSON and PDF report outputs are assembled.',
        phase: 'analysis',
        order: 7,
        progressStartPercent: 92,
        progressEndPercent: 99
      },
      {
        id: 'Completed',
        label: 'Completed',
        description: 'The report is ready to open and download.',
        phase: 'delivery',
        order: 8,
        progressStartPercent: 100,
        progressEndPercent: 100
      }
    ],
    typicalDurationMinutes: 7,
    disclaimerVersion: '2026-03-04'
  };

  readonly steps = ['Basics', 'Upload', 'Review', 'Pipeline'];
  readonly uploadLimitSummary = `Up to ${REVIEW_UPLOAD_LIMITS.maxFiles} PDF files, ${REVIEW_UPLOAD_LIMITS.maxFileSizeLabel} each.`;
  readonly currentStep = signal(0);
  readonly wizardError = signal('');
  readonly uploadError = signal('');
  readonly processingActive = signal(false);
  readonly processingComplete = signal(false);
  readonly pipelineModel = signal<PipelineModel>(this.fallbackPipelineModel);
  readonly pipelineModelLoading = signal(true);
  readonly pipelineModelError = signal('');
  readonly processingStages = signal<ProcessingStage[]>(this.buildStages('AwaitingUpload', 'AwaitingUpload'));
  readonly createdReportId = signal('');
  readonly pipelineMessage = signal('');
  readonly pipelineStatusValue = signal('AwaitingUpload');
  readonly pipelineCurrentStepValue = signal('AwaitingUpload');
  readonly pipelineStepLabel = signal('Awaiting upload');
  readonly pipelineSubStep = signal('');
  readonly pipelineStartedAtUtc = signal('');
  readonly pipelineLastUpdatedUtc = signal('');
  readonly processingPercent = signal(0);
  readonly priceLabel = signal('A$19.99');
  readonly disclaimerVersion = signal(this.fallbackPipelineModel.disclaimerVersion);
  readonly disclaimerAcceptedAtUtc = signal('');
  readonly activityEvents = signal<ActivityFeedItem[]>([]);
  readonly activityExpanded = signal(false);
  readonly nowTickMs = signal(Date.now());
  readonly uploadsPrepared = signal(false);
  readonly awaitingPaymentConfirmation = signal(false);
  readonly paymentActionInFlight = signal(false);
  readonly paymentError = signal('');
  readonly paymentModalOpen = signal(false);
  readonly failedJobDialogOpen = signal(false);
  readonly uploadHelpModalOpen = signal(false);
  readonly paymentFormReady = signal(false);
  readonly paymentSessionPreparing = signal(false);
  readonly paymentModalRendering = signal(false);
  readonly stateConfigLoading = signal(true);
  readonly stateConfigError = signal('');
  readonly supportedStates = signal<string[]>(['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT']);
  readonly enabledStates = signal<string[]>(['ACT']);
  readonly addressSuggestions = signal<AddressSuggestion[]>([]);
  readonly addressLookupLoading = signal(false);
  readonly addressManualEntry = signal(false);
  readonly stepErrors = signal<StepErrorState>(this.emptyStepErrors());

  propertyAddress = '';
  buyerType: 'owner-occupier' | 'investor' = 'owner-occupier';
  stateOrTerritory = 'ACT';
  isFirstHomeBuyer: boolean | null = null;
  concessionIntent: 'yes' | 'no' | 'unsure' = 'unsure';
  contractExchanged: boolean | null = null;
  agreedPriceAud: number | null = null;
  estimatedPriceAud: number | null = null;
  acceptedDisclaimer = false;

  readonly uploads$ = this.uploadService.getUploads();

  private readonly subscriptions = new Subscription();
  @ViewChild('paymentModal') private paymentModalRef?: ElementRef<HTMLElement>;
  @ViewChild('paymentCloseButton') private paymentCloseButtonRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('failedJobCloseButton') private failedJobCloseButtonRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('uploadHelpModal') private uploadHelpModalRef?: ElementRef<HTMLElement>;
  @ViewChild('uploadHelpCloseButton') private uploadHelpCloseButtonRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('activityScrollRegion') private activityScrollRegionRef?: ElementRef<HTMLElement>;
  private stripe: Stripe | null = null;
  private stripeElements: StripeElements | null = null;
  private stripePaymentElement: StripePaymentElement | null = null;
  private stripeLoaderPromise: Promise<Stripe | null> | null = null;
  private paymentModalTriggerElement: HTMLElement | null = null;
  private previousBodyOverflow: string | null = null;
  private previousHtmlOverflow: string | null = null;
  private failedJobDialogShownForReportId = '';
  private uploadHelpModalTriggerElement: HTMLElement | null = null;
  private selectedAddressStateOrTerritory = '';
  private addressCommitted = false;
  private readonly propertyAddressInput$ = new Subject<string>();
  private lastProgressEventCursorUtc: string | null = null;
  private lastResolvedStageId = '';
  private lastHeartbeatAtMs = 0;
  private readonly seenSingletonBackendDetailCodes = new Set<string>();
  private liveClockIntervalId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private progressEventsLoading = false;

  constructor() {
    const metadata = this.metadataConfiguration.tryGetValue();
    if (metadata) {
      this.priceLabel.set(this.toPriceLabel(metadata.payments.priceAudCents, metadata.payments.currency));
      this.primeStripeLoader(metadata.payments.stripePublishableKey);
    }
  }

  ngOnInit(): void {
    this.focusStepHeadingSoon();
    this.loadPipelineModel();
    const resumedFromQuery = this.resumeReportFromQueryIfPresent();
    if (!resumedFromQuery) {
      this.resetFreshReportFlowState();
    }

    const subscription = this.reportService.getEnabledStatesConfiguration().subscribe({
      next: (configuration) => this.applyEnabledStatesConfiguration(configuration),
      error: (error: Error) => {
        this.stateConfigError.set(error.message);
        this.stateConfigLoading.set(false);
      }
    });

    this.subscriptions.add(subscription);
    const addressLookupSub = this.propertyAddressInput$
      .pipe(
        map((value) => value.trim()),
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((query) => {
          if (this.addressManualEntry()) {
            this.addressLookupLoading.set(false);
            return of<AddressSuggestion[]>([]);
          }

          if (query.length < 3) {
            this.addressLookupLoading.set(false);
            return of<AddressSuggestion[]>([]);
          }

          this.addressLookupLoading.set(true);
          return this.addressAutocomplete.searchAustralianAddresses(query, this.stateOrTerritory).pipe(
            finalize(() => this.addressLookupLoading.set(false))
          );
        })
      )
      .subscribe((suggestions) => this.addressSuggestions.set(suggestions));

    this.subscriptions.add(addressLookupSub);
  }

  private resumeReportFromQueryIfPresent(): boolean {
    const reportId = this.route.snapshot.queryParamMap.get('reportId')?.trim()
      || this.route.snapshot.queryParamMap.get('draftId')?.trim();
    if (!reportId) {
      return false;
    }

    this.processingActive.set(true);
    let keepProcessingWatchActive = false;
    const resumeSub = this.reportService.getReportById(reportId).subscribe({
      next: (detail) => {
        keepProcessingWatchActive = detail.status === 'processing';
        this.applyResumeDetail(detail);
      },
      error: (error: Error) => {
        this.wizardError.set(`Could not open this report. ${error.message}`);
        this.processingActive.set(false);
      },
      complete: () => {
        if (!keepProcessingWatchActive) {
          this.processingActive.set(false);
        }
      }
    });

    this.subscriptions.add(resumeSub);
    return true;
  }

  private applyResumeDetail(detail: ReportDetail): void {
    this.uploadService.clearAll();
    this.activityEvents.set([]);
    this.activityExpanded.set(false);
    this.lastProgressEventCursorUtc = null;
    this.lastResolvedStageId = '';
    this.lastHeartbeatAtMs = 0;
    this.seenSingletonBackendDetailCodes.clear();
    this.wizardError.set('');
    this.uploadError.set('');

    this.createdReportId.set(detail.id);
    this.propertyAddress = detail.propertyAddress || '';
    this.addressCommitted = !!(detail.propertyAddress || '').trim();
    this.buyerType = detail.buyerType === 'investor' ? 'investor' : 'owner-occupier';
    this.stateOrTerritory = detail.stateOrTerritory || this.stateOrTerritory;
    this.selectedAddressStateOrTerritory = '';
    this.isFirstHomeBuyer = detail.buyerContext?.isFirstHomeBuyer ?? null;
    this.concessionIntent = detail.buyerContext?.concessionIntent ?? 'unsure';
    this.contractExchanged = detail.buyerContext?.contractExchanged ?? null;
    this.agreedPriceAud = this.normalizeWizardPrice(detail.buyerContext?.agreedPriceAud ?? null);
    this.estimatedPriceAud = this.normalizeWizardPrice(detail.buyerContext?.estimatedPriceAud ?? null);
    this.stepErrors.set(this.emptyStepErrors());
    this.disclaimerAcceptedAtUtc.set(detail.disclaimerAcceptedAtUtc || '');
    if (detail.disclaimerVersion?.trim()) {
      this.disclaimerVersion.set(detail.disclaimerVersion.trim());
    }

    const statusKey = this.normalizePipelineKey(detail.pipelineStatus || detail.currentStep);
    if (detail.status === 'processing') {
      this.uploadsPrepared.set(true);
      this.acceptedDisclaimer = Boolean(detail.disclaimerAcceptedAtUtc);
      this.currentStep.set(3);
      this.pipelineStartedAtUtc.set(detail.startedAt || '');
      this.startLiveClock();
      this.startHeartbeatTicker();
      this.updatePipelineFromDetail(detail);
      this.processingActive.set(true);
      this.focusStepHeadingSoon();

      const watchSub = this.reportService.watchReviewProgress(detail.id).subscribe({
        next: (nextDetail) => {
          this.processingActive.set(true);
          this.updatePipelineFromDetail(nextDetail);
        },
        error: (error: Error) => {
          this.wizardError.set(`Could not refresh live progress. ${error.message}`);
          this.processingActive.set(false);
        },
        complete: () => {
          if (!this.processingComplete() && !this.pipelineStatusIsFailed()) {
            this.processingActive.set(false);
          }
        }
      });

      this.subscriptions.add(watchSub);
      return;
    }

    if (detail.status === 'draft' && statusKey === 'awaitingpayment') {
      this.uploadsPrepared.set(true);
      this.acceptedDisclaimer = Boolean(detail.disclaimerAcceptedAtUtc);
      this.currentStep.set(2);
      this.pipelineStatusValue.set('AwaitingPayment');
      this.pipelineCurrentStepValue.set('AwaitingPayment');
      this.pipelineStepLabel.set('Payment');
      this.pipelineSubStep.set('Draft resumed. Continue to payment.');
      this.pipelineStartedAtUtc.set('');
      this.pipelineLastUpdatedUtc.set(detail.lastUpdatedUtc || detail.updatedAt || new Date().toISOString());
      this.processingPercent.set(Math.max(15, detail.percentComplete || 15));
      this.processingStages.set(this.buildStages('AwaitingPayment', 'AwaitingPayment'));
      this.focusStepHeadingSoon();
      return;
    }

    if (detail.status === 'draft') {
      this.uploadsPrepared.set(false);
      this.acceptedDisclaimer = false;
      this.currentStep.set(1);
      this.uploadError.set('This draft still needs uploads in this session before it can be processed.');
      this.pipelineStatusValue.set('AwaitingUpload');
      this.pipelineCurrentStepValue.set('AwaitingUpload');
      this.pipelineStepLabel.set('Upload');
      this.pipelineSubStep.set('Re-upload files to continue this draft.');
      this.pipelineStartedAtUtc.set('');
      this.pipelineLastUpdatedUtc.set(detail.lastUpdatedUtc || detail.updatedAt || new Date().toISOString());
      this.processingPercent.set(Math.max(0, detail.percentComplete || 0));
      this.processingStages.set(this.buildStages('AwaitingUpload', 'AwaitingUpload'));
      this.focusStepHeadingSoon();
      return;
    }

    this.wizardError.set('This report cannot be resumed here. Open it from Reports.');
  }

  onPropertyAddressChanged(value: string): void {
    this.propertyAddress = value;
    this.selectedAddressStateOrTerritory = '';
    this.addressCommitted = false;
    if (this.addressManualEntry()) {
      this.addressLookupLoading.set(false);
      this.addressSuggestions.set([]);
    } else {
      this.propertyAddressInput$.next(value);
      if (value.trim().length < 3) {
        this.addressSuggestions.set([]);
      }
    }

    if (!this.stepErrors().propertyAddress) {
      this.refreshStateOrTerritoryWarning();
      return;
    }

    this.stepErrors.update((errors) => ({ ...errors, propertyAddress: '' }));
    this.refreshStateOrTerritoryWarning();
  }

  toggleManualAddressEntry(): void {
    const manualEntryEnabled = !this.addressManualEntry();
    this.addressManualEntry.set(manualEntryEnabled);
    this.addressLookupLoading.set(false);
    this.addressSuggestions.set([]);

    if (!manualEntryEnabled) {
      this.addressCommitted = false;
    }

    if (!manualEntryEnabled && this.propertyAddress.trim().length >= 3) {
      this.propertyAddressInput$.next(this.propertyAddress);
    }
  }

  applyAddressSuggestion(suggestion: AddressSuggestion): void {
    this.propertyAddress = suggestion.label;
    this.addressSuggestions.set([]);
    this.addressCommitted = true;
    this.selectedAddressStateOrTerritory = suggestion.stateOrTerritory?.trim().toUpperCase() ?? '';

    if (this.stepErrors().propertyAddress) {
      this.stepErrors.update((errors) => ({ ...errors, propertyAddress: '' }));
    }

    this.refreshStateOrTerritoryWarning();
  }

  onStateOrTerritoryChanged(value: string): void {
    this.stateOrTerritory = value;
    this.refreshStateOrTerritoryWarning();

    if (!this.addressManualEntry() && this.propertyAddress.trim().length >= 3) {
      this.propertyAddressInput$.next(this.propertyAddress);
    }
  }

  onFirstHomeBuyerChanged(value: boolean | null): void {
    this.isFirstHomeBuyer = value;
    if (this.stepErrors().isFirstHomeBuyer) {
      this.stepErrors.update((errors) => ({ ...errors, isFirstHomeBuyer: '' }));
    }
  }

  onContractExchangedChanged(value: boolean | null): void {
    this.contractExchanged = value;
    if (value === true) {
      this.estimatedPriceAud = null;
      if (this.stepErrors().estimatedPriceAud) {
        this.stepErrors.update((errors) => ({ ...errors, estimatedPriceAud: '' }));
      }
    } else if (value === false) {
      this.agreedPriceAud = null;
      if (this.stepErrors().agreedPriceAud) {
        this.stepErrors.update((errors) => ({ ...errors, agreedPriceAud: '' }));
      }
    } else {
      this.agreedPriceAud = null;
      this.estimatedPriceAud = null;
    }

    if (this.stepErrors().contractExchanged) {
      this.stepErrors.update((errors) => ({ ...errors, contractExchanged: '' }));
    }
  }

  onAgreedPriceChanged(value: number | string | null): void {
    const cleaned = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : value;
    this.agreedPriceAud = this.normalizeWizardPrice(typeof cleaned === 'number' && Number.isNaN(cleaned) ? null : cleaned);
    if (this.stepErrors().agreedPriceAud) {
      this.stepErrors.update((errors) => ({ ...errors, agreedPriceAud: '' }));
    }
  }

  onEstimatedPriceChanged(value: number | string | null): void {
    const cleaned = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : value;
    this.estimatedPriceAud = this.normalizeWizardPrice(typeof cleaned === 'number' && Number.isNaN(cleaned) ? null : cleaned);
    if (this.stepErrors().estimatedPriceAud) {
      this.stepErrors.update((errors) => ({ ...errors, estimatedPriceAud: '' }));
    }
  }

  toConcessionIntentLabel(value: 'yes' | 'no' | 'unsure'): string {
    if (value === 'yes') {
      return 'Yes';
    }
    if (value === 'no') {
      return 'No';
    }
    return 'Unsure';
  }

  buyerTypeLabel(): string {
    return this.buyerType === 'investor' ? 'Investor' : 'Owner-occupier';
  }

  reviewPriceSummary(): string {
    if (this.contractExchanged === true) {
      return this.agreedPriceAud && this.agreedPriceAud > 0
        ? `Agreed: ${this.formatAudAmount(this.agreedPriceAud)}`
        : 'Agreed price not provided';
    }

    if (this.contractExchanged === false) {
      return this.estimatedPriceAud && this.estimatedPriceAud > 0
        ? `Estimate: ${this.formatAudAmount(this.estimatedPriceAud)} (indicative only)`
        : 'No estimate provided';
    }

    return 'Not provided';
  }

  private validateStepOne(setErrors: boolean): boolean {
    const errors = this.emptyStepErrors();

    if (!this.propertyAddress.trim()) {
      errors.propertyAddress = 'Property address is required.';
    } else if (!this.addressManualEntry() && !this.addressCommitted) {
      errors.propertyAddress = 'Select an address from the suggestions, or use "Can\'t find it?" to enter it manually.';
    }

    if (this.stateConfigLoading()) {
      errors.stateOrTerritory = 'Jurisdiction configuration is still loading. Please wait.';
    } else if (!this.isStateEnabled(this.stateOrTerritory)) {
      errors.stateOrTerritory = `${this.stateOrTerritory} is not enabled yet. Choose a jurisdiction marked as available.`;
    } else {
      const addressStateMismatch = this.getAddressStateMismatchError();
      if (addressStateMismatch) {
        errors.stateOrTerritory = addressStateMismatch;
      }
    }

    if (this.isFirstHomeBuyer === null) {
      errors.isFirstHomeBuyer = 'Select whether you are a first home buyer.';
    }

    if (this.contractExchanged === null) {
      errors.contractExchanged = 'Select whether this contract has exchanged.';
    } else if (this.contractExchanged) {
      if (!this.isPositivePrice(this.agreedPriceAud)) {
        errors.agreedPriceAud = 'Agreed purchase price is required and must be greater than zero.';
      }
    } else if (this.estimatedPriceAud !== null && !this.isPositivePrice(this.estimatedPriceAud)) {
      errors.estimatedPriceAud = 'Estimated price must be greater than zero when provided.';
    }

    if (setErrors) {
      this.stepErrors.set(errors);
    }

    return Object.values(errors).some((message) => message.length === 0);
  }

  private isPositivePrice(value: number | null): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  private formatAudAmount(value: number): string {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      maximumFractionDigits: 0
    }).format(value);
  }

  private normalizeWizardPrice(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string' && value.trim().length === 0) {
      return null;
    }

    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.round(parsed * 10) / 10;
  }

  private emptyStepErrors(): StepErrorState {
    return {
      propertyAddress: '',
      stateOrTerritory: '',
      isFirstHomeBuyer: '',
      contractExchanged: '',
      agreedPriceAud: '',
      estimatedPriceAud: ''
    };
  }

  private refreshStateOrTerritoryWarning(): void {
    const mismatchMessage = this.getAddressStateMismatchError();
    this.stepErrors.update((errors) => {
      if (mismatchMessage) {
        if (errors.stateOrTerritory === mismatchMessage) {
          return errors;
        }

        return { ...errors, stateOrTerritory: mismatchMessage };
      }

      if (!errors.stateOrTerritory) {
        return errors;
      }

      if (this.isAddressStateMismatchError(errors.stateOrTerritory)) {
        return { ...errors, stateOrTerritory: '' };
      }

      if (!this.stateConfigLoading() && this.isStateEnabled(this.stateOrTerritory)) {
        return { ...errors, stateOrTerritory: '' };
      }

      return errors;
    });
  }

  private getAddressStateMismatchError(): string {
    if (this.stateConfigLoading() || !this.isStateEnabled(this.stateOrTerritory)) {
      return '';
    }

    const selectedState = this.stateOrTerritory.trim().toUpperCase();
    const addressState = this.resolveAddressStateOrTerritory();
    if (!selectedState || !addressState || selectedState === addressState) {
      return '';
    }

    return `${STATE_MISMATCH_ERROR_PREFIX}${addressState}, but the selected state or territory is ${selectedState}. Check the address or update the jurisdiction.`;
  }

  private resolveAddressStateOrTerritory(): string {
    const selectedSuggestionState = this.selectedAddressStateOrTerritory.trim().toUpperCase();
    if (selectedSuggestionState) {
      return selectedSuggestionState;
    }

    return this.extractStateOrTerritoryFromAddress(this.propertyAddress);
  }

  private extractStateOrTerritoryFromAddress(address: string): string {
    const normalized = (address || '')
      .trim()
      .toUpperCase()
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ');

    if (!normalized) {
      return '';
    }

    const normalizedWithoutCountry = normalized.replace(/\s+AUSTRALIA\s*$/, '').trim();
    const stateCodeMatch = normalizedWithoutCountry.match(/(?:^|\s)(ACT|NSW|VIC|QLD|WA|SA|TAS|NT)(?:\s+\d{3,4})?\s*$/);
    if (stateCodeMatch) {
      return stateCodeMatch[1];
    }

    for (const [stateName, code] of AUSTRALIAN_STATE_CODE_BY_NAME.entries()) {
      const stateNamePattern = stateName.replace(/\s+/g, '\\s+');
      if (new RegExp(`(?:^|\\s)${stateNamePattern}(?:\\s+\\d{3,4})?\\s*$`).test(normalizedWithoutCountry)) {
        return code;
      }
    }

    return '';
  }

  private isAddressStateMismatchError(message: string): boolean {
    return message.startsWith(STATE_MISMATCH_ERROR_PREFIX);
  }

  canProceedCurrentStep(): boolean {
    if (this.currentStep() === 0) {
      return this.validateStepOne(false);
    }
    if (this.currentStep() === 1) {
      if (this.uploadsPrepared()) {
        return true;
      }
      return this.uploadService.getQueuedFilesSnapshot().length > 0;
    }
    if (this.currentStep() === 2) {
      return this.acceptedDisclaimer && this.uploadsPrepared();
    }
    return false;
  }

  canOpenPaymentModal(): boolean {
    return this.awaitingPaymentConfirmation() && this.paymentFormReady() && !this.paymentSessionPreparing();
  }

  goNext(): void {
    if (this.currentStep() === 0) {
      if (!this.validateStepOne(true)) {
        const errors = this.stepErrors();
        if (errors.propertyAddress) {
          this.focusElementById('propertyAddress');
        } else if (errors.stateOrTerritory) {
          this.focusElementById('stateOrTerritory');
        } else if (errors.isFirstHomeBuyer) {
          this.focusElementById('isFirstHomeBuyer');
        } else if (errors.contractExchanged) {
          this.focusElementById('contractExchanged');
        } else if (errors.agreedPriceAud) {
          this.focusElementById('agreedPriceAud');
        } else if (errors.estimatedPriceAud) {
          this.focusElementById('estimatedPriceAud');
        }
        return;
      }
    }

    if (this.currentStep() === 1) {
      if (this.uploadsPrepared()) {
        this.stepErrors.set(this.emptyStepErrors());
        this.uploadError.set('');
        this.currentStep.set(2);
        this.focusStepHeadingSoon();
        return;
      }

      if (this.uploadService.getQueuedFilesSnapshot().length === 0) {
        this.uploadError.set('Add at least one file before continuing.');
        return;
      }

      this.prepareUploadsAndAdvanceToReview();
      return;
    }

    this.stepErrors.set(this.emptyStepErrors());
    this.uploadError.set('');
    this.addressSuggestions.set([]);
    this.currentStep.update((step) => Math.min(step + 1, 3));
    this.focusStepHeadingSoon();
  }

  goBack(): void {
    this.wizardError.set('');
    this.currentStep.update((step) => Math.max(step - 1, 0));
    this.focusStepHeadingSoon();
  }

  restartReportFlow(): void {
    this.resetFreshReportFlowState();
    this.focusStepHeadingSoon();
  }

  onFilesSelected(files: File[]): void {
    if (this.uploadsPrepared()) {
      this.uploadError.set('Files are already uploaded for this review. Start a new report to change documents.');
      return;
    }

    this.uploadError.set('');
    const subscription = this.uploadService.queueFiles(files).subscribe({
      error: (error: Error) => this.uploadError.set(error.message)
    });
    this.subscriptions.add(subscription);
  }

  removeUpload(upload: UploadItem): void {
    if (this.uploadsPrepared()) {
      return;
    }

    const subscription = this.uploadService.removeUpload(upload.id).subscribe();
    this.subscriptions.add(subscription);
  }

  private prepareUploadsAndAdvanceToReview(): void {
    const queuedFiles = this.uploadService.getQueuedFilesSnapshot();
    if (queuedFiles.length === 0) {
      this.uploadError.set('Add at least one file before continuing.');
      return;
    }

    this.stepErrors.set(this.emptyStepErrors());
    this.uploadError.set('');
    this.wizardError.set('');
    this.activityEvents.set([]);
    this.activityExpanded.set(false);
    this.lastProgressEventCursorUtc = null;
    this.lastResolvedStageId = '';
    this.lastHeartbeatAtMs = 0;
    this.seenSingletonBackendDetailCodes.clear();
    this.disclaimerAcceptedAtUtc.set('');
    this.processingActive.set(true);
    this.processingComplete.set(false);
    this.pipelineMessage.set('Creating review job...');
    this.pipelineStepLabel.set('Initialising');
    this.pipelineSubStep.set('Creating a secure review record for this property.');
    this.pipelineLastUpdatedUtc.set(new Date().toISOString());
    this.processingPercent.set(5);

    const payload: NewReportDraftInput = {
      propertyAddress: this.propertyAddress,
      buyerType: this.buyerType,
      stateOrTerritory: this.stateOrTerritory,
      buyerContext: {
        isFirstHomeBuyer: this.isFirstHomeBuyer,
        concessionIntent: this.concessionIntent,
        contractExchanged: this.contractExchanged,
        agreedPriceAud: this.contractExchanged === true ? this.normalizeWizardPrice(this.agreedPriceAud) : null,
        estimatedPriceAud: this.contractExchanged === false ? this.normalizeWizardPrice(this.estimatedPriceAud) : null
      },
      acceptedDisclaimer: false
    };

    const uploadSub = this.reportService
      .createReviewJob(payload, queuedFiles)
      .pipe(
        tap((created) => {
          this.createdReportId.set(created.jobId);
          this.pipelineMessage.set('Uploading documents to secure storage...');
          this.pipelineStepLabel.set('Uploading');
          this.pipelineSubStep.set('Sending files to secure object storage before payment.');
          this.pipelineLastUpdatedUtc.set(new Date().toISOString());
          this.processingPercent.set(10);
          this.pipelineStatusValue.set('AwaitingUpload');
          this.pipelineCurrentStepValue.set('AwaitingUpload');
          this.processingStages.set(this.buildStages('AwaitingUpload', 'AwaitingUpload'));
        }),
        switchMap((created) =>
          this.uploadService.uploadQueuedFiles(created).pipe(
            map(() => {
              this.assertAllSelectedFilesUploaded(queuedFiles.length);
              return created.jobId;
            }),
            tap(() => {
              this.pipelineMessage.set('Finalising upload manifest...');
              this.pipelineStepLabel.set('Awaiting payment');
              this.pipelineSubStep.set('Validating file list and locking upload references.');
              this.pipelineLastUpdatedUtc.set(new Date().toISOString());
              this.processingPercent.set(15);
              this.pipelineStatusValue.set('AwaitingPayment');
              this.pipelineCurrentStepValue.set('AwaitingPayment');
              this.processingStages.set(this.buildStages('AwaitingPayment', 'AwaitingPayment'));
            })
          )
        ),
        switchMap((jobId) => {
          const documents = this.getFinalizeDocumentsOrThrow(queuedFiles.length);
          return this.reportService.finalizeUploads(jobId, documents).pipe(map(() => jobId));
        })
      )
      .subscribe({
        next: () => {
          this.uploadsPrepared.set(true);
          this.currentStep.set(2);
          this.focusStepHeadingSoon();
        },
        error: (error: Error) => {
          this.uploadError.set(error.message);
          this.pipelineMessage.set('File upload failed.');
          this.pipelineSubStep.set('Resolve upload errors and try again.');
          this.pipelineLastUpdatedUtc.set(new Date().toISOString());
          this.createdReportId.set('');
          this.uploadsPrepared.set(false);
          this.processingActive.set(false);
        },
        complete: () => {
          this.processingActive.set(false);
        }
      });

    this.subscriptions.add(uploadSub);
  }

  submitAndProcess(): void {
    const jobId = this.createdReportId();
    if (!this.uploadsPrepared() || !jobId) {
      this.wizardError.set('Complete document uploads in Step 2 before continuing to payment.');
      this.currentStep.set(1);
      this.focusStepHeadingSoon();
      return;
    }

    if (!this.acceptedDisclaimer) {
      this.wizardError.set('You must accept the disclaimer before continuing.');
      this.focusElementById('acceptedDisclaimer');
      return;
    }

    this.wizardError.set('');
    this.paymentError.set('');
    this.processingActive.set(true);
    this.pipelineMessage.set('Recording disclaimer acknowledgement...');
    this.pipelineStatusValue.set('AwaitingPayment');
    this.pipelineCurrentStepValue.set('AwaitingPayment');
    this.pipelineStepLabel.set('Payment');
    this.pipelineSubStep.set(`Saving disclaimer acceptance (version ${this.disclaimerVersion()}).`);
    this.pipelineLastUpdatedUtc.set(new Date().toISOString());
    this.processingPercent.set(15);

    const disclaimerSub = this.reportService
      .acknowledgeDisclaimer(jobId, this.disclaimerVersion())
      .pipe(
        tap((acknowledgement) => {
          this.disclaimerVersion.set(acknowledgement.disclaimerVersion);
          this.disclaimerAcceptedAtUtc.set(acknowledgement.acceptedAtUtc);
        }),
        switchMap(() => this.reportService.getReportById(jobId))
      )
      .subscribe({
        next: () => {
          this.enterPaymentAndPipelineStep();
        },
        error: (error: Error) => {
          this.wizardError.set(error.message);
          this.processingActive.set(false);
        }
      });

    this.subscriptions.add(disclaimerSub);
  }

  private enterPaymentAndPipelineStep(): void {
    this.startLiveClock();
    this.startHeartbeatTicker();
    this.paymentActionInFlight.set(false);
    this.awaitingPaymentConfirmation.set(true);
    this.paymentModalOpen.set(false);
    this.paymentFormReady.set(false);
    this.paymentSessionPreparing.set(true);
    this.paymentModalRendering.set(false);
    this.processingActive.set(true);
    this.processingComplete.set(false);
    this.currentStep.set(3);
    this.focusStepHeadingSoon();
    this.pipelineStatusValue.set('AwaitingPayment');
    this.pipelineCurrentStepValue.set('AwaitingPayment');
    this.pipelineStepLabel.set('Payment');
    this.pipelineMessage.set('Preparing secure payment form...');
    this.pipelineSubStep.set('Initialising secure checkout and loading available payment methods.');
    this.pipelineStartedAtUtc.set('');
    this.pipelineLastUpdatedUtc.set(new Date().toISOString());
    this.processingPercent.set(15);
    this.processingStages.set(this.buildStages('AwaitingPayment', 'AwaitingPayment'));
    this.pushActivity({
      id: `ui-disclaimer-${Date.now()}`,
      timestampUtc: new Date().toISOString(),
      stageId: 'AwaitingPayment',
      stageState: 'queued',
      severity: 'info',
      message: 'Disclaimer accepted. Payment setup started.'
    });
    this.pullProgressEvents(this.createdReportId());

    this.startPaymentSetup();
  }

  retryPaymentSetup(): void {
    if (!this.awaitingPaymentConfirmation() || !this.createdReportId()) {
      return;
    }

    this.wizardError.set('');
    this.paymentError.set('');
    this.paymentActionInFlight.set(false);
    this.startPaymentSetup();
  }

  prepareSecureCheckout(): void {
    if (!this.awaitingPaymentConfirmation() || !this.createdReportId()) {
      return;
    }

    this.wizardError.set('');
    this.paymentError.set('');
    this.paymentActionInFlight.set(false);
    this.startPaymentSetup();
  }

  private startPaymentSetup(): void {
    const jobId = this.createdReportId();
    if (!jobId) {
      this.paymentSessionPreparing.set(false);
      this.processingActive.set(false);
      this.awaitingPaymentConfirmation.set(false);
      this.wizardError.set('Review job was not initialised. Start again from Step 1.');
      return;
    }

    this.paymentSessionPreparing.set(true);
    this.processingActive.set(true);
    const flowSub = this.reportService
      .createPaymentIntent(jobId)
      .pipe(
        switchMap((paymentIntent) => this.preparePaymentElement(paymentIntent.clientSecret)),
        tap(() => {
          this.paymentFormReady.set(true);
          this.paymentSessionPreparing.set(false);
          this.pipelineMessage.set('Secure checkout is ready.');
          this.pipelineSubStep.set('Open secure checkout to pay and start processing.');
          this.pipelineLastUpdatedUtc.set(new Date().toISOString());
          this.pushActivity({
            id: `ui-payment-ready-${Date.now()}`,
            timestampUtc: new Date().toISOString(),
            stageId: 'AwaitingPayment',
            stageState: 'queued',
            severity: 'info',
            message: 'Payment setup ready. Checkout can now be opened.'
          });
        })
      )
      .subscribe({
        next: () => void 0,
        error: (error: Error) => {
          this.paymentError.set(error.message);
          this.processingActive.set(false);
          this.paymentSessionPreparing.set(false);
          this.paymentActionInFlight.set(false);
          this.forceClosePaymentModal();
          this.paymentFormReady.set(false);
          this.pipelineMessage.set('Payment setup failed.');
          this.pipelineSubStep.set('Stripe could not be initialised. Retry payment setup.');
          this.pipelineLastUpdatedUtc.set(new Date().toISOString());
          this.pushActivity({
            id: `ui-payment-error-${Date.now()}`,
            timestampUtc: new Date().toISOString(),
            stageId: 'AwaitingPayment',
            stageState: 'warning',
            severity: 'warning',
            message: 'Payment setup failed. Retry setup to continue.',
            technicalDetails: error.message
          });
        },
        complete: () => this.processingActive.set(false)
      });

    this.subscriptions.add(flowSub);
  }

  confirmPaymentAndStartPipeline(): void {
    const jobId = this.createdReportId();
    if (!jobId) {
      this.paymentError.set('Review job was not initialised. Start again from Step 1.');
      return;
    }

    if (!this.stripe || !this.stripeElements) {
      this.paymentError.set('Payment form is not ready. Re-open the payment step and try again.');
      return;
    }

    this.paymentError.set('');
    this.wizardError.set('');
    this.paymentActionInFlight.set(true);

    const confirmSub = this.confirmPaymentWithStripe().pipe(
      switchMap(() => this.reportService.confirmPayment(jobId)),
      tap((detail) => {
        const paymentConfirmedAt = new Date().toISOString();
        this.awaitingPaymentConfirmation.set(false);
        this.forceClosePaymentModal();
        this.paymentSessionPreparing.set(false);
        this.pipelineMessage.set('Payment confirmed. Queuing review for processing...');
        this.pipelineSubStep.set('Payment captured. Waiting for worker allocation.');
        this.pipelineStartedAtUtc.set(paymentConfirmedAt);
        this.pipelineLastUpdatedUtc.set(paymentConfirmedAt);
        this.pipelineStatusValue.set('Queued');
        this.pipelineCurrentStepValue.set('Queued');
        this.pushActivity({
          id: `ui-payment-confirmed-${Date.now()}`,
          timestampUtc: paymentConfirmedAt,
          stageId: 'Queued',
          stageState: 'queued',
          severity: 'info',
          message: 'Started: Queue'
        });
        this.updatePipelineFromDetail(detail);
      }),
      switchMap(() => this.reportService.watchReviewProgress(jobId))
    ).subscribe({
      next: (detail) => {
        this.processingActive.set(true);
        this.updatePipelineFromDetail(detail);
      },
      error: (error: Error) => {
        this.paymentError.set(error.message);
        this.processingActive.set(false);
        this.paymentActionInFlight.set(false);
      },
      complete: () => {
        this.processingActive.set(false);
        this.paymentActionInFlight.set(false);
        if (this.processingComplete()) {
          this.uploadService.clearAll();
          this.destroyStripePaymentElement();
        }
      }
    });

    this.subscriptions.add(confirmSub);
  }

  private assertAllSelectedFilesUploaded(expectedCount: number): void {
    const uploads = this.uploadService.getUploadsSnapshot();
    if (uploads.length !== expectedCount) {
      throw new Error('Upload state changed unexpectedly. Please review your file list and try again.');
    }

    const failedUploads = uploads.filter((item) => item.status === 'failed');
    if (failedUploads.length > 0) {
      const fileNames = failedUploads.map((item) => item.fileName).join(', ');
      throw new Error(`Upload failed for: ${fileNames}. Resolve upload errors before continuing to payment.`);
    }

    const incompleteUploads = uploads.filter((item) => item.status !== 'uploaded');
    if (incompleteUploads.length > 0) {
      throw new Error('Some files are still uploading. Wait for uploads to complete before continuing.');
    }
  }

  private getFinalizeDocumentsOrThrow(expectedCount: number) {
    const documents = this.uploadService.getFinalizeDocuments();
    if (documents.length !== expectedCount) {
      throw new Error('Not all selected files were finalised correctly. Remove failed files and retry.');
    }

    return documents;
  }

  private preparePaymentElement(clientSecret: string): Observable<void> {
    return from(this.preparePaymentElementAsync(clientSecret));
  }

  private async preparePaymentElementAsync(clientSecret: string): Promise<void> {
    const metadata = await this.metadataConfiguration.getValueAsync();
    const publishableKey = metadata.payments.stripePublishableKey?.trim();
    if (!publishableKey || publishableKey.startsWith('__')) {
      throw new Error('Stripe publishable key is missing. Set /conveymate/dev/stripe/publishableKey in SSM.');
    }

    this.primeStripeLoader(publishableKey);
    this.destroyStripePaymentElement();

    const stripe = await (this.stripeLoaderPromise ?? loadStripe(publishableKey));
    if (!stripe) {
      throw new Error('Could not initialise Stripe. Refresh and try again.');
    }
    this.stripe = stripe;

    this.stripeElements = this.stripe.elements({
      clientSecret,
      appearance: {
        theme: 'stripe',
        labels: 'above',
        variables: {
          colorPrimary: '#0b3c5d',
          colorBackground: '#ffffff',
          colorDanger: '#912018',
          colorText: '#172532',
          colorTextPlaceholder: '#687b8c',
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          spacingUnit: '4px',
          borderRadius: '12px'
        }
      }
    });

    const stageHostElement = await this.waitForPaymentHostAsync('sm-stripe-payment-element-stage');
    this.stripePaymentElement = this.stripeElements.create('payment', {
      layout: {
        type: 'accordion',
        defaultCollapsed: false
      },
      paymentMethodOrder: ['card', 'apple_pay', 'google_pay', 'link'],
      wallets: {
        applePay: 'auto',
        googlePay: 'auto',
        link: 'auto'
      }
    });
    this.stripePaymentElement.mount(stageHostElement);
    await this.waitForPaymentElementReady(this.stripePaymentElement);
  }

  private confirmPaymentWithStripe(): Observable<void> {
    return from(this.confirmPaymentWithStripeAsync()).pipe(
      switchMap((result) => {
        if (result.error) {
          return throwError(() => new Error(result.error.message || 'Payment confirmation failed.'));
        }

        const status = result.paymentIntent?.status?.toLowerCase() ?? '';
        if (status && status !== 'succeeded') {
          return throwError(() => new Error(`Payment is not complete yet. Stripe status: ${status}.`));
        }

        return from(Promise.resolve(void 0));
      })
    );
  }

  private async confirmPaymentWithStripeAsync() {
    if (!this.stripe || !this.stripeElements) {
      throw new Error('Payment form is not ready.');
    }

    return this.stripe.confirmPayment({
      elements: this.stripeElements,
      redirect: 'if_required',
      confirmParams: {
        return_url: window.location.href
      }
    });
  }

  private async waitForPaymentHostAsync(hostId: string): Promise<HTMLElement> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const host = document.getElementById(hostId);
      if (host instanceof HTMLElement) {
        return host;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error('Payment form did not render correctly. Re-open the payment form and try again.');
  }

  private waitForPaymentElementReady(paymentElement: StripePaymentElement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onReady = () => {
        paymentElement.off('ready', onReady);
        paymentElement.off('loaderror', onLoadError);
        resolve();
      };

      const onLoadError = (event: { error?: { message?: string } }) => {
        paymentElement.off('ready', onReady);
        paymentElement.off('loaderror', onLoadError);
        reject(new Error(event.error?.message || 'Stripe checkout could not be loaded.'));
      };

      paymentElement.on('ready', onReady);
      paymentElement.on('loaderror', onLoadError);
    });
  }

  private primeStripeLoader(publishableKey?: string): void {
    const key = publishableKey?.trim();
    if (!key || key.startsWith('__') || this.stripeLoaderPromise) {
      return;
    }

    this.stripeLoaderPromise = loadStripe(key);
  }

  private async mountPaymentElementToHost(hostId: string): Promise<void> {
    if (!this.stripePaymentElement) {
      throw new Error('Payment form is not ready. Retry payment setup.');
    }

    const host = await this.waitForPaymentHostAsync(hostId);
    try {
      this.stripePaymentElement.unmount();
    } catch {
      // ignore unmount errors during remounts
    }

    this.stripePaymentElement.mount(host);
  }

  private forceClosePaymentModal(): void {
    if (!this.paymentModalOpen()) {
      return;
    }

    this.paymentModalOpen.set(false);
    this.paymentModalRendering.set(false);
    this.setPaymentModalViewportLock(false);
    queueMicrotask(() => {
      void this.mountPaymentElementToHost('sm-stripe-payment-element-stage').catch(() => {
        // ignore remount errors and let retry flow recover
      });
    });
    this.restoreModalTriggerFocus();
  }

  openUploadHelpModal(): void {
    this.uploadHelpModalTriggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.uploadHelpModalOpen.set(true);
    this.focusFirstUploadHelpModalElement();
  }

  closeUploadHelpModal(): void {
    if (!this.uploadHelpModalOpen()) {
      return;
    }

    this.uploadHelpModalOpen.set(false);
    this.restoreUploadHelpModalTriggerFocus();
  }

  onUploadHelpModalKeydown(event: KeyboardEvent): void {
    if (!this.uploadHelpModalOpen()) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeUploadHelpModal();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = this.getUploadHelpModalFocusableElements();
    if (focusableElements.length === 0) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement | null;
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusFirstModalElement(): void {
    queueMicrotask(() => {
      this.paymentCloseButtonRef?.nativeElement?.focus();
    });
  }

  private focusFirstFailedJobDialogElement(): void {
    queueMicrotask(() => {
      this.failedJobCloseButtonRef?.nativeElement?.focus();
    });
  }

  private focusFirstUploadHelpModalElement(): void {
    queueMicrotask(() => {
      this.uploadHelpCloseButtonRef?.nativeElement?.focus();
    });
  }

  private getModalFocusableElements(): HTMLElement[] {
    const modal = this.paymentModalRef?.nativeElement;
    if (!modal) {
      return [];
    }

    const selectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ];

    return Array.from(modal.querySelectorAll<HTMLElement>(selectors.join(','))).filter(
      (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1
    );
  }

  private restoreModalTriggerFocus(): void {
    if (this.paymentModalTriggerElement && document.contains(this.paymentModalTriggerElement)) {
      this.paymentModalTriggerElement.focus();
    }

    this.paymentModalTriggerElement = null;
  }

  private getUploadHelpModalFocusableElements(): HTMLElement[] {
    const modal = this.uploadHelpModalRef?.nativeElement;
    if (!modal) {
      return [];
    }

    const selectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ];

    return Array.from(modal.querySelectorAll<HTMLElement>(selectors.join(','))).filter(
      (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1
    );
  }

  private restoreUploadHelpModalTriggerFocus(): void {
    if (this.uploadHelpModalTriggerElement && document.contains(this.uploadHelpModalTriggerElement)) {
      this.uploadHelpModalTriggerElement.focus();
    }

    this.uploadHelpModalTriggerElement = null;
  }

  closeFailedJobDialog(): void {
    this.failedJobDialogOpen.set(false);
  }

  onFailedJobBackdropPressed(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeFailedJobDialog();
    }
  }

  onFailedJobDialogKeydown(event: KeyboardEvent): void {
    if (!this.failedJobDialogOpen()) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeFailedJobDialog();
    }
  }

  private focusStepHeadingSoon(): void {
    queueMicrotask(() => {
      const heading = document.getElementById('wizard-step-heading');
      if (heading instanceof HTMLElement) {
        heading.focus();
      }
    });
  }

  private focusElementById(elementId: string): void {
    queueMicrotask(() => {
      const element = document.getElementById(elementId);
      if (element instanceof HTMLElement) {
        element.focus();
      }
    });
  }

  private destroyStripePaymentElement(): void {
    try {
      this.stripePaymentElement?.unmount();
      this.stripePaymentElement?.destroy();
    } catch {
      // ignore cleanup errors
    }

    this.stripePaymentElement = null;
    this.stripeElements = null;
    this.stripe = null;
    this.paymentFormReady.set(false);
    this.paymentSessionPreparing.set(false);
    this.paymentModalRendering.set(false);
  }

  formatBytes(value: number): string {
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  uploadStatusLabel(status: UploadItem['status']): string {
    switch (status) {
      case 'queued':
        return 'Ready to be uploaded';
      case 'uploading':
        return 'Uploading';
      case 'uploaded':
        return 'Uploaded';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  }

  formatUtcTimestamp(value: string): string {
    if (!value?.trim()) {
      return 'just now';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    const now = Date.now();
    const deltaMs = Math.max(0, now - date.getTime());
    const seconds = Math.floor(deltaMs / 1000);
    if (seconds < 60) {
      return 'just now';
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} hr ago`;
    }

    return date.toLocaleString('en-AU', {
      hour12: true,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short'
    });
  }

  isStateEnabled(stateOrTerritory: string): boolean {
    return this.enabledStates().some((item) => item.toUpperCase() === stateOrTerritory.toUpperCase());
  }

  toStateLabel(stateOrTerritory: string): string {
    return this.isStateEnabled(stateOrTerritory)
      ? stateOrTerritory
      : `${stateOrTerritory} (Coming soon)`;
  }

  private applyEnabledStatesConfiguration(configuration: EnabledStatesConfiguration): void {
    this.supportedStates.set(configuration.supportedStates);
    this.enabledStates.set(configuration.enabledStates);
    this.stateConfigLoading.set(false);
    this.stateConfigError.set('');

    if (!this.isStateEnabled(this.stateOrTerritory)) {
      if (this.isStateEnabled(configuration.defaultState)) {
        this.stateOrTerritory = configuration.defaultState;
      } else if (configuration.enabledStates.length > 0) {
        this.stateOrTerritory = configuration.enabledStates[0];
      }
    }

    this.refreshStateOrTerritoryWarning();
  }

  ngOnDestroy(): void {
    this.paymentModalOpen.set(false);
    this.failedJobDialogOpen.set(false);
    this.uploadHelpModalOpen.set(false);
    this.setPaymentModalViewportLock(false);
    this.restoreModalTriggerFocus();
    this.restoreUploadHelpModalTriggerFocus();
    this.destroyStripePaymentElement();
    this.stopLiveTimers();
    this.propertyAddressInput$.complete();
    this.subscriptions.unsubscribe();
  }

  private resetFreshReportFlowState(): void {
    this.uploadService.clearAll();
    this.stopLiveTimers();
    this.destroyStripePaymentElement();
    this.restoreModalTriggerFocus();
    this.restoreUploadHelpModalTriggerFocus();
    this.selectedAddressStateOrTerritory = '';
    this.addressCommitted = false;

    this.currentStep.set(0);
    this.wizardError.set('');
    this.uploadError.set('');
    this.processingActive.set(false);
    this.processingComplete.set(false);
    this.processingStages.set(this.buildStages('AwaitingUpload', 'AwaitingUpload'));
    this.createdReportId.set('');
    this.stepErrors.set(this.emptyStepErrors());
    this.pipelineMessage.set('');
    this.pipelineStatusValue.set('AwaitingUpload');
    this.pipelineCurrentStepValue.set('AwaitingUpload');
    this.pipelineStepLabel.set('Awaiting upload');
    this.pipelineSubStep.set('');
    this.pipelineStartedAtUtc.set('');
    this.pipelineLastUpdatedUtc.set('');
    this.processingPercent.set(0);
    this.disclaimerAcceptedAtUtc.set('');
    this.activityEvents.set([]);
    this.activityExpanded.set(false);
    this.uploadsPrepared.set(false);
    this.awaitingPaymentConfirmation.set(false);
    this.paymentActionInFlight.set(false);
    this.paymentError.set('');
    this.paymentModalOpen.set(false);
    this.failedJobDialogOpen.set(false);
    this.uploadHelpModalOpen.set(false);
    this.paymentFormReady.set(false);
    this.paymentSessionPreparing.set(false);
    this.paymentModalRendering.set(false);
    this.addressSuggestions.set([]);
    this.addressLookupLoading.set(false);
    this.addressManualEntry.set(false);

    this.propertyAddress = '';
    this.buyerType = 'owner-occupier';
    this.isFirstHomeBuyer = null;
    this.concessionIntent = 'unsure';
    this.contractExchanged = null;
    this.agreedPriceAud = null;
    this.estimatedPriceAud = null;
    this.acceptedDisclaimer = false;

    this.lastProgressEventCursorUtc = null;
    this.lastResolvedStageId = '';
    this.lastHeartbeatAtMs = 0;
    this.failedJobDialogShownForReportId = '';
    this.seenSingletonBackendDetailCodes.clear();
  }

  private stopLiveTimers(): void {
    if (this.liveClockIntervalId !== null) {
      window.clearInterval(this.liveClockIntervalId);
      this.liveClockIntervalId = null;
    }
    if (this.heartbeatIntervalId !== null) {
      window.clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  toggleActivityPanel(): void {
    const next = !this.activityExpanded();
    this.activityExpanded.set(next);
    if (next) {
      this.scheduleActivityAutoscroll();
    }
  }

  stageStateLabel(state: ProcessingStage['state']): string {
    switch (state) {
      case 'complete':
        return 'Complete';
      case 'running':
        return 'Running';
      case 'warning':
        return 'Warning';
      case 'failed':
        return 'Failed';
      case 'retrying':
        return 'Retrying';
      default:
        return 'Queued';
    }
  }

  stageGlyph(state: ProcessingStage['state']): string {
    switch (state) {
      case 'complete':
        return '✓';
      case 'running':
        return '•';
      case 'warning':
        return '!';
      case 'failed':
        return '✕';
      case 'retrying':
        return '↻';
      default:
        return '·';
    }
  }

  isFocusedProcessingStage(stage: ProcessingStage): boolean {
    const active = this.activeProcessingStage();
    return !!active && this.normalizePipelineKey(stage.id) === this.normalizePipelineKey(active.id);
  }

  pipelineStatusLabel(): string {
    const status = this.normalizePipelineKey(this.pipelineStatusValue());
    if (status === 'completed' || this.processingComplete()) {
      return 'Completed';
    }
    if (status === 'failed') {
      return 'Failed';
    }
    if (status === 'awaitingpayment') {
      return 'Awaiting payment';
    }
    if (status === 'queued') {
      return 'Queued';
    }
    if (['extracting', 'indexing', 'analyzing', 'validating', 'rendering'].includes(status)) {
      return 'Running';
    }
    return 'In progress';
  }

  pipelineStatusChipClass(): string {
    const status = this.normalizePipelineKey(this.pipelineStatusValue());
    if (status === 'completed' || this.processingComplete()) {
      return 'pipeline-status-chip is-complete';
    }
    if (status === 'failed') {
      return 'pipeline-status-chip is-failed';
    }
    if (status === 'awaitingpayment' || status === 'queued') {
      return 'pipeline-status-chip is-queued';
    }
    return 'pipeline-status-chip is-running';
  }

  pipelineStatusIsFailed(): boolean {
    return this.normalizePipelineKey(this.pipelineStatusValue()) === 'failed';
  }

  reportReferenceLabel(): string {
    const value = this.createdReportId().trim();
    if (!value) {
      return 'Pending';
    }

    return value.slice(0, 8).toUpperCase();
  }

  stepFourIntroText(): string {
    if (this.awaitingPaymentConfirmation()) {
      return 'Complete secure checkout to start the report. Live stage updates appear here as soon as payment clears.';
    }
    if (this.processingComplete()) {
      return 'The pipeline has finished. Open the completed report below.';
    }
    if (this.pipelineStatusIsFailed()) {
      return 'We’re sorry. The pipeline stopped before completion. A ConveyMate engineer has been notified and will review the failed run.';
    }

    return 'The pipeline is live. Watch the hand-offs and worker updates below.';
  }

  pipelinePreviewStages(): ProcessingStage[] {
    const stages = this.processingStages().filter((stage) => {
      const key = this.normalizePipelineKey(stage.id);
      return key !== 'awaitingupload' && key !== 'awaitingpayment';
    });
    return stages.length ? stages : this.processingStages();
  }

  pipelineHeroTitle(): string {
    if (this.processingComplete()) {
      return 'Report ready';
    }
    if (this.pipelineStatusIsFailed()) {
      return `${this.pipelineStepLabel()} needs attention`;
    }
    if (this.normalizePipelineKey(this.pipelineStatusValue()) === 'queued') {
      return 'Queued for processing';
    }

    return this.pipelineStepLabel() || 'Processing';
  }

  pipelineHeroCopy(): string {
    if (this.processingComplete()) {
      return 'All processing stages finished successfully and the report outputs are ready.';
    }
    if (this.pipelineStatusIsFailed()) {
      return this.failureSummaryMessage();
    }

    return this.activeProcessingStage()?.description || this.pipelineMessage() || 'The report pipeline is in progress.';
  }

  pipelineHeroDetail(): string {
    if (this.pipelineStatusIsFailed()) {
      return '';
    }
    if (this.processingComplete()) {
      return 'Open the report to review and download the finished output.';
    }

    return this.pipelineSubStep().trim();
  }

  completedStageSummary(): string {
    const trackableStages = this.processingStages().filter((stage) => this.normalizePipelineKey(stage.id) !== 'completed');
    if (!trackableStages.length) {
      return 'Tracking live stages';
    }

    const completed = trackableStages.filter((stage) => stage.state === 'complete').length;
    return `${completed} of ${trackableStages.length} stages completed`;
  }

  nextStageLabel(): string {
    if (this.processingComplete()) {
      return 'Open report';
    }
    if (this.pipelineStatusIsFailed()) {
      return 'Restart report';
    }

    return this.nextProcessingStage()?.label || 'Final checks';
  }

  pipelineElapsedLabel(): string {
    const startedAt = this.pipelineStartedAtUtc().trim();
    if (!startedAt) {
      return '--';
    }

    const startDate = new Date(startedAt);
    if (Number.isNaN(startDate.getTime())) {
      return '--';
    }

    let endMs = this.nowTickMs();
    if (this.processingComplete() || this.pipelineStatusIsFailed()) {
      const completedAt = this.pipelineLastUpdatedUtc().trim();
      if (completedAt) {
        const completedDate = new Date(completedAt);
        if (!Number.isNaN(completedDate.getTime())) {
          endMs = completedDate.getTime();
        }
      }
    }

    return this.formatElapsedDuration(endMs - startDate.getTime());
  }

  etaLabel(): string {
    if (this.processingComplete()) {
      return 'Report completed.';
    }
    if (this.pipelineStatusIsFailed()) {
      return 'Processing stopped due to an error.';
    }

    const minutes = Math.max(1, Math.round(this.pipelineModel().typicalDurationMinutes || this.fallbackPipelineModel.typicalDurationMinutes));
    return `Usually takes ~${minutes} minutes.`;
  }

  latestActivityMessage(): string {
    const entries = this.activityEvents();
    const latest = entries[entries.length - 1];
    if (!latest) {
      return 'No activity yet. Updates appear here once processing starts.';
    }

    return `${latest.message} (${this.activityTimestamp(latest.timestampUtc)})`;
  }

  recentActivityEvents(): ActivityFeedItem[] {
    return [...this.activityEvents()].slice(-3).reverse();
  }

  failureSummaryMessage(): string {
    const stage = this.resolveFailureStageLabel(this.pipelineStatusValue(), this.pipelineCurrentStepValue(), this.processingPercent());
    return `We’re sorry. The pipeline failed during ${stage}. Please don’t panic. A ConveyMate engineer has already been notified and will review this failed run.`;
  }

  failureSupportMailto(): string {
    const reference = this.reportReferenceLabel();
    const subject = `ConveyMate report failure (${reference})`;
    const body =
      `Report reference: ${reference}\n` +
      `Stage: ${this.pipelineStepLabel()}\n` +
      `Technical details: ${this.failureTechnicalDetails()}\n`;
    return `mailto:support@conveymate.com.au?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  failureTechnicalDetails(): string {
    const latestErrorEvent = [...this.activityEvents()].reverse().find((entry) => entry.severity === 'error' && entry.technicalDetails);
    if (latestErrorEvent?.technicalDetails?.trim()) {
      return latestErrorEvent.technicalDetails;
    }

    return this.pipelineSubStep().trim() || 'No technical details were provided by the backend.';
  }

  failureGuidanceMessage(): string {
    return 'Please do not pay for another run yet. We will investigate and issue a refund if the failed run is confirmed.';
  }

  relativeTime(value: string): string {
    if (!value?.trim()) {
      return 'Just now';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    const deltaMs = Math.max(0, this.nowTickMs() - date.getTime());
    const seconds = Math.floor(deltaMs / 1000);
    if (seconds < 5) {
      return 'Just now';
    }
    if (seconds < 60) {
      return `${seconds}s ago`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }

    return `${Math.floor(hours / 24)}d ago`;
  }

  activityTimestamp(value: string): string {
    if (!value?.trim()) {
      return '--:--:--';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '--:--:--';
    }

    return date.toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  openPaymentModal(): void {
    if (!this.canOpenPaymentModal() || !this.stripePaymentElement) {
      return;
    }

    this.paymentModalTriggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.paymentModalOpen.set(true);
    this.paymentModalRendering.set(true);
    this.paymentError.set('');
    this.setPaymentModalViewportLock(true);

    queueMicrotask(() => {
      void this.mountPaymentElementToHost('sm-stripe-payment-element-modal')
        .then(() => {
          this.paymentModalRendering.set(false);
          this.focusFirstModalElement();
        })
        .catch((error) => {
          this.paymentModalRendering.set(false);
          this.forceClosePaymentModal();
          this.paymentError.set(error.message);
        });
    });
  }

  closePaymentModal(): void {
    if (this.paymentActionInFlight() || this.paymentModalRendering()) {
      return;
    }

    this.forceClosePaymentModal();
  }

  onPaymentBackdropPressed(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.focusFirstModalElement();
    }
  }

  onUploadHelpBackdropPressed(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeUploadHelpModal();
    }
  }

  onPaymentModalKeydown(event: KeyboardEvent): void {
    if (!this.paymentModalOpen()) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closePaymentModal();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = this.getModalFocusableElements();
    if (focusableElements.length === 0) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement | null;
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private setPaymentModalViewportLock(locked: boolean): void {
    if (typeof document === 'undefined') {
      return;
    }

    const { body, documentElement } = document;
    if (locked) {
      if (this.previousBodyOverflow === null) {
        this.previousBodyOverflow = body.style.overflow;
      }
      if (this.previousHtmlOverflow === null) {
        this.previousHtmlOverflow = documentElement.style.overflow;
      }

      body.style.overflow = 'hidden';
      documentElement.style.overflow = 'hidden';
      return;
    }

    if (this.previousBodyOverflow !== null) {
      body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
    }
    if (this.previousHtmlOverflow !== null) {
      documentElement.style.overflow = this.previousHtmlOverflow;
      this.previousHtmlOverflow = null;
    }
  }

  private updatePipelineFromDetail(detail: ReportDetail): void {
    const pipelineStatus = (detail.pipelineStatus || detail.currentStep || 'AwaitingUpload').trim();
    const currentStep = (detail.currentStep || detail.pipelineStatus || 'AwaitingUpload').trim();
    const lastUpdatedUtc = detail.lastUpdatedUtc || detail.updatedAt || new Date().toISOString();
    const statusKey = this.normalizePipelineKey(pipelineStatus);
    const isFailed = statusKey === 'failed' || detail.status === 'failed';
    const resolvedStageId = isFailed
      ? this.resolveFailureStageId(pipelineStatus, currentStep, detail.percentComplete)
      : this.resolveStageId(pipelineStatus, currentStep, detail.percentComplete);
    const stageLabel = this.toDisplayPipelineStep(resolvedStageId);
    if (detail.startedAt?.trim()) {
      this.pipelineStartedAtUtc.set(detail.startedAt.trim());
    } else if (statusKey === 'awaitingpayment' || statusKey === 'awaitingupload' || detail.status === 'draft') {
      this.pipelineStartedAtUtc.set('');
    }

    this.pipelineStatusValue.set(pipelineStatus);
    this.pipelineCurrentStepValue.set(resolvedStageId);
    this.pipelineStepLabel.set(stageLabel);
    this.pipelineSubStep.set(detail.currentSubStep || '');
    this.pipelineLastUpdatedUtc.set(lastUpdatedUtc);
    this.processingPercent.set(this.resolveConsistentPercent(detail.percentComplete, pipelineStatus, resolvedStageId));
    this.processingStages.set(this.buildStages(pipelineStatus, resolvedStageId, detail.percentComplete));
    this.disclaimerVersion.set(detail.disclaimerVersion || this.disclaimerVersion());
    this.disclaimerAcceptedAtUtc.set(detail.disclaimerAcceptedAtUtc || this.disclaimerAcceptedAtUtc());
    this.appendStageTransitionActivity(pipelineStatus, resolvedStageId, lastUpdatedUtc);
    this.pullProgressEvents(detail.id);

    if (detail.status === 'ready') {
      this.awaitingPaymentConfirmation.set(false);
      this.paymentActionInFlight.set(false);
      this.forceClosePaymentModal();
      this.pipelineMessage.set('Processing complete. Your report is ready.');
      if (!this.pipelineSubStep()) {
        this.pipelineSubStep.set('Report outputs are finalised and available for download.');
      }
      this.processingComplete.set(true);
      this.processingActive.set(false);
      this.pushActivity({
        id: `ui-complete-${Date.now()}`,
        timestampUtc: new Date().toISOString(),
        stageId: 'Completed',
        stageState: 'complete',
        severity: 'info',
        message: 'Completed: Report outputs are ready.'
      });
      return;
    }

    if (detail.status === 'failed') {
      this.awaitingPaymentConfirmation.set(false);
      this.paymentActionInFlight.set(false);
      this.forceClosePaymentModal();
      this.pipelineMessage.set('Processing failed.');
      if (!this.pipelineSubStep() && detail.errorMessage?.trim()) {
        this.pipelineSubStep.set(detail.errorMessage.trim());
      }
      this.processingComplete.set(false);
      this.processingActive.set(false);
      this.pushActivity({
        id: `ui-failed-${Date.now()}`,
        timestampUtc: new Date().toISOString(),
        stageId: resolvedStageId,
        stageState: 'failed',
        severity: 'error',
        message: `Failed: ${this.resolveFailureStageLabel(pipelineStatus, currentStep, detail.percentComplete)}`,
        technicalDetails: detail.errorMessage || this.pipelineSubStep()
      });
      this.openFailedJobDialog(detail.id);
      return;
    }

    if (this.normalizePipelineKey(pipelineStatus) === 'awaitingpayment') {
      this.pipelineMessage.set('Waiting for payment confirmation...');
      if (!this.pipelineSubStep()) {
        this.pipelineSubStep.set('Payment has not been confirmed yet.');
      }
      this.awaitingPaymentConfirmation.set(true);
      this.paymentSessionPreparing.set(false);
      this.processingComplete.set(false);
      return;
    }

    if (this.awaitingPaymentConfirmation()) {
      this.destroyStripePaymentElement();
    }

    this.awaitingPaymentConfirmation.set(false);
    this.forceClosePaymentModal();
    this.paymentActionInFlight.set(false);
    this.processingComplete.set(false);
    this.pipelineMessage.set(`Processing stage: ${stageLabel}.`);
    if (!this.pipelineSubStep()) {
      this.pipelineSubStep.set('Processing is underway.');
    }
  }

  private openFailedJobDialog(jobId: string): void {
    if (!jobId || this.failedJobDialogShownForReportId === jobId) {
      return;
    }

    this.failedJobDialogShownForReportId = jobId;
    this.failedJobDialogOpen.set(true);
    this.focusFirstFailedJobDialogElement();
  }

  private loadPipelineModel(): void {
    this.pipelineModelLoading.set(true);
    const modelSub = this.reportService.getPipelineModel().subscribe({
      next: (model) => {
        if (!model.steps.length) {
          this.pipelineModel.set(this.fallbackPipelineModel);
          this.pipelineModelError.set('Pipeline model is unavailable. Showing fallback stage mapping.');
        } else {
          this.pipelineModel.set(model);
          this.pipelineModelError.set('');
        }

        this.disclaimerVersion.set(this.pipelineModel().disclaimerVersion || this.fallbackPipelineModel.disclaimerVersion);
        this.processingStages.set(this.buildStages(this.pipelineStatusValue(), this.pipelineCurrentStepValue()));
        this.pipelineModelLoading.set(false);
      },
      error: (error: Error) => {
        this.pipelineModel.set(this.fallbackPipelineModel);
        this.pipelineModelError.set(error.message);
        this.disclaimerVersion.set(this.fallbackPipelineModel.disclaimerVersion);
        this.pipelineModelLoading.set(false);
      }
    });

    this.subscriptions.add(modelSub);
  }

  private startLiveClock(): void {
    this.nowTickMs.set(Date.now());
    if (this.liveClockIntervalId !== null) {
      return;
    }

    this.liveClockIntervalId = window.setInterval(() => {
      this.nowTickMs.set(Date.now());
    }, 1000);
  }

  private startHeartbeatTicker(): void {
    if (this.heartbeatIntervalId !== null) {
      return;
    }

    this.heartbeatIntervalId = window.setInterval(() => {
      this.appendHeartbeatIfQuiet();
    }, 5000);
  }

  private appendHeartbeatIfQuiet(): void {
    if (!this.processingActive() || this.processingComplete() || this.pipelineStatusIsFailed()) {
      return;
    }

    const status = this.normalizePipelineKey(this.pipelineStatusValue());
    if (status === 'awaitingpayment') {
      return;
    }

    const lastUpdated = new Date(this.pipelineLastUpdatedUtc() || Date.now());
    if (Number.isNaN(lastUpdated.getTime())) {
      return;
    }

    const nowMs = Date.now();
    const secondsSinceLastUpdate = Math.floor((nowMs - lastUpdated.getTime()) / 1000);
    if (secondsSinceLastUpdate < 45 || nowMs - this.lastHeartbeatAtMs < 45000) {
      return;
    }

    this.lastHeartbeatAtMs = nowMs;
    const stageLabel = this.pipelineStepLabel() || this.toDisplayPipelineStep(this.pipelineStatusValue());
    this.pushActivity({
      id: `ui-heartbeat-${nowMs}`,
      timestampUtc: new Date(nowMs).toISOString(),
      stageId: this.pipelineStatusValue(),
      stageState: status === 'queued' ? 'queued' : 'running',
      severity: 'info',
      message: `Still working: ${stageLabel} (last update ${secondsSinceLastUpdate}s ago).`,
      isHeartbeat: true
    });
  }

  private pullProgressEvents(jobId: string): void {
    if (!jobId || this.progressEventsLoading) {
      return;
    }

    this.progressEventsLoading = true;
    const eventsSub = this.reportService.getReviewProgressEvents(jobId, this.lastProgressEventCursorUtc, 120).subscribe({
      next: (events) => this.appendBackendEvents(events),
      error: () => {
        this.progressEventsLoading = false;
      },
      complete: () => {
        this.progressEventsLoading = false;
      }
    });

    this.subscriptions.add(eventsSub);
  }

  private appendBackendEvents(events: PipelineProgressEvent[]): void {
    if (!events.length) {
      return;
    }

    const ordered = [...events].sort((a, b) => {
      const delta = new Date(a.timestampUtc).getTime() - new Date(b.timestampUtc).getTime();
      if (delta !== 0) {
        return delta;
      }
      return a.id - b.id;
    });

    for (const event of ordered) {
      this.lastProgressEventCursorUtc = this.maxTimestamp(this.lastProgressEventCursorUtc, event.timestampUtc);
      const stageLabel = this.toDisplayPipelineStep(event.stageId);
      const effectiveStageLabel = this.normalizePipelineKey(stageLabel) === 'failed'
        ? this.resolveFailureStageLabel(this.pipelineStatusValue(), this.pipelineCurrentStepValue())
        : stageLabel;
      const detailCode = (event.detailCode || '').trim().toLowerCase();
      if (detailCode === 'payment_intent_created') {
        if (this.seenSingletonBackendDetailCodes.has(detailCode)) {
          continue;
        }

        this.seenSingletonBackendDetailCodes.add(detailCode);
      }

      let message = (event.message || '').trim();
      if (!message) {
        if (event.stageState === 'retrying') {
          message = event.attempt && event.maxAttempts
            ? `Retrying: ${effectiveStageLabel} (attempt ${event.attempt} of ${event.maxAttempts})`
            : `Retrying: ${effectiveStageLabel}`;
        } else if (event.stageState === 'complete') {
          message = `Completed: ${effectiveStageLabel}`;
        } else if (event.stageState === 'running' || event.stageState === 'queued') {
          message = `Started: ${effectiveStageLabel}`;
        } else if (event.stageState === 'failed') {
          message = `Failed: ${effectiveStageLabel}`;
        } else {
          message = `${effectiveStageLabel} updated.`;
        }
      }
      message = this.formatActivityMessage(message, effectiveStageLabel, event.stageState, detailCode);

      let technicalDetails: string | undefined;
      if (event.severity === 'error' && this.looksTechnical(message)) {
        technicalDetails = message;
        message = `Error while ${effectiveStageLabel}.`;
      }

      this.pushActivity({
        id: `api-${event.id}`,
        timestampUtc: event.timestampUtc,
        stageId: event.stageId,
        stageState: event.stageState,
        severity: event.severity,
        message,
        technicalDetails
      });
    }

    this.processingStages.set(this.buildStages(this.pipelineStatusValue(), this.pipelineCurrentStepValue(), this.processingPercent()));
  }

  private appendStageTransitionActivity(pipelineStatus: string, currentStep: string, timestampUtc: string): void {
    const statusKey = this.normalizePipelineKey(pipelineStatus);
    const stageId = this.resolveStageId(pipelineStatus, currentStep);
    if (!stageId || statusKey === 'failed') {
      return;
    }

    if (!this.lastResolvedStageId) {
      this.lastResolvedStageId = stageId;
      this.pushActivity({
        id: `ui-stage-start-${stageId}-${timestampUtc}`,
        timestampUtc,
        stageId,
        stageState: this.toDefaultStageState(stageId),
        severity: 'info',
        message: `Started: ${this.toDisplayPipelineStep(stageId)}`
      });
      return;
    }

    if (this.normalizePipelineKey(this.lastResolvedStageId) === this.normalizePipelineKey(stageId)) {
      return;
    }

    this.pushActivity({
      id: `ui-stage-complete-${this.lastResolvedStageId}-${timestampUtc}`,
      timestampUtc,
      stageId: this.lastResolvedStageId,
      stageState: 'complete',
      severity: 'info',
      message: `Completed: ${this.toDisplayPipelineStep(this.lastResolvedStageId)}`
    });
    this.pushActivity({
      id: `ui-stage-start-${stageId}-${timestampUtc}`,
      timestampUtc,
      stageId,
      stageState: this.toDefaultStageState(stageId),
      severity: 'info',
      message: `Started: ${this.toDisplayPipelineStep(stageId)}`
    });

    this.lastResolvedStageId = stageId;
  }

  private pushActivity(item: ActivityFeedItem): void {
    this.activityEvents.update((entries) => {
      if (entries.some((entry) => entry.id === item.id) || this.hasDuplicateActivity(entries, item)) {
        return entries;
      }

      const merged = [...entries, item]
        .slice()
        .sort((left, right) => this.compareActivityChronology(left, right));
      return merged.slice(-120);
    });

    this.scheduleActivityAutoscroll();
  }

  private scheduleActivityAutoscroll(): void {
    if (!this.activityExpanded()) {
      return;
    }

    window.requestAnimationFrame(() => {
      this.scrollActivityToBottom();
      window.requestAnimationFrame(() => this.scrollActivityToBottom());
    });

    window.setTimeout(() => this.scrollActivityToBottom(), 0);
  }

  private scrollActivityToBottom(): void {
    const region = this.activityScrollRegionRef?.nativeElement;
    if (!region) {
      return;
    }

    region.scrollTop = region.scrollHeight;
  }

  private hasDuplicateActivity(entries: ReadonlyArray<ActivityFeedItem>, item: ActivityFeedItem): boolean {
    if (item.isHeartbeat) {
      return false;
    }

    const signature = this.activitySignature(item);
    return entries.some((entry) => !entry.isHeartbeat && this.activitySignature(entry) === signature);
  }

  private activitySignature(item: ActivityFeedItem): string {
    return [
      this.normalizePipelineKey(item.stageId),
      item.stageState,
      item.severity,
      this.normalizeActivityText(item.message),
      this.normalizeActivityText(item.technicalDetails)
    ].join('|');
  }

  private normalizeActivityText(value: string | undefined): string {
    return (value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private compareActivityChronology(left: ActivityFeedItem, right: ActivityFeedItem): number {
    const leftTime = new Date(left.timestampUtc).getTime();
    const rightTime = new Date(right.timestampUtc).getTime();
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return left.id.localeCompare(right.id);
  }

  private formatActivityMessage(message: string, stageLabel: string, stageState: PipelineStageState, detailCode: string): string {
    const normalizedMessage = message.trim().replace(/\s+/g, ' ');
    if (!normalizedMessage) {
      return message;
    }

    const isLifecycleMessage =
      normalizedMessage.startsWith('Started:')
      || normalizedMessage.startsWith('Completed:')
      || normalizedMessage.startsWith('Failed:')
      || normalizedMessage.startsWith('Retrying:')
      || normalizedMessage.startsWith('Still working:');
    if (isLifecycleMessage) {
      return normalizedMessage;
    }

    const normalizedDetailCode = detailCode.trim().toLowerCase();
    const shouldPrefixStage =
      normalizedDetailCode === 'progress_update'
      || stageState === 'running'
      || stageState === 'warning';
    if (!shouldPrefixStage) {
      return normalizedMessage;
    }

    return this.prefixActivityStage(stageLabel, normalizedMessage);
  }

  private prefixActivityStage(stageLabel: string, message: string): string {
    const normalizedStage = this.normalizePipelineKey(stageLabel);
    if (!normalizedStage) {
      return message;
    }

    const normalizedMessage = this.normalizePipelineKey(message);
    if (normalizedMessage.startsWith(normalizedStage) || normalizedMessage.includes(normalizedStage)) {
      return message;
    }

    return `${stageLabel}: ${message}`;
  }

  private resolveConsistentPercent(percent: number, pipelineStatus: string, currentStep: string): number {
    const fallback = Math.max(0, Math.min(100, Math.round(percent)));
    const stageId = this.resolveStageId(pipelineStatus, currentStep, percent);
    const stage = this.pipelineModel().steps.find((step) => this.normalizePipelineKey(step.id) === this.normalizePipelineKey(stageId));
    if (!stage) {
      return fallback;
    }

    const statusKey = this.normalizePipelineKey(pipelineStatus);
    if (statusKey === 'completed') {
      return 100;
    }

    if (statusKey === 'failed') {
      return Math.max(stage.progressStartPercent, fallback);
    }

    return Math.max(stage.progressStartPercent, Math.min(stage.progressEndPercent, fallback));
  }

  private buildStages(pipelineStatus: string, currentStep = '', percentHint?: number): ProcessingStage[] {
    const steps = [...this.pipelineModel().steps].sort((a, b) => a.order - b.order);
    if (!steps.length) {
      return [];
    }

    const statusKey = this.normalizePipelineKey(pipelineStatus);
    const activeStageId = this.resolveStageId(pipelineStatus, currentStep, percentHint);
    const activeIndex = steps.findIndex((step) => this.normalizePipelineKey(step.id) === this.normalizePipelineKey(activeStageId));
    const resolvedActiveIndex = activeIndex >= 0 ? activeIndex : 0;

    return steps.map((step, index) => {
      let state: ProcessingStage['state'] = 'queued';
      if (statusKey === 'completed' || index < resolvedActiveIndex) {
        state = 'complete';
      } else if (index === resolvedActiveIndex) {
        state = statusKey === 'failed' ? 'failed' : this.resolveActiveStageState(step.id, statusKey);
      }

      return {
        id: step.id,
        label: step.label,
        description: step.description,
        phase: step.phase,
        progressStartPercent: step.progressStartPercent,
        progressEndPercent: step.progressEndPercent,
        state
      };
    });
  }

  private activeProcessingStage(): ProcessingStage | undefined {
    const stages = this.processingStages();
    const active = stages.find((stage) => ['running', 'retrying', 'warning', 'failed'].includes(stage.state));
    if (active) {
      return active;
    }

    const currentKey = this.normalizePipelineKey(this.pipelineCurrentStepValue() || this.pipelineStatusValue());
    return stages.find((stage) => this.normalizePipelineKey(stage.id) === currentKey)
      || stages.find((stage) => stage.state === 'queued')
      || stages[stages.length - 1];
  }

  private nextProcessingStage(): ProcessingStage | undefined {
    const stages = this.processingStages();
    if (!stages.length) {
      return undefined;
    }

    const active = this.activeProcessingStage();
    if (!active) {
      return stages.find((stage) => stage.state === 'queued');
    }

    const activeIndex = stages.findIndex((stage) => stage.id === active.id);
    return stages.slice(activeIndex + 1).find((stage) => stage.state === 'queued');
  }

  private formatElapsedDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    if (totalSeconds < 10) {
      return 'Just started';
    }

    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    }

    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }

  private resolveActiveStageState(stageId: string, statusKey: string): ProcessingStage['state'] {
    const activityEntries = typeof this.activityEvents === 'function' ? this.activityEvents() : [];
    const latest = [...activityEntries].reverse().find((event) => this.normalizePipelineKey(event.stageId) === this.normalizePipelineKey(stageId));
    if (latest?.stageState === 'warning' || latest?.stageState === 'retrying' || latest?.stageState === 'failed') {
      return latest.stageState;
    }

    const currentSubStep = typeof this.pipelineSubStep === 'function' ? this.pipelineSubStep().toLowerCase() : '';
    if (currentSubStep.includes('retry')) {
      return 'retrying';
    }

    if (statusKey === 'awaitingupload' || statusKey === 'awaitingpayment' || statusKey === 'queued') {
      return 'queued';
    }

    return 'running';
  }

  private resolveStageId(pipelineStatus: string, currentStep: string, percentHint?: number): string {
    const steps = this.pipelineModel().steps;
    const statusKey = this.normalizePipelineKey(pipelineStatus);
    const currentStepKey = this.normalizePipelineKey(currentStep);

    if (statusKey === 'failed') {
      return this.resolveFailureStageId(pipelineStatus, currentStep, percentHint);
    }

    const statusMatch = steps.find((step) => this.normalizePipelineKey(step.id) === statusKey);
    const stepMatch = steps.find((step) => this.normalizePipelineKey(step.id) === currentStepKey);
    if (statusMatch && stepMatch && this.normalizePipelineKey(statusMatch.id) !== this.normalizePipelineKey(stepMatch.id)) {
      const boundedPercent = Math.max(0, Math.min(100, Math.round(percentHint ?? this.processingPercent())));
      const inStatusRange = this.stageContainsPercent(statusMatch, boundedPercent);
      const inStepRange = this.stageContainsPercent(stepMatch, boundedPercent);
      if (inStepRange && !inStatusRange) {
        return stepMatch.id;
      }
      if (inStatusRange && !inStepRange) {
        return statusMatch.id;
      }
    }

    if (stepMatch) {
      return stepMatch.id;
    }

    if (statusMatch) {
      return statusMatch.id;
    }

    return steps[0]?.id ?? pipelineStatus;
  }

  private stageContainsPercent(stage: { progressStartPercent: number; progressEndPercent: number }, percent: number): boolean {
    return percent >= stage.progressStartPercent && percent <= stage.progressEndPercent;
  }

  private resolveFailureStageId(pipelineStatus: string, currentStep: string, percentHint?: number): string {
    const steps = this.pipelineModel().steps;
    if (!steps.length) {
      return 'Processing';
    }

    const pickKnownStage = (value: string): string => {
      const key = this.normalizePipelineKey(value);
      if (!key || key === 'failed' || key === 'completed') {
        return '';
      }

      const match = steps.find((step) => this.normalizePipelineKey(step.id) === key);
      return match?.id ?? '';
    };

    const currentMatch = pickKnownStage(currentStep);
    if (currentMatch) {
      return currentMatch;
    }

    const latestFailureEvent = [...this.activityEvents()]
      .reverse()
      .find((event) => (event.stageState === 'failed' || event.severity === 'error') && Boolean(pickKnownStage(event.stageId)));
    const eventMatch = latestFailureEvent ? pickKnownStage(latestFailureEvent.stageId) : '';
    if (eventMatch) {
      return eventMatch;
    }

    const lastResolvedMatch = pickKnownStage(this.lastResolvedStageId);
    if (lastResolvedMatch) {
      return lastResolvedMatch;
    }

    const statusMatch = pickKnownStage(pipelineStatus);
    if (statusMatch) {
      return statusMatch;
    }

    const boundedPercent = Math.max(0, Math.min(100, Math.round(percentHint ?? this.processingPercent())));
    const percentStage = [...steps]
      .sort((a, b) => a.order - b.order)
      .find(
        (step) =>
          this.normalizePipelineKey(step.id) !== 'completed'
          && boundedPercent >= step.progressStartPercent
          && boundedPercent <= step.progressEndPercent
      );
    if (percentStage) {
      return percentStage.id;
    }

    const analysisFallback = steps.find((step) => {
      const key = this.normalizePipelineKey(step.id);
      return key !== 'awaitingupload' && key !== 'awaitingpayment' && key !== 'queued' && key !== 'completed';
    });
    return analysisFallback?.id ?? steps[0].id;
  }

  private toDefaultStageState(stageId: string): PipelineStageState {
    const key = this.normalizePipelineKey(stageId);
    if (key === 'awaitingupload' || key === 'awaitingpayment' || key === 'queued') {
      return 'queued';
    }
    if (key === 'completed') {
      return 'complete';
    }
    return 'running';
  }

  private resolveFailureStageLabel(pipelineStatus: string, currentStep: string, percentHint?: number): string {
    const stageId = this.resolveFailureStageId(pipelineStatus, currentStep, percentHint);
    const stageKey = this.normalizePipelineKey(stageId);
    if (!stageKey || stageKey === 'failed' || stageKey === 'completed') {
      return 'Processing';
    }

    return this.toDisplayPipelineStep(stageId);
  }

  private maxTimestamp(current: string | null, incoming: string): string {
    if (!current) {
      return incoming;
    }

    const currentTime = new Date(current).getTime();
    const incomingTime = new Date(incoming).getTime();
    if (Number.isNaN(currentTime) || Number.isNaN(incomingTime)) {
      return incoming || current;
    }

    return incomingTime >= currentTime ? incoming : current;
  }

  private looksTechnical(message: string): boolean {
    return /(exception|stack|trace|system\.|invalidoperation|http\s*\d{3}|timeout|npgsql)/i.test(message);
  }

  private toDisplayPipelineStep(step: string): string {
    const normalized = this.normalizePipelineKey(step);
    const stage = this.pipelineModel().steps.find((item) => this.normalizePipelineKey(item.id) === normalized);
    if (stage) {
      return stage.label;
    }

    if (normalized === 'failed') {
      return 'Failed';
    }

    if (!step?.trim()) {
      return 'Pending';
    }

    return step;
  }

  private normalizePipelineKey(value: string): string {
    return (value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  private toPriceLabel(priceAudCents: number, currency: string): string {
    const normalizedCurrency = (currency || 'aud').toUpperCase();
    const dollars = (priceAudCents / 100).toFixed(2);
    return `${normalizedCurrency} ${dollars}`;
  }
}
