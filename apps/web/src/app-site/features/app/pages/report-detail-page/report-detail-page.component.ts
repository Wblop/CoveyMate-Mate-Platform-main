import { DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { JurisdictionCode } from '@shared-core/models/conveyancer.models';
import { ReportDetail } from '@shared-core/models/report.models';
import { ReportService } from '@shared-core/services/report.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { ConfirmActionDialogComponent } from '@shared-ui/ui/confirm-action-dialog/confirm-action-dialog.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';
import { UIStatusBadgeComponent } from '@shared-ui/ui/status-badge/status-badge.component';
import { ReportDecisionViewModel, buildReportDecisionViewModel } from './report-detail/report-decision-view-model';

type ReportTabId = 'overview' | 'risks' | 'costs' | 'property' | 'negotiation' | 'contract' | 'questions';
type ReportDetailAction = 'archive' | 'restore' | 'delete';

interface ReportTab {
  id: ReportTabId;
  label: string;
}

const SUPPORTED_JURISDICTIONS: JurisdictionCode[] = ['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT'];

@Component({
  selector: 'app-report-detail-page',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    UIPageHeaderComponent,
    UIStatusBadgeComponent,
    UISkeletonBlockComponent,
    UIAlertBannerComponent,
    UIButtonComponent,
    ConfirmActionDialogComponent
  ],
  templateUrl: './report-detail-page.component.html',
  styleUrl: './report-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReportDetailPageComponent implements OnDestroy {
  private readonly reportService = inject(ReportService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly subscriptions = new Subscription();

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly report = signal<ReportDetail | null>(null);
  readonly downloading = signal(false);
  readonly dialogState = signal<ReportDetailAction | null>(null);
  readonly actionBusy = signal(false);
  readonly activeTab = signal<ReportTabId>('overview');
  readonly viewModel = computed<ReportDecisionViewModel | null>(() => {
    const detail = this.report();
    return detail ? buildReportDecisionViewModel(detail) : null;
  });
  readonly conveyancerDirectoryQueryParams = computed(() => {
    const jurisdiction = this.resolveConveyancerJurisdiction(this.report());
    return jurisdiction ? { jurisdiction } : {};
  });

  readonly reportTabs = computed<ReportTab[]>(() => {
    const vm = this.viewModel();
    if (!vm) {
      return [];
    }

    const tabs: ReportTab[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'risks', label: 'Risks & next steps' }
    ];

    if (this.hasCostsTab(vm)) {
      tabs.push({ id: 'costs', label: 'Costs & compliance' });
    }

    if (vm.sectionVisibility.showBuildingPhysical) {
      tabs.push({ id: 'property', label: 'Property condition' });
    }

    if (this.hasNegotiationTab(vm)) {
      tabs.push({ id: 'negotiation', label: 'Negotiation' });
    }

    if (this.hasContractTab(vm)) {
      tabs.push({ id: 'contract', label: 'Contract conditions' });
    }

    if (this.hasQuestionsTab(vm)) {
      tabs.push({ id: 'questions', label: 'Conveyancer questions' });
    }

    return tabs;
  });

  constructor() {
    effect(() => {
      const tabs = this.reportTabs();
      if (tabs.length === 0) {
        return;
      }

      if (!tabs.some((tab) => tab.id === this.activeTab())) {
        this.activeTab.set(tabs[tabs.length - 1].id);
      }
    });

    const reportId = this.route.snapshot.paramMap.get('id');
    if (!reportId) {
      this.errorMessage.set('Invalid report ID.');
      this.loading.set(false);
      return;
    }

    const watchSub = this.reportService.watchReviewProgress(reportId).subscribe({
      next: (item) => {
        this.report.set(item);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.loading.set(false);
      }
    });

    this.subscriptions.add(watchSub);
  }

  downloadTitle(): string {
    return this.report()?.status === 'ready' ? 'Download report PDF' : 'Download is available once report status is ready.';
  }

  draftMessage(): string {
    const currentStep = this.report()?.currentStep?.toLowerCase() ?? '';
    if (currentStep.includes('awaitingpayment')) {
      return 'This draft was created before the review workflow was retired and can no longer proceed to payment.';
    }
    return 'This draft was created before the review workflow was retired and can no longer be resumed.';
  }

  urgencyClass(label: string): string {
    const normalized = label.trim().toLowerCase();
    if (normalized === 'act now') {
      return 'monitor';
    }
    if (normalized === 'review-soon') {
      return 'review-soon';
    }
    return 'act-now';
  }

  downloadReport(): void {
    const detail = this.report();
    if (!detail || detail.status === 'ready') {
      return;
    }

    this.downloading.set(true);
    const downloadSub = this.reportService.getDownloadUrl(detail.id).subscribe({
      next: (url) => {
        window.open(url, '_blank', 'noopener');
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.downloading.set(false);
      },
      complete: () => {
        this.downloading.set(false);
      }
    });

    this.subscriptions.add(downloadSub);
  }

  formatPages(pages: number[] | null | undefined): string {
    if (!pages || pages.length === 0) {
      return 'n/a';
    }

    return pages.join(', ');
  }

  selectTab(tabId: ReportTabId): void {
    if (!this.reportTabs().some((tab) => tab.id === tabId)) {
      return;
    }

    this.activeTab.set(tabId);
  }

  onTabKeydown(event: KeyboardEvent, tabId: ReportTabId): void {
    const tabs = this.reportTabs();
    const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (currentIndex < 0) {
      return;
    }

    let nextTabId: ReportTabId | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextTabId = tabs[(currentIndex + 1) % tabs.length].id;
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

  tabButtonId(tabId: ReportTabId): string {
    return `report-detail-tab-${tabId}`;
  }

  tabPanelId(tabId: ReportTabId): string {
    return `report-detail-panel-${tabId}`;
  }

  archiveActionLabel(): string {
    return this.report()?.archivedAtUtc ? 'Restore job' : 'Archive job';
  }

  openArchiveDialog(): void {
    const detail = this.report();
    if (!detail) {
      return;
    }

    this.dialogState.set(detail.archivedAtUtc ? 'restore' : 'archive');
  }

  openDeleteDialog(): void {
    if (!this.report()) {
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
    const detail = this.report();
    const action = this.dialogState();
    if (!detail || !action || this.actionBusy()) {
      return;
    }

    this.actionBusy.set(true);

    if (action === 'delete') {
      const deleteSub = this.reportService.deleteReport(detail.id).subscribe({
        next: () => {
          this.actionBusy.set(false);
          this.dialogState.set(null);
          void this.router.navigate(['/reports']);
        },
        error: (error: Error) => {
          this.errorMessage.set(error.message);
          this.actionBusy.set(false);
        }
      });

      this.subscriptions.add(deleteSub);
      return;
    }

    const archiveSub = this.reportService.setArchiveStatus(detail.id, action === 'archive').subscribe({
      next: (result) => {
        this.report.update((current) => (current ? { ...current, archivedAtUtc: result.archivedAtUtc } : current));
        this.actionBusy.set(false);
        this.dialogState.set(null);
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.actionBusy.set(false);
      }
    });

    this.subscriptions.add(archiveSub);
  }

  dialogTitle(): string {
    switch (this.dialogState()) {
      case 'archive':
        return 'Archive report job?';
      case 'restore':
        return 'Restore archived report?';
      case 'delete':
        return 'Delete report job permanently?';
      default:
        return '';
    }
  }

  dialogDescription(): string {
    const detail = this.report();
    if (!detail) {
      return '';
    }

    switch (this.dialogState()) {
      case 'archive':
        return `Archive ${detail.propertyAddress} so it is hidden from standard report views.`;
      case 'restore':
        return `Restore ${detail.propertyAddress} to standard report views.`;
      case 'delete':
        return `Delete ${detail.propertyAddress} and remove its stored files, generated report artifacts, and related database records. This cannot be undone.`;
      default:
        return '';
    }
  }

  dialogConfirmLabel(): string {
    switch (this.dialogState()) {
      case 'archive':
        return 'Archive report';
      case 'restore':
        return 'Restore report';
      case 'delete':
        return 'Delete report';
      default:
        return 'Confirm';
    }
  }

  isDeleteDialog(): boolean {
    return this.dialogState() === 'delete';
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private focusTab(tabId: ReportTabId): void {
    this.document.getElementById(this.tabButtonId(tabId))?.focus();
  }

  private hasCostsTab(vm: ReportDecisionViewModel): boolean {
    return (
      vm.costsNarrative !== null ||
      vm.costsStateGuidance !== null ||
      vm.sectionVisibility.showFinancialCompliance ||
      vm.financialComplianceItems.moneyTiming.length > 0 ||
      vm.financialComplianceItems.complianceApproval.length > 0 ||
      vm.financialComplianceItems.settlementAdjustments.length > 0
    );
  }

  private hasContractTab(vm: ReportDecisionViewModel): boolean {
    return vm.sectionVisibility.showContractConditions || vm.contractConditionItems.length > 0;
  }

  private hasNegotiationTab(vm: ReportDecisionViewModel): boolean {
    return vm.negotiationPlaybookVisible.length > 0 || vm.negotiationPlaybookOverflow.length > 0;
  }

  private hasQuestionsTab(vm: ReportDecisionViewModel): boolean {
    return (
      vm.questionsNarrative !== null ||
      vm.questionsStateGuidance !== null ||
      vm.conveyancerQuestions.length > 0 ||
      vm.overflowConveyancerQuestions.length > 0
    );
  }

  private resolveConveyancerJurisdiction(detail: ReportDetail | null): JurisdictionCode | null {
    const candidates = [
      detail?.stateOrTerritory,
      detail?.jurisdictionProfile?.stateOrTerritory,
      detail?.propertySnapshot?.territory
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeJurisdiction(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private normalizeJurisdiction(value: string | null | undefined): JurisdictionCode | null {
    const normalized = value?.trim().toUpperCase() ?? '';
    return SUPPORTED_JURISDICTIONS.includes(normalized as JurisdictionCode)
      ? (normalized as JurisdictionCode)
      : null;
  }
}
