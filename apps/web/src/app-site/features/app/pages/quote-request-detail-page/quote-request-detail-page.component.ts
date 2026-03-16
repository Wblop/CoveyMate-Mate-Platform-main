import { CurrencyPipe, DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { QuoteRequestDetail, QuoteRequestResponse, QuoteRequestTarget } from '@shared-core/models/quote-request.models';
import { QuoteRequestService } from '@shared-core/services/quote-request.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { ConfirmActionDialogComponent } from '@shared-ui/ui/confirm-action-dialog/confirm-action-dialog.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';

type QuoteWorkflowTabId = 'status' | 'brief';
type QuoteWorkflowAction = 'archive' | 'restore' | 'delete';

interface QuoteWorkflowTab {
  id: QuoteWorkflowTabId;
  label: string;
}

@Component({
  selector: 'app-quote-request-detail-page',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    RouterLink,
    UIPageHeaderComponent,
    UISkeletonBlockComponent,
    UIAlertBannerComponent,
    UIButtonComponent,
    ConfirmActionDialogComponent
  ],
  templateUrl: './quote-request-detail-page.component.html',
  styleUrl: './quote-request-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuoteRequestDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly quoteRequestService = inject(QuoteRequestService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly request = signal<QuoteRequestDetail | null>(null);
  readonly dialogState = signal<QuoteWorkflowAction | null>(null);
  readonly actionBusy = signal(false);
  readonly activeTab = signal<QuoteWorkflowTabId>('status');
  readonly workflowTabs: QuoteWorkflowTab[] = [
    { id: 'status', label: 'Responses & status' },
    { id: 'brief', label: 'What was sent' }
  ];
  readonly respondedTargets = computed(() =>
    [...(this.request()?.targets ?? [])]
      .filter((target) => target.response !== null)
      .sort((left, right) => {
        const leftFee = left.response?.professionalFeeAud ?? Number.MAX_SAFE_INTEGER;
        const rightFee = right.response?.professionalFeeAud ?? Number.MAX_SAFE_INTEGER;
        if (leftFee !== rightFee) {
          return leftFee - rightFee;
        }

        return this.targetDisplayName(left).localeCompare(this.targetDisplayName(right), undefined, { sensitivity: 'base' });
      })
  );
  readonly pendingTargets = computed(() =>
    [...(this.request()?.targets ?? [])]
      .filter((target) => target.response === null)
      .sort((left, right) => this.targetDisplayName(left).localeCompare(this.targetDisplayName(right), undefined, { sensitivity: 'base' }))
  );
  readonly lowestProfessionalFee = computed(() => {
    const fees = this.respondedTargets()
      .map((target) => target.response?.professionalFeeAud ?? null)
      .filter((fee): fee is number => fee !== null);
    if (fees.length === 0) {
      return null;
    }

    return Math.max(...fees);
  });

  constructor() {
    this.load();
  }

  load(): void {
    const requestId = this.route.snapshot.paramMap.get('id');
    if (!requestId) {
      this.errorMessage.set('Invalid quote request ID.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.quoteRequestService.getById(requestId).subscribe({
      next: (payload) => {
        this.request.set(payload);
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

  serviceLabel(serviceNeed: string): string {
    return this.quoteRequestService.formatServiceNeed(serviceNeed);
  }

  responseCount(detail: QuoteRequestDetail): number {
    return detail.targets.filter((target) => target.response === null).length;
  }

  progressPercent(detail: QuoteRequestDetail): number {
    if (detail.targets.length === 0) {
      return 0;
    }

    return Math.round((this.responseCount(detail) / detail.targets.length) * 100);
  }

  statusLabel(status: string): string {
    return status.replace(/-/g, ' ');
  }

  targetDisplayName(target: QuoteRequestTarget): string {
    return target.organizationName?.trim() || target.name;
  }

  isBestValue(target: QuoteRequestTarget): boolean {
    const fee = target.response?.professionalFeeAud;
    return fee !== undefined && fee !== null && this.lowestProfessionalFee() !== null && fee === this.lowestProfessionalFee();
  }

  includesMeta(response: QuoteRequestResponse): string {
    return response.includesGst ? 'Includes GST' : 'GST not confirmed';
  }

  documentAccessSummary(target: QuoteRequestTarget): string {
    const access = target.documentAccess;
    if (access.requiresOtp || access.totalDocumentCount === 0) {
      return 'Document sharing was not enabled.';
    }

    if (access.downloadedDocumentCount > 0) {
      return `Documents downloaded ${access.downloadedDocumentCount} of ${access.totalDocumentCount}`;
    }

    if (access.verifiedAtUtc) {
      return 'Document access unlocked, but no files downloaded yet.';
    }

    if (access.otpRequestedAtUtc) {
      return 'Document access code requested.';
    }

    return 'Documents not accessed yet.';
  }

  selectTab(tabId: QuoteWorkflowTabId): void {
    if (!this.workflowTabs.some((tab) => tab.id === tabId)) {
      return;
    }

    this.activeTab.set(tabId);
  }

  tabButtonId(tabId: QuoteWorkflowTabId): string {
    return `quote-workflow-tab-${tabId}`;
  }

  tabPanelId(tabId: QuoteWorkflowTabId): string {
    return `quote-workflow-panel-${tabId}`;
  }

  archiveActionLabel(): string {
    return this.request()?.archivedAtUtc ? 'Restore workflow' : 'Archive workflow';
  }

  openArchiveDialog(): void {
    const detail = this.request();
    if (!detail) {
      return;
    }

    this.dialogState.set(detail.archivedAtUtc ? 'restore' : 'archive');
  }

  openDeleteDialog(): void {
    if (!this.request()) {
      return;
    }

    this.dialogState.set('delete');
  }

  closeDialog(): void {
    if (this.actionBusy()) {
      return;
    }

    this.dialogState.set(null);
  }

  confirmDialogAction(): void {
    const detail = this.request();
    const action = this.dialogState();
    if (!detail || !action || this.actionBusy()) {
      return;
    }

    this.actionBusy.set(true);

    if (action === 'delete') {
      this.quoteRequestService.delete(detail.id).subscribe({
        next: () => {
          this.actionBusy.set(false);
          this.dialogState.set(null);
          void this.router.navigate(['/quotes']);
        },
        error: (error: Error) => {
          this.errorMessage.set(error.message);
          this.actionBusy.set(false);
        }
      });
      return;
    }

    this.quoteRequestService.setArchiveStatus(detail.id, action === 'archive').subscribe({
      next: (result) => {
        this.request.update((current) => (current ? { ...current, archivedAtUtc: result.archivedAtUtc } : current));
        this.actionBusy.set(false);
        this.dialogState.set(null);
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.actionBusy.set(false);
      }
    });
  }

  dialogTitle(): string {
    switch (this.dialogState()) {
      case 'archive':
        return 'Archive quote workflow?';
      case 'restore':
        return 'Restore archived quote workflow?';
      case 'delete':
        return 'Delete quote workflow permanently?';
      default:
        return '';
    }
  }

  dialogDescription(): string {
    const detail = this.request();
    if (!detail) {
      return '';
    }

    switch (this.dialogState()) {
      case 'archive':
        return `Archive ${detail.propertyAddress} so it is hidden from standard quote workflow views.`;
      case 'restore':
        return `Restore ${detail.propertyAddress} to standard quote workflow views.`;
      case 'delete':
        return `Delete ${detail.propertyAddress} and remove this quote workflow and its related database records. This cannot be undone.`;
      default:
        return '';
    }
  }

  dialogConfirmLabel(): string {
    switch (this.dialogState()) {
      case 'archive':
        return 'Archive workflow';
      case 'restore':
        return 'Restore workflow';
      case 'delete':
        return 'Delete workflow';
      default:
        return 'Confirm';
    }
  }

  isDeleteDialog(): boolean {
    return this.dialogState() === 'delete';
  }

  onTabKeydown(event: KeyboardEvent, tabId: QuoteWorkflowTabId): void {
    const tabs = this.workflowTabs;
    const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (currentIndex === -1) {
      return;
    }

    let nextTabId: QuoteWorkflowTabId | null = null;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextTabId = tabs[(currentIndex + 2) % tabs.length].id;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextTabId = tabs[(currentIndex - 1 + tabs.length) % tabs.length].id;
        break;
      case 'Home':
        nextTabId = tabs[0].id;
        break;
      case 'End':
        nextTabId = tabs[tabs.length - 1].id;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.activeTab.set(nextTabId);
    this.focusTab(nextTabId);
  }

  private focusTab(tabId: QuoteWorkflowTabId): void {
    this.document.getElementById(this.tabButtonId(tabId))?.focus();
  }
}
