import { DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ConveyancerDirectoryItem, JurisdictionCode } from '@shared-core/models/conveyancer.models';
import { QuoteRequestSummary } from '@shared-core/models/quote-request.models';
import { QuoteRequestService } from '@shared-core/services/quote-request.service';
import { ReportDetail } from '@shared-core/models/report.models';
import { ReportService } from '@shared-core/services/report.service';
import { ConveyancerDirectoryService } from '@shared-core/services/conveyancer-directory.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';

type ServiceNeed = 'pre-exchange-review' | 'full-conveyancing' | 'settlement-only';
type QuoteWorkflowStep = 1 | 2 | 3;
type RequestBuilderStep = 1 | 2 | 3;
type BriefDraftSource = 'report' | 'custom';

interface JurisdictionOption {
  code: JurisdictionCode;
  label: string;
}

interface ServiceOption {
  value: ServiceNeed;
  label: string;
  description: string;
  timingHint: string;
}

interface WorkflowStepItem {
  step: QuoteWorkflowStep;
  label: string;
  description: string;
}

interface RequestBuilderStepItem {
  step: RequestBuilderStep;
  label: string;
  description: string;
}

interface BriefDraftItem {
  id: string;
  value: string;
  source: BriefDraftSource;
}

const JURISDICTION_OPTIONS: ReadonlyArray<JurisdictionOption> = [
  { code: 'ACT', label: 'Australian Capital Territory' },
  { code: 'NSW', label: 'New South Wales' },
  { code: 'VIC', label: 'Victoria' },
  { code: 'QLD', label: 'Queensland' },
  { code: 'WA', label: 'Western Australia' },
  { code: 'SA', label: 'South Australia' },
  { code: 'TAS', label: 'Tasmania' },
  { code: 'NT', label: 'Northern Territory' }
];

