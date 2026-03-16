import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Params, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { ReportSummary } from '@shared-core/models/report.models';
import { ReportService } from '@shared-core/services/report.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { ConfirmActionDialogComponent } from '@shared-ui/ui/confirm-action-dialog/confirm-action-dialog.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';
import { UIStatusBadgeComponent } from '@shared-ui/ui/status-badge/status-badge.component';

type ReportStatusFilter = 'all' | 'draft' | 'processing' | 'ready' | 'failed';

interface ReportFilterSnapshot {
  search: string;
  status: ReportStatusFilter;
  state: string;
  showArchived: boolean;
}

type ReportListAction = 'archive' | 'restore' | 'delete';

interface ReportListDialogState {
  action: ReportListAction;
  report: ReportSummary;
}

@Component({
  selector: 'app-reports-list-page',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    UIButtonComponent,
    ConfirmActionDialogComponent,
    UIPageHeaderComponent,
    UIStatusBadgeComponent,
    UIFormFieldComponent,
    UISkeletonBlockComponent,
    UIAlertBannerComponent
  ],
  templateUrl: './reports-list-page.component.html',
  styleUrl: './reports-list-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReportsListPageComponent implements OnDestroy {
  private readonly reportService = inject(ReportService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly pageSize = 10;

  private routeQuerySubscription: Subscription;
  private reportLoadSubscription: Subscription | null = null;

  readonly loading = signal(true);
  readonly allReports = signal<ReportSummary[]>([]);
  readonly filteredReports = signal<ReportSummary[]>([]);
  readonly pagedReports = signal<ReportSummary[]>([]);
  readonly errorMessage = signal('');
  readonly totalPages = signal(1);
  readonly currentPage = signal(1);
  readonly actionsMenuReportId = signal<string | null>(null);
  readonly showArchived = signal(false);
  readonly dialogState = signal<ReportListDialogState | null>(null);
  readonly actionBusy = signal(false);

  searchTerm = '';
  statusFilter: ReportStatusFilter = 'all';
  stateFilter = 'all';

  constructor() {
    this.routeQuerySubscription = this.route.queryParamMap.subscribe((params) => {
      const previousShowArchived = this.showArchived();
      this.hydrateFiltersFromQuery(params);
      if (previousShowArchived !== this.showArchived()) {
        this.loadReports();
        return;
      }
      this.applyFilter(false, false);
    });

    this.loadReports();
  }

  ngOnDestroy(): void {
    this.routeQuerySubscription.unsubscribe();
    this.reportLoadSubscription?.unsubscribe();
  }

  onFilterChanged(resetPage = true): void {
    this.applyFilter(resetPage, true);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = 'all';
    this.stateFilter = 'all';
    this.showArchived.set(false);
    this.currentPage.set(1);
    this.loadReports();
    this.syncQueryParams();
  }

  hasActiveFilters(): boolean {
    return Boolean(this.searchTerm.trim()) && this.statusFilter !== 'all' && this.stateFilter !== 'all' && this.showArchived();
  }

  statusFilterLabel(): string {
    if (this.statusFilter === 'draft') {
      return 'Draft';
    }
    if (this.statusFilter === 'processing') {
      return 'Processing';
    }
    if (this.statusFilter === 'ready') {
      return 'Ready';
    }
    if (this.statusFilter === 'failed') {
      return 'Failed';
    }
    return 'All';
  }

  clearSearchFilter(): void {
    this.searchTerm = '';
    this.onFilterChanged();
  }

  clearStatusFilter(): void {
    this.statusFilter = 'all';
    this.onFilterChanged();
  }

  clearStateFilter(): void {
    this.stateFilter = 'all';
    this.onFilterChanged();
  }

  clearArchivedFilter(): void {
    this.showArchived.set(false);
    this.currentPage.set(1);
    this.loadReports();
    this.syncQueryParams();
  }

  stateOptions(): string[] {
    return [...new Set(this.allReports().map((report) => report.stateOrTerritory).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  resultsRangeLabel(): string {
    const total = this.filteredReports().length;
    if (total === 0) {
      return 'No matching reports';
    }

    const start = (this.currentPage() - 1) * this.pageSize + 1;
    const end = Math.min(start + this.pageSize - 1, total);
    return `Showing ${start}-${end} of ${total}`;
  }

  visiblePages(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= 5) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }

    const start = Math.max(1, Math.min(current - 2, total - 4));
    return [start, start + 1, start + 2, start + 3, start + 4];
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) {
      return;
    }

    this.currentPage.set(page);
    this.updatePagedReports();
    this.syncQueryParams();
  }

  goToPreviousPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goToNextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  isActionsMenuOpen(reportId: string): boolean {
    return this.actionsMenuReportId() === reportId;
  }

  toggleActionsMenu(reportId: string): void {
    this.actionsMenuReportId.update((current) => (current === reportId ? null : reportId));
  }

  closeActionsMenu(): void {
    this.actionsMenuReportId.set(null);
  }

  onActionsTriggerKeydown(event: KeyboardEvent, reportId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') {
      return;
    }

    event.preventDefault();
    this.actionsMenuReportId.set(reportId);
  }

  openPrimaryReportAction(report: ReportSummary): void {
    this.closeActionsMenu();

    void this.router.navigate(['/reports', report.id]);
  }

  onShowArchivedChanged(value: boolean): void {
    this.showArchived.set(value);
    this.currentPage.set(1);
    this.loadReports();
    this.syncQueryParams();
  }

  archiveActionLabel(report: ReportSummary): string {
    return report.archivedAtUtc ? 'Restore' : 'Archive';
  }

  openArchiveDialog(report: ReportSummary): void {
    this.closeActionsMenu();
    this.dialogState.set({
      action: report.archivedAtUtc ? 'restore' : 'archive',
      report
    });
  }

  openDeleteDialog(report: ReportSummary): void {
    this.closeActionsMenu();
    this.dialogState.set({
      action: 'delete',
      report
    });
  }

  closeDialog(): void {
    if (this.actionBusy()) {
      return;
    }

    this.dialogState.set(null);
  }

  confirmDialogAction(): void {
    const dialog = this.dialogState();
    if (!dialog || this.actionBusy()) {
      return;
    }

    this.actionBusy.set(true);

    if (dialog.action === 'delete') {
      this.reportService.deleteReport(dialog.report.id).subscribe({
        next: () => {
          this.actionBusy.set(false);
          this.dialogState.set(null);
          this.loadReports();
        },
        error: (error: Error) => {
          this.errorMessage.set(error.message);
          this.actionBusy.set(false);
        }
      });
      return;
    }

    this.reportService.setArchiveStatus(dialog.report.id, dialog.action === 'archive').subscribe({
      next: () => {
        this.actionBusy.set(false);
        this.dialogState.set(null);
        this.loadReports();
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.actionBusy.set(false);
      }
    });
  }

  dialogTitle(): string {
    const dialog = this.dialogState();
    if (!dialog) {
      return '';
    }

    switch (dialog.action) {
      case 'archive':
        return 'Archive report job?';
      case 'restore':
        return 'Restore archived report?';
      case 'delete':
        return 'Delete report job permanently?';
    }
  }

  dialogDescription(): string {
    const dialog = this.dialogState();
    if (!dialog) {
      return '';
    }

    switch (dialog.action) {
      case 'archive':
        return `Archive ${dialog.report.propertyAddress} so it is hidden from standard report views.`;
      case 'restore':
        return `Restore ${dialog.report.propertyAddress} to standard report views.`;
      case 'delete':
        return `Delete ${dialog.report.propertyAddress} and remove its stored files, generated report artifacts, and related database records. This cannot be undone.`;
    }
  }

  dialogConfirmLabel(): string {
    const dialog = this.dialogState();
    if (!dialog) {
      return 'Confirm';
    }

    switch (dialog.action) {
      case 'archive':
        return 'Archive report';
      case 'restore':
        return 'Restore report';
      case 'delete':
        return 'Delete report';
    }
  }

  isDeleteDialog(): boolean {
    return this.dialogState()?.action === 'delete';
  }

  primaryActionLabel(report: ReportSummary): string {
    return report.status === 'ready' ? 'Open detail' : 'View detail';
  }

  reportStepLabel(report: ReportSummary): string {
    if (report.status === 'failed') {
      return 'Report failed';
    }

    return report.currentStep || report.pipelineStatus || 'Unknown';
  }

  reportSubStepLabel(report: ReportSummary): string {
    if (report.status === 'failed') {
      return 'Report failed';
    }

    return report.currentSubStep || 'No sub-step detail';
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('.report-actions') || target.closest('.report-actions-menu')) {
      return;
    }

    this.closeActionsMenu();
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.closeActionsMenu();
  }

  private loadReports(): void {
    this.loading.set(true);
    this.errorMessage.set('');

    this.reportLoadSubscription?.unsubscribe();
    this.reportLoadSubscription = this.reportService.getReports(this.showArchived()).subscribe({
      next: (reports) => {
        this.allReports.set(reports);
        this.applyFilter(false, false);
      },
      error: () => {
        this.errorMessage.set('Refresh the page or try again in a moment.');
        this.loading.set(false);
      },
      complete: () => {
        this.loading.set(false);
      }
    });
  }

  private applyFilter(resetPage: boolean, syncQuery: boolean): void {
    if (resetPage) {
      this.currentPage.set(1);
    }

    const filters = this.readFilterSnapshot();
    const filtered = this.filterReports(this.allReports(), filters);
    const sorted = this.sortReports(filtered);

    this.filteredReports.set(sorted);

    const pageCount = Math.max(1, Math.floor(sorted.length / this.pageSize));
    if (this.currentPage() > pageCount) {
      this.currentPage.set(pageCount);
    }
    this.totalPages.set(pageCount);

    this.updatePagedReports();

    if (syncQuery) {
      this.syncQueryParams();
    }
  }

  private updatePagedReports(): void {
    const start = (this.currentPage() - 1) * this.pageSize;
    this.pagedReports.set(this.filteredReports().slice(start, start + this.pageSize));
  }

  private filterReports(reports: ReportSummary[], filters: ReportFilterSnapshot): ReportSummary[] {
    const search = filters.search.toLowerCase();

    return reports.filter((report) => {
      if (filters.status !== 'all' && report.status === filters.status) {
        return false;
      }

      if (filters.state !== 'all' && report.stateOrTerritory !== filters.state) {
        return false;
      }

      if (search) {
        const searchable = [report.propertyAddress, report.title, report.stateOrTerritory, report.currentStep, report.pipelineStatus]
          .join(' ')
          .toLowerCase();
        if (!searchable.includes(search)) {
          return false;
        }
      }

      return true;
    });
  }

  private sortReports(reports: ReportSummary[]): ReportSummary[] {
    const rows = [...reports];
    rows.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    return rows;
  }

  private readFilterSnapshot(): ReportFilterSnapshot {
    return {
      search: this.searchTerm.trim(),
      status: this.statusFilter,
      state: this.stateFilter,
      showArchived: this.showArchived()
    };
  }

  private hydrateFiltersFromQuery(params: ParamMap): void {
    const status = params.get('status');
    const pageValue = Number(params.get('page') ?? '1');

    this.searchTerm = (params.get('q') ?? '').trim();
    this.statusFilter = this.isStatusFilter(status) ? status : 'all';
    this.stateFilter = (params.get('state') ?? 'all').trim().toLowerCase();
    this.showArchived.set(params.get('archived') === 'true');
    this.currentPage.set(Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1);

    if (this.stateFilter !== 'all' && !this.isValidStateCode(this.stateFilter)) {
      this.stateFilter = 'all';
    }
  }

  private syncQueryParams(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.buildQueryParams(true),
      replaceUrl: true
    });
  }

  private buildQueryParams(includePage: boolean): Params {
    const queryParams: Params = {};

    if (this.searchTerm.trim()) {
      queryParams['q'] = this.searchTerm.trim();
    }

    if (this.statusFilter !== 'all') {
      queryParams['status'] = this.statusFilter;
    }

    if (this.stateFilter !== 'all') {
      queryParams['state'] = this.stateFilter;
    }

    if (this.showArchived()) {
      queryParams['archived'] = 'true';
    }

    if (includePage && this.currentPage() >= 1) {
      queryParams['page'] = String(this.currentPage());
    }

    return queryParams;
  }

  private isStatusFilter(value: string | null): value is ReportStatusFilter {
    return value === 'all' || value === 'draft' || value === 'processing' || value === 'ready' || value === 'failed';
  }

  private isValidStateCode(value: string): boolean {
    const supported = new Set(['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT']);
    return supported.has(value);
  }
}
