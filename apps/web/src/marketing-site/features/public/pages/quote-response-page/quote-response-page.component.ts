import { CurrencyPipe, DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { PublicQuoteRequestView, QuoteRequestResponse } from '@shared-core/models/quote-request.models';
import { QuoteRequestService } from '@shared-core/services/quote-request.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';

type BuyerOverviewTabId = 'summary' | 'questions';

interface BuyerOverviewTab {
  id: BuyerOverviewTabId;
  label: string;
}

const BUYER_OVERVIEW_TABS: ReadonlyArray<BuyerOverviewTab> = [
  { id: 'summary', label: 'Matter summary' },
  { id: 'questions', label: 'Buyer questions' }
];

@Component({
  selector: 'app-quote-response-page',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    FormsModule,
    UIPageHeaderComponent,
    UISkeletonBlockComponent,
    UIAlertBannerComponent,
    UIButtonComponent,
    UIFormFieldComponent
  ],
  templateUrl: './quote-response-page.component.html',
  styleUrl: './quote-response-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuoteResponsePageComponent {
  private readonly documentAccessStoragePrefix = 'quote-document-access:';
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly quoteRequestService = inject(QuoteRequestService);

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly submitError = signal('');
  readonly downloadError = signal('');
  readonly documentAccessError = signal('');
  readonly documentAccessNotice = signal('');
  readonly submitting = signal(false);
  readonly downloading = signal(false);
  readonly downloadingDocumentId = signal<string | null>(null);
  readonly requestingDocumentAccessOtp = signal(false);
  readonly verifyingDocumentAccessOtp = signal(false);
  readonly documentAccessToken = signal<string | null>(null);
  readonly documentModalOpen = signal(false);
  readonly buyerOverviewModalOpen = signal(false);
  readonly activeBuyerOverviewTab = signal<BuyerOverviewTabId>('summary');
  readonly view = signal<PublicQuoteRequestView | null>(null);
  readonly response = signal<QuoteRequestResponse | null>(null);
  readonly buyerOverviewTabs = BUYER_OVERVIEW_TABS;

  documentAccessOtpCode = '';
  responderName = '';
  responderEmail = '';
  responderPhone = '';
  professionalFeeAud: number | null = null;
  includesGst = true;
  disbursementsEstimateAud: number | null = null;
  turnaroundBusinessDays: number | null = null;
  scopeNotes = '';
  excludedItemsText = '';
  validUntilUtc = '';

  constructor() {
    effect((onCleanup) => {
      const modalOpen = this.documentModalOpen() || this.buyerOverviewModalOpen();
      const body = this.document.body;
      if (!body) {
        return;
      }

      const previousOverflow = body.style.overflow;
      const previousTouchAction = body.style.touchAction;

      if (modalOpen) {
        body.style.overflow = 'hidden';
        body.style.touchAction = 'none';
      } else {
        body.style.overflow = '';
        body.style.touchAction = '';
      }

      onCleanup(() => {
        body.style.overflow = previousOverflow;
        body.style.touchAction = previousTouchAction;
      });
    });

    this.load();
  }

  load(): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      this.errorMessage.set('Invalid quote request token.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    const documentAccessToken = this.readStoredDocumentAccessToken(token);
    this.documentAccessToken.set(documentAccessToken);

    this.quoteRequestService.getPublicByToken(token, documentAccessToken).subscribe({
      next: (payload) => {
        this.view.set(payload);
        this.response.set(payload.existingResponse);
        if (documentAccessToken && !payload.documentAccess.isUnlocked) {
          this.clearStoredDocumentAccessToken(token);
          this.documentAccessToken.set(null);
        }
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.loading.set(false);
      },
      complete: () => {
        this.loading.set(false);
      }
    });
  }

  submit(): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token || this.professionalFeeAud === null) {
      return;
    }

    this.submitError.set('');
    this.submitting.set(true);

    this.quoteRequestService
      .submitPublicResponse(token, {
        responderName: this.responderName.trim(),
        responderEmail: this.responderEmail.trim(),
        responderPhone: this.responderPhone.trim() || null,
        professionalFeeAud: this.professionalFeeAud,
        includesGst: this.includesGst,
        disbursementsEstimateAud: this.disbursementsEstimateAud,
        turnaroundBusinessDays: this.turnaroundBusinessDays,
        scopeNotes: this.scopeNotes.trim(),
        excludedItems: this.excludedItemsText
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
        validUntilUtc: this.validUntilUtc ? new Date(this.validUntilUtc).toISOString() : null
      })
      .subscribe({
        next: (payload) => {
          this.response.set(payload);
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

  downloadReport(): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token || !this.isDocumentAccessUnlocked()) {
      return;
    }

    this.downloadError.set('');
    this.downloading.set(true);

    this.quoteRequestService.downloadPublicReport(token, this.documentAccessToken()).subscribe({
      next: (blob) => {
        this.triggerBrowserDownload(blob, this.reportFileName());
        this.refreshAfterDocumentEvent(token);
      },
      error: (error: Error) => {
        this.downloadError.set(error.message);
        this.handleDocumentAccessFailure(token, error.message);
        this.downloading.set(false);
      },
      complete: () => {
        this.downloading.set(false);
      }
    });
  }

  downloadSharedDocument(documentId: string, fileName: string): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token || !this.isDocumentAccessUnlocked()) {
      return;
    }

    this.downloadError.set('');
    this.downloadingDocumentId.set(documentId);

    this.quoteRequestService.downloadPublicSharedDocument(token, documentId, this.documentAccessToken()).subscribe({
      next: (blob) => {
        this.triggerBrowserDownload(blob, fileName);
        this.refreshAfterDocumentEvent(token);
      },
      error: (error: Error) => {
        this.downloadError.set(error.message);
        this.handleDocumentAccessFailure(token, error.message);
        this.downloadingDocumentId.set(null);
      },
      complete: () => {
        this.downloadingDocumentId.set(null);
      }
    });
  }

  requestDocumentAccessOtp(): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      return;
    }

    this.documentAccessError.set('');
    this.documentAccessNotice.set('');
    this.requestingDocumentAccessOtp.set(true);

    this.quoteRequestService.requestPublicDocumentAccessOtp(token).subscribe({
      next: (payload) => {
        this.documentAccessNotice.set(`Access code sent. It expires ${this.formatUtcTimestamp(payload.expiresAtUtc)}.`);
        this.view.update((view) =>
          view
            ? {
                ...view,
                documentAccess: {
                  ...view.documentAccess,
                  otpRequestedAtUtc: payload.requestedAtUtc,
                  otpExpiresAtUtc: payload.expiresAtUtc
                }
              }
            : view
        );
      },
      error: (error: Error) => {
        this.documentAccessError.set(error.message);
        this.requestingDocumentAccessOtp.set(false);
      },
      complete: () => {
        this.requestingDocumentAccessOtp.set(false);
      }
    });
  }

  verifyDocumentAccessOtp(): void {
    const token = this.route.snapshot.paramMap.get('token');
    const code = this.documentAccessOtpCode.trim();
    if (!token || code.length === 0) {
      return;
    }

    this.documentAccessError.set('');
    this.documentAccessNotice.set('');
    this.verifyingDocumentAccessOtp.set(true);

    this.quoteRequestService.verifyPublicDocumentAccessOtp(token, code).subscribe({
      next: (payload) => {
        this.documentAccessOtpCode = '';
        this.documentAccessToken.set(payload.documentAccessToken);
        this.writeStoredDocumentAccessToken(token, payload.documentAccessToken);
        this.refreshView(token, payload.documentAccessToken, false, `Documents unlocked until ${this.formatUtcTimestamp(payload.expiresAtUtc)}.`);
      },
      error: (error: Error) => {
        this.documentAccessError.set(error.message);
        this.verifyingDocumentAccessOtp.set(false);
      },
      complete: () => {
        this.verifyingDocumentAccessOtp.set(false);
      }
    });
  }

  serviceLabel(serviceNeed: string): string {
    return this.quoteRequestService.formatServiceNeed(serviceNeed);
  }

  selectBuyerOverviewTab(tabId: BuyerOverviewTabId): void {
    if (!this.buyerOverviewTabs.some((tab) => tab.id === tabId)) {
      return;
    }

    this.activeBuyerOverviewTab.set(tabId);
  }

  onBuyerOverviewTabKeydown(event: KeyboardEvent, tabId: BuyerOverviewTabId): void {
    const currentIndex = this.buyerOverviewTabs.findIndex((tab) => tab.id === tabId);
    if (currentIndex < 0) {
      return;
    }

    let nextTabId: BuyerOverviewTabId | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextTabId = this.buyerOverviewTabs[(currentIndex + 1) % this.buyerOverviewTabs.length].id;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextTabId = this.buyerOverviewTabs[(currentIndex - 1 + this.buyerOverviewTabs.length) % this.buyerOverviewTabs.length].id;
        break;
      case 'Home':
        nextTabId = this.buyerOverviewTabs[0].id;
        break;
      case 'End':
        nextTabId = this.buyerOverviewTabs[this.buyerOverviewTabs.length - 1].id;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.activeBuyerOverviewTab.set(nextTabId);
    this.focusBuyerOverviewTab(nextTabId);
  }

  buyerOverviewTabButtonId(tabId: BuyerOverviewTabId): string {
    return `buyer-overview-tab-${tabId}`;
  }

  buyerOverviewTabPanelId(tabId: BuyerOverviewTabId): string {
    return `buyer-overview-panel-${tabId}`;
  }

  openDocumentModal(): void {
    if (!this.view()?.shareReportPdf) {
      return;
    }

    this.buyerOverviewModalOpen.set(false);
    this.documentModalOpen.set(true);
  }

  closeDocumentModal(): void {
    this.documentModalOpen.set(false);
  }

  openBuyerOverviewModal(): void {
    const view = this.view();
    if (!view) {
      return;
    }

    this.documentModalOpen.set(false);
    this.activeBuyerOverviewTab.set(this.defaultBuyerOverviewTab(view));
    this.buyerOverviewModalOpen.set(true);
  }

  closeBuyerOverviewModal(): void {
    this.buyerOverviewModalOpen.set(false);
  }

  onDocumentModalBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialog-modal')) {
      this.closeDocumentModal();
    }
  }

  onBuyerOverviewModalBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialog-modal')) {
      this.closeBuyerOverviewModal();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapePressed(): void {
    if (this.documentModalOpen()) {
      this.closeDocumentModal();
    }

    if (this.buyerOverviewModalOpen()) {
      this.closeBuyerOverviewModal();
    }
  }

  canSubmit(): boolean {
    return !this.submitting() && !!this.responderName.trim() && !!this.responderEmail.trim() && !!this.scopeNotes.trim() && this.professionalFeeAud !== null;
  }

  isDownloadingDocument(documentId: string): boolean {
    return this.downloadingDocumentId() === documentId;
  }

  isDocumentAccessUnlocked(): boolean {
    return this.view()?.documentAccess.isUnlocked === true;
  }

  hasSharedReport(view: PublicQuoteRequestView): boolean {
    return view.documentAccess.totalDocumentCount > view.sharedDocuments.length;
  }

  private refreshAfterDocumentEvent(token: string): void {
    this.refreshView(token, this.documentAccessToken(), false);
  }

  private refreshView(token: string, documentAccessToken: string | null, setLoading: boolean, noticeMessage = ''): void {
    if (setLoading) {
      this.loading.set(true);
    }

    this.quoteRequestService.getPublicByToken(token, documentAccessToken).subscribe({
      next: (payload) => {
        this.view.set(payload);
        this.response.set(payload.existingResponse);
        if (noticeMessage) {
          this.documentAccessNotice.set(noticeMessage);
        }
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        if (documentAccessToken) {
          this.clearStoredDocumentAccessToken(token);
          this.documentAccessToken.set(null);
        }
        if (setLoading) {
          this.loading.set(false);
        }
      },
      complete: () => {
        if (setLoading) {
          this.loading.set(false);
        }
      }
    });
  }

  private handleDocumentAccessFailure(token: string, message: string): void {
    if (!/access code|document access|locked/i.test(message)) {
      return;
    }

    this.clearStoredDocumentAccessToken(token);
    this.documentAccessToken.set(null);
    this.view.update((view) =>
      view
        ? {
            ...view,
            documentAccess: {
              ...view.documentAccess,
              isUnlocked: false,
              sessionExpiresAtUtc: null
            }
          }
        : view
    );
  }

  private readStoredDocumentAccessToken(token: string): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const value = window.sessionStorage.getItem(this.documentAccessStoragePrefix + token);
    return value && value.trim().length > 0 ? value.trim() : null;
  }

  private writeStoredDocumentAccessToken(token: string, documentAccessToken: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(this.documentAccessStoragePrefix + token, documentAccessToken);
  }

  private clearStoredDocumentAccessToken(token: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.removeItem(this.documentAccessStoragePrefix + token);
  }

  private reportFileName(): string {
    const address = this.view()?.propertyAddress ?? 'property';
    return `${this.slugify(address)}-conveymate-report.pdf`;
  }

  private triggerBrowserDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'property';
  }

  private formatUtcTimestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'soon' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  private defaultBuyerOverviewTab(view: PublicQuoteRequestView): BuyerOverviewTabId {
    if (view.summary.trim().length > 0) {
      return 'summary';
    }

    if (view.conveyancerQuestions.length > 0) {
      return 'questions';
    }

    return 'summary';
  }

  private focusBuyerOverviewTab(tabId: BuyerOverviewTabId): void {
    this.document.getElementById(this.buyerOverviewTabButtonId(tabId))?.focus();
  }
}