@Component({
  selector: 'app-quote-request-page',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    RouterLink,
    UIPageHeaderComponent,
    UISkeletonBlockComponent,
    UIAlertBannerComponent,
    UIButtonComponent,
    UIFormFieldComponent
  ],
  templateUrl: './quote-request-page.component.html',
  styleUrl: './quote-request-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuoteRequestPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly reportService = inject(ReportService);
  private readonly quoteRequestService = inject(QuoteRequestService);
  private readonly conveyancerDirectoryService = inject(ConveyancerDirectoryService);

  private readonly directoryPageSize = 9;
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly submitError = signal('');
  readonly submitting = signal(false);
  readonly report = signal<ReportDetail | null>(null);
  readonly conveyancers = signal<ConveyancerDirectoryItem[]>([]);
  readonly shuffledConveyancers = signal<ConveyancerDirectoryItem[]>([]);
  readonly existingRequest = signal<QuoteRequestSummary | null>(null);
  readonly quoteRequestLookupPending = signal(false);
  readonly directoryLoading = signal(false);
  readonly directoryError = signal('');
  readonly activeDirectoryJurisdiction = signal<JurisdictionCode>('ACT');
  readonly jurisdictionWarningModalOpen = signal(false);
  readonly pendingDirectoryJurisdiction = signal<JurisdictionCode | null>(null);
  readonly conveyancerQuestionSeed = signal<BriefDraftItem[]>([]);
  readonly conveyancerQuestionDrafts = signal<BriefDraftItem[]>([]);
  readonly searchQuery = signal('');
  readonly selectedKeys = signal<string[]>([]);
  readonly currentStep = signal<QuoteWorkflowStep>(1);
  readonly requestStep = signal<RequestBuilderStep>(1);
  readonly directoryPage = signal(1);
  readonly jurisdictionOptions = JURISDICTION_OPTIONS;
  readonly serviceOptions: ServiceOption[] = [
    {
      value: 'pre-exchange-review',
      label: 'Pre-exchange review',
      description: 'Get a fixed fee to review the contract, answer report questions, and advise before you commit.',
      timingHint: 'Best when you need legal clarity before signing.'
    },
    {
      value: 'full-conveyancing',
      label: 'Full conveyancing',
      description: 'Request an end-to-end quote covering pre-exchange advice through to settlement support.',
      timingHint: 'Best when you want one firm to run the whole matter.'
    },
    {
      value: 'settlement-only',
      label: 'Settlement only',
      description: 'Request pricing focused on settlement coordination after the pre-exchange work is already handled.',
      timingHint: 'Best when contract advice is already complete.'
    }
  ];
  readonly workflowSteps: WorkflowStepItem[] = [
    {
      step: 1,
      label: 'Request',
      description: 'Build the request from your report.'
    },
    {
      step: 2,
      label: 'Shortlist',
      description: 'Choose up to three conveyancers.'
    },
    {
      step: 3,
      label: 'Send',
      description: 'Review and send the request.'
    }
  ];
  readonly requestBuilderSteps: RequestBuilderStepItem[] = [
    {
      step: 1,
      label: '1.1 Summary',
      description: 'Confirm the report summary and service.'
    },
    {
      step: 2,
      label: '1.2 Questions',
      description: 'Edit the questions sent to conveyancers.'
    },
    {
      step: 3,
      label: '1.3 Finish',
      description: 'Add a buyer note and confirm the request.'
    }
  ];

  readonly shortlistReadyConveyancers = computed(() =>
    this.shuffledConveyancers().filter((item) => !!item.email && item.quoteRequestsEnabled !== false)
  );

  readonly quoteRequestOptOutCount = computed(() =>
    this.conveyancers().filter((item) => !!item.email && item.quoteRequestsEnabled === false).length
  );

  readonly directoryMatches = computed(() =>
    this.shortlistReadyConveyancers()
      .filter((item) => {
        const query = this.searchQuery().trim().toLowerCase();
        if (!query) {
          return true;
        }

        const haystack = [
          item.organizationName ?? '',
          item.contactName ?? '',
          item.name,
          item.email ?? '',
          item.areasOfPractice.join(' ')
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
  );

  readonly directoryPageCount = computed(() => Math.max(1, Math.ceil(this.directoryMatches().length / this.directoryPageSize)));

  readonly selectableConveyancers = computed(() => {
    const page = Math.min(this.directoryPage(), this.directoryPageCount());
    const start = (page - 1) * this.directoryPageSize;
    return this.directoryMatches().slice(start, start + this.directoryPageSize);
  });

  readonly selectedConveyancers = computed(() => {
    const selectedKeySet = new Set(this.selectedKeys());
    return this.conveyancers()
      .filter((item) => selectedKeySet.has(this.keyFor(item)))
      .sort((left, right) => this.displayName(left).localeCompare(this.displayName(right), undefined, { sensitivity: 'base' }));
  });

  readonly hasExistingRequest = computed(() => this.existingRequest() !== null);
  readonly selectionSlotsRemaining = computed(() => Math.max(0, 3 + this.selectedKeys().length));
  readonly searchResultSummary = computed(() => {
    const count = this.directoryMatches().length;
    if (!this.searchQuery().trim()) {
      return `${count} shortlist-ready in ${this.activeDirectoryJurisdiction()} directory`;
    }

    return `${count} shortlist-ready matches in ${this.activeDirectoryJurisdiction()} directory`;
  });
  readonly selectedSummary = computed(() => {
    const selected = this.selectedKeys().length;
    if (selected === 0) {
      return 'Shortlist up to 3 conveyancers.';
    }

    return `${selected} of 3 shortlisted`;
  });
  readonly parsedConveyancerQuestions = computed(() =>
    this.normalizeDraftValues(this.conveyancerQuestionDrafts(), this.conveyancerQuestionLimit())
  );
  readonly canAddConveyancerQuestion = computed(() => this.conveyancerQuestionDrafts().length < this.conveyancerQuestionLimit());
  readonly conveyancerQuestionSlotCount = computed(() => this.conveyancerQuestionDrafts().length);
  readonly conveyancerQuestionSlotsRemaining = computed(() => Math.max(0, this.conveyancerQuestionLimit() - this.conveyancerQuestionSlotCount()));
  readonly seededQuestionCount = computed(() => this.countFilledDrafts(this.conveyancerQuestionSeed()));
  readonly canResetConveyancerQuestions = computed(() => this.draftsDiffer(this.conveyancerQuestionSeed(), this.conveyancerQuestionDrafts()));
  readonly reportQuestionCount = computed(() => this.countFilledDraftsBySource(this.conveyancerQuestionDrafts(), 'report'));
  readonly customQuestionCount = computed(() => this.countFilledDraftsBySource(this.conveyancerQuestionDrafts(), 'custom'));
  readonly conveyancerQuestionLimit = computed(() => this.seededQuestionCount() - 3);
  readonly canMoveToReview = computed(() => this.selectedKeys().length > 0);
  readonly propertyJurisdiction = computed<JurisdictionCode>(() => this.normalizeJurisdiction(this.report()?.stateOrTerritory ?? 'ACT'));
  readonly propertyJurisdictionLabel = computed(() => this.jurisdictionLabel(this.propertyJurisdiction()));
  readonly activeDirectoryJurisdictionLabel = computed(() => this.jurisdictionLabel(this.activeDirectoryJurisdiction()));
  readonly crossJurisdictionDirectory = computed(() => this.activeDirectoryJurisdiction() !== this.propertyJurisdiction());
  readonly reportRequestSummary = computed(() => {
    const report = this.report();
    if (!report) {
      return 'ConveyMate will use the completed report as the starting brief for this request.';
    }

    const summary = report.executiveSummary.trim();
    if (summary) {
      return summary;
    }

    return 'ConveyMate will use the completed report as the starting brief for this request.';
  });

  serviceNeed: ServiceNeed = 'pre-exchange-review';
  message = '';
  shareReportPdf = false;
  confirmSecureDocumentSharing = false;
  private readonly reviewedRequestSignature = signal('');
  private nextDraftItemId = 0;

  constructor() {
    effect(() => {
      if (this.currentStep() === 3 && this.selectedKeys().length === 0) {
        this.currentStep.set(2);
      }
    });

    effect((onCleanup) => {
      const modalOpen = this.jurisdictionWarningModalOpen();
      const body = this.document.body;
      if (!body) {
        return;
      }

      const previousOverflow = body.style.overflow;
      if (modalOpen) {
        body.style.overflow = 'hidden';
      } else {
        body.style.overflow = '';
      }

      onCleanup(() => {
        body.style.overflow = previousOverflow;
      });
    });

    this.load();
  }

  load(): void {
    const reportId = this.route.snapshot.paramMap.get('id');
    if (!reportId) {
      this.errorMessage.set('Invalid report ID.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.reportService.getReportById(reportId).subscribe({
      next: (report) => {
        if (report.status !== 'ready') {
          this.errorMessage.set('Quotes can only be requested from a completed report.');
          this.loading.set(false);
          return;
        }

        this.report.set(report);
        const defaultQuestions = this.createDraftSeed(this.defaultConveyancerQuestions(report), 'report');
        this.conveyancerQuestionSeed.set(defaultQuestions);
        this.conveyancerQuestionDrafts.set(this.cloneDrafts(defaultQuestions));
        this.loadExistingRequest(report.id);
        this.loadDirectoryJurisdiction(this.normalizeJurisdiction(report.stateOrTerritory), report.id, true);
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.loading.set(false);
      }
    });
  }

  loadExistingRequest(reportId: string): void {
    this.quoteRequestLookupPending.set(true);

    this.quoteRequestService.getByReviewJobId(reportId).subscribe({
      next: (request) => {
        this.existingRequest.set(request);
      },
      error: () => {
        this.existingRequest.set(null);
        this.quoteRequestLookupPending.set(false);
      },
      complete: () => {
        this.quoteRequestLookupPending.set(false);
      }
    });
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.searchQuery.set(target?.value ?? '');
    this.directoryPage.set(1);
  }

  onDirectoryJurisdictionChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const nextJurisdiction = this.normalizeJurisdiction(target?.value ?? this.activeDirectoryJurisdiction());
    if (nextJurisdiction === this.activeDirectoryJurisdiction()) {
      return;
    }

    if (nextJurisdiction !== this.propertyJurisdiction()) {
      this.pendingDirectoryJurisdiction.set(nextJurisdiction);
      this.jurisdictionWarningModalOpen.set(true);
      return;
    }

    this.applyDirectoryJurisdiction(nextJurisdiction);
  }

  onShareReportPdfChange(value: boolean): void {
    this.shareReportPdf = value;
    if (!value) {
      this.confirmSecureDocumentSharing = false;
    }
  }

  goToRequestSubstep(step: RequestBuilderStep): void {
    this.requestStep.set(step);
  }

  goToNextRequestSubstep(): void {
    const current = this.requestStep();
    if (current < 3) {
      this.requestStep.set((current + 1) as RequestBuilderStep);
      return;
    }

    if (this.canEnterShortlistStep()) {
      this.currentStep.set(2);
    }
  }

  goToPreviousRequestSubstep(): void {
    const current = this.requestStep();
    if (current === 1) {
      return;
    }

    this.requestStep.set((current - 1) as RequestBuilderStep);
  }

  goToStep(step: QuoteWorkflowStep): void {
    if (step === 2 && !this.canEnterShortlistStep()) {
      return;
    }

    if (step === 3 && !this.canEnterSendStep()) {
      return;
    }

    if (step === 1 && this.currentStep() > 1) {
      this.requestStep.set(3);
    }

    this.currentStep.set(step);
  }

  goToNextStep(): void {
    const current = this.currentStep();
    if (current === 1) {
      this.goToNextRequestSubstep();
      return;
    }

    if (current === 2 && this.canMoveToReview()) {
      this.currentStep.set(3);
    }
  }

  goToPreviousStep(): void {
    const current = this.currentStep();
    if (current === 1) {
      return;
    }

    if (current === 2) {
      this.requestStep.set(3);
    }

    this.currentStep.set((current - 1) as QuoteWorkflowStep);
  }

  visibleDirectoryPages(): number[] {
    const total = this.directoryPageCount();
    const current = Math.min(this.directoryPage(), total);
    if (total <= 5) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }

    const start = Math.max(1, Math.min(current - 2, total - 4));
    return [start, start + 1, start + 2, start + 3, start + 4];
  }

  goToDirectoryPage(page: number): void {
    if (page < 1 || page > this.directoryPageCount()) {
      return;
    }

    this.directoryPage.set(page);
  }

  goToPreviousDirectoryPage(): void {
    this.goToDirectoryPage(this.directoryPage() - 1);
  }

  goToNextDirectoryPage(): void {
    this.goToDirectoryPage(this.directoryPage() + 1);
  }

  toggleSelection(item: ConveyancerDirectoryItem): void {
    if (this.hasExistingRequest() || this.quoteRequestLookupPending()) {
      return;
    }

    const key = this.keyFor(item);
    const current = this.selectedKeys();
    if (current.includes(key)) {
      this.selectedKeys.set(current.filter((value) => value !== key));
      return;
    }

    if (this.isSelectionDisabled(item)) {
      this.submitError.set('Shortlist full. Remove one selected firm before adding another.');
      return;
    }

    this.submitError.set('');
    this.selectedKeys.set([...current, key]);
  }

  isSelected(item: ConveyancerDirectoryItem): boolean {
    return this.selectedKeys().includes(this.keyFor(item));
  }

  requestReviewConfirmed(): boolean {
    const reviewedSignature = this.reviewedRequestSignature();
    return reviewedSignature.length > 0 && reviewedSignature === this.currentRequestSignature();
  }

  canEnterShortlistStep(): boolean {
    return this.requestReviewConfirmed() && (!this.shareReportPdf || this.confirmSecureDocumentSharing);
  }

  canEnterSendStep(): boolean {
    return this.canEnterShortlistStep() && this.selectedKeys().length > 0;
  }

  canSubmit(): boolean {
    const report = this.report();
    return (
      !!report &&
      report.status === 'ready' &&
      !this.quoteRequestLookupPending() &&
      !this.hasExistingRequest() &&
      this.currentStep() === 3 &&
      this.selectedKeys().length > 0 &&
      (!this.shareReportPdf || this.confirmSecureDocumentSharing) &&
      !this.submitting()
    );
  }

  onRequestReviewConfirmationChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = target?.checked ?? false;
    this.reviewedRequestSignature.set(checked ? this.currentRequestSignature() : '');
  }

  closeJurisdictionWarningModal(): void {
    this.pendingDirectoryJurisdiction.set(null);
    this.jurisdictionWarningModalOpen.set(false);
  }

  confirmJurisdictionWarning(): void {
    const nextJurisdiction = this.pendingDirectoryJurisdiction();
    if (!nextJurisdiction) {
      this.closeJurisdictionWarningModal();
      return;
    }

    this.jurisdictionWarningModalOpen.set(false);
    this.pendingDirectoryJurisdiction.set(null);
    this.applyDirectoryJurisdiction(nextJurisdiction);
  }

  onJurisdictionWarningModalBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialog-modal')) {
      this.closeJurisdictionWarningModal();
    }
  }

  submit(): void {
    const report = this.report();
    if (!report) {
      return;
    }

    if (this.quoteRequestLookupPending()) {
      return;
    }

    const existingRequest = this.existingRequest();
    if (existingRequest) {
      this.router.navigate(['/quotes', existingRequest.id]);
      return;
    }

    const selected = this.selectedConveyancers();
    if (selected.length === 0) {
      this.submitError.set('Select at least one conveyancer.');
      return;
    }

    this.submitError.set('');
    this.submitting.set(true);

    this.quoteRequestService
      .createFromReport(report.id, {
        serviceNeed: this.serviceNeed,
        message: this.message.trim() || null,
        shareReportPdf: this.shareReportPdf,
        conveyancerQuestions: this.parsedConveyancerQuestions(),
        selectedConveyancers: selected.map((item) => ({
          jurisdiction: item.jurisdiction,
          regulatorType: item.regulatorType,
          sourceIdentifier: item.sourceIdentifier
        }))
      })
      .subscribe({
        next: (payload) => {
          this.router.navigate(['/quotes', payload.id]);
        },
        error: (error: Error) => {
          this.submitError.set(error.message);
          this.submitting.set(false);
        },
        complete: () => {
          this.submitting.set(false);
        }
      });
  }

  serviceLabel(value: string): string {
    return this.quoteRequestService.formatServiceNeed(value);
  }

  statusLabel(value: string): string {
    return value.replace(/-/g, ' ');
  }

  displayName(item: ConveyancerDirectoryItem): string {
    return item.organizationName?.trim() || item.name;
  }

  subtitle(item: ConveyancerDirectoryItem): string {
    return item.contactName?.trim() || item.name;
  }

  practiceSummary(item: ConveyancerDirectoryItem): string {
    return item.areasOfPractice.slice(0, 3).join(' · ');
  }

  removeSelection(item: ConveyancerDirectoryItem): void {
    const key = this.keyFor(item);
    this.selectedKeys.set(this.selectedKeys().filter((value) => value !== key));
  }

  hasPracticeSummary(item: ConveyancerDirectoryItem): boolean {
    return this.practiceSummary(item).length > 0;
  }

  isSelectionDisabled(item: ConveyancerDirectoryItem): boolean {
    return this.selectedKeys().length >= 3 && !this.isSelected(item);
  }

  selectionActionLabel(item: ConveyancerDirectoryItem): string {
    if (this.isSelected(item)) {
      return 'Remove from shortlist';
    }

    if (this.isSelectionDisabled(item)) {
      return 'Shortlist full';
    }

    return 'Add to shortlist';
  }

  selectionStatusLabel(item: ConveyancerDirectoryItem): string {
    if (this.isSelected(item)) {
      return 'Included in shortlist';
    }

    if (this.isSelectionDisabled(item)) {
      return 'Remove one shortlisted firm to add another.';
    }

    return 'Ready to add to shortlist';
  }

  jurisdictionLabel(value: JurisdictionCode): string {
    return this.jurisdictionOptions.find((option) => option.code === value)?.label ?? value;
  }

  downloadManualEmailPack(): void {
    const report = this.report();
    const selected = this.selectedConveyancers();
    if (!report || selected.length === 0) {
      return;
    }

    const serviceLabel = this.serviceLabel(this.serviceNeed);
    const emailIntroduction = this.message.trim();
    const conveyancerQuestions = this.parsedConveyancerQuestions();
    const summary = report.executiveSummary || 'Please review the attached contract/report summary and provide a fixed-fee quote.';
    const lines = [
      `ConveyMate manual outreach pack`,
      ``,
      `Property: ${report.propertyAddress}`,
      `State: ${report.stateOrTerritory}`,
      `Requested service: ${serviceLabel}`,
      `Report sharing requested: ${this.shareReportPdf ? 'Yes' : 'No'}`,
      ``,
      `Use these drafts if you want to send the request yourself from your own inbox.`,
      `Responses can happen directly outside ConveyMate when you use this pack.`,
      ``
    ];

    for (const item of selected) {
      lines.push(`---`);
      lines.push(`To: ${item.email}`);
      lines.push(`Subject: Conveyancing quote request for ${report.propertyAddress}`);
      lines.push(``);
      lines.push(`Suggested email body:`);
      lines.push(`Hello ${this.subtitle(item)},`);
      lines.push(``);
      lines.push(`I am seeking a ${serviceLabel.toLowerCase()} quote for ${report.propertyAddress}.`);
      if (emailIntroduction) {
        lines.push(``);
        lines.push(emailIntroduction);
      }
      lines.push(``);
      lines.push(`Report summary: ${summary}`);
      if (conveyancerQuestions.length > 0) {
        lines.push(``);
        lines.push(`Questions for the conveyancer:`);
        for (const question of conveyancerQuestions) {
          lines.push(`- ${question}`);
        }
      }
      lines.push(``);
      lines.push(
        this.shareReportPdf
          ? `I can share the uploaded contract pack and report documents if you need them to price accurately.`
          : `I am looking for an initial quote based on the summary above before sharing the uploaded documents.`
      );
      lines.push(``);
      lines.push(`Please reply directly with your fee, inclusions, exclusions, and expected turnaround.`);
      lines.push(``);
      lines.push(`Regards,`);
      lines.push(`[Your name]`);
      lines.push(``);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.slugify(report.propertyAddress)}-quote-email-pack.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  stepIsComplete(step: QuoteWorkflowStep): boolean {
    if (step === 1) {
      return true;
    }

    if (step === 2) {
      return this.selectedKeys().length > 0;
    }

    return this.currentStep() === 3;
  }

  addConveyancerQuestion(): void {
    if (!this.canAddConveyancerQuestion()) {
      return;
    }

    this.conveyancerQuestionDrafts.update((drafts) => [this.createDraftItem('', 'custom'), ...drafts]);
    this.focusDraftField('conveyancerQuestion-0');
  }

  updateConveyancerQuestion(index: number, value: string): void {
    this.conveyancerQuestionDrafts.update((drafts) =>
      drafts.map((draft, draftIndex) => (draftIndex === index ? { ...draft, value } : draft))
    );
  }

  removeConveyancerQuestion(index: number): void {
    this.conveyancerQuestionDrafts.update((drafts) => drafts.filter((_, draftIndex) => draftIndex !== index));
  }

  resetConveyancerQuestions(): void {
    this.conveyancerQuestionDrafts.set(this.cloneDrafts(this.conveyancerQuestionSeed()));
  }

  private keyFor(item: ConveyancerDirectoryItem): string {
    return `${item.jurisdiction}|${item.regulatorType}|${item.sourceIdentifier}`;
  }

  private applyDirectoryJurisdiction(jurisdiction: JurisdictionCode): void {
    const report = this.report();
    if (!report) {
      return;
    }

    this.loadDirectoryJurisdiction(jurisdiction, report.id, false);
  }

  private loadDirectoryJurisdiction(jurisdiction: JurisdictionCode, seed: string, initialLoad: boolean): void {
    const previousJurisdiction = this.activeDirectoryJurisdiction();
    const previousList = this.shuffledConveyancers();
    const previousSearch = this.searchQuery();
    this.directoryLoading.set(true);
    this.directoryError.set('');
    this.activeDirectoryJurisdiction.set(jurisdiction);
    this.searchQuery.set('');
    this.directoryPage.set(1);
    this.shuffledConveyancers.set([]);

    this.conveyancerDirectoryService.listByJurisdiction(jurisdiction).subscribe({
      next: (items) => {
        this.conveyancers.update((current) => this.mergeConveyancers(current, items));
        this.shuffledConveyancers.set(this.randomizeDirectory(items, `${seed}:${jurisdiction}`));
      },
      error: (error: Error) => {
        this.directoryError.set(error.message);
        this.activeDirectoryJurisdiction.set(previousJurisdiction);
        this.shuffledConveyancers.set(previousList);
        this.searchQuery.set(previousSearch);
        this.directoryLoading.set(false);
        if (initialLoad) {
          this.errorMessage.set(error.message);
          this.loading.set(false);
        }
      },
      complete: () => {
        this.directoryLoading.set(false);
        if (initialLoad) {
          this.loading.set(false);
        }
      }
    });
  }

  private mergeConveyancers(
    current: ConveyancerDirectoryItem[],
    incoming: ConveyancerDirectoryItem[]
  ): ConveyancerDirectoryItem[] {
    const itemsByKey = new Map(current.map((item) => [this.keyFor(item), item]));
    for (const item of incoming) {
      itemsByKey.set(this.keyFor(item), item);
    }

    return Array.from(itemsByKey.values());
  }

  private randomizeDirectory(items: ConveyancerDirectoryItem[], seed: string): ConveyancerDirectoryItem[] {
    return [...items].sort((left, right) => {
      const leftWeight = this.weightFor(seed, this.keyFor(left));
      const rightWeight = this.weightFor(seed, this.keyFor(right));
      if (leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
      }

      return this.displayName(left).localeCompare(this.displayName(right), undefined, { sensitivity: 'base' });
    });
  }

  private weightFor(seed: string, value: string): number {
    let hash = 2166136261;
    const input = `${seed}|${value}`;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private defaultConveyancerQuestions(report: ReportDetail): string[] {
    const seededQuestions = report.lawyerQuestions.length > 0 ? report.lawyerQuestions : report.recommendedActions;
    return seededQuestions
      .map((value) => value.trim())
      .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  }

  private createDraftSeed(values: string[], source: BriefDraftSource): BriefDraftItem[] {
    return values.map((value) => this.createDraftItem(value, source));
  }

  private cloneDrafts(values: BriefDraftItem[]): BriefDraftItem[] {
    return values.map((value) => this.createDraftItem(value.value, value.source));
  }

  private createDraftItem(value: string, source: BriefDraftSource): BriefDraftItem {
    this.nextDraftItemId += 1;
    return {
      id: `draft-${this.nextDraftItemId}`,
      value,
      source
    };
  }

  private countFilledDrafts(values: BriefDraftItem[]): number {
    return values.filter((value) => value.value.trim().length > 0).length;
  }

  private countFilledDraftsBySource(values: BriefDraftItem[], source: BriefDraftSource): number {
    return values.filter((value) => value.source === source && value.value.trim().length > 0).length;
  }

  private currentRequestSignature(): string {
    return JSON.stringify({
      serviceNeed: this.serviceNeed,
      shareReportPdf: this.shareReportPdf,
      message: this.message.trim(),
      conveyancerQuestions: this.parsedConveyancerQuestions()
    });
  }

  private focusDraftField(fieldId: string): void {
    const focusField = () => {
      const element = this.document.getElementById(fieldId);
      if (!(element instanceof HTMLTextAreaElement)) {
        return;
      }

      element.focus();
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    const view = this.document.defaultView;
    if (view?.requestAnimationFrame) {
      view.requestAnimationFrame(() => focusField());
      return;
    }

    setTimeout(focusField, 0);
  }

  private normalizeDraftValues(values: BriefDraftItem[], maxItems: number): string[] {
    return this.normalizeDraftItems(
      values.map((value) => value.value),
      maxItems
    );
  }

  private normalizeDraftItems(values: string[], maxItems: number): string[] {
    return values
      .map((value) => value.trim())
      .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index)
      .slice(0, maxItems);
  }

  private draftsDiffer(left: BriefDraftItem[], right: BriefDraftItem[]): boolean {
    if (left.length !== right.length) {
      return true;
    }

    return left.some((value, index) => value.value !== right[index]?.value || value.source !== right[index]?.source);
  }

  private normalizeJurisdiction(value: string): JurisdictionCode {
    const normalized = value.trim().toUpperCase();
    const supported = new Set<JurisdictionCode>(['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT']);
    return supported.has(normalized as JurisdictionCode) ? (normalized as JurisdictionCode) : 'ACT';
  }
}
