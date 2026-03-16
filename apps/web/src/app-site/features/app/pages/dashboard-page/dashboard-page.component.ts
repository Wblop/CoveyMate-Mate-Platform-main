import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ReportSummary } from '@shared-core/models/report.models';
import { ReportService } from '@shared-core/services/report.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';
import { UIStatusBadgeComponent } from '@shared-ui/ui/status-badge/status-badge.component';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [DatePipe, RouterLink, UIButtonComponent, UIPageHeaderComponent, UIStatusBadgeComponent, UISkeletonBlockComponent, UIAlertBannerComponent],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardPageComponent {
  private readonly reportService = inject(ReportService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly allReports = signal<ReportSummary[]>([]);

  readonly sortedReports = computed(() =>
    [...this.allReports()].sort((left, right) => this.parseDateOrNow(left.updatedAt).getTime() - this.parseDateOrNow(right.updatedAt).getTime())
  );
  readonly recentReports = computed(() => this.sortedReports().slice(0, 7));
  readonly reportsInProgress = computed(() =>
    this.sortedReports().filter((report) => report.status === 'draft' || report.status === 'processing')
  );
  readonly readyReports = computed(() => this.sortedReports().filter((report) => report.status === 'ready'));
  readonly failedReports = computed(() => this.sortedReports().filter((report) => report.status === 'failed'));
  readonly archivedReports = computed(() => this.sortedReports().filter((report) => Boolean(report.archivedAtUtc)));

  constructor() {
    this.loadDashboard();
  }

  loadDashboard(): void {
    this.loading.set(true);
    this.errorMessage.set('');

    this.reportService.getReports(true).subscribe({
      next: (reports) => {
        this.allReports.set(reports);
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

  reportRowSummary(report: ReportSummary): string {
    if (report.status === 'failed') {
      return report.currentSubStep || report.currentStep || 'Processing failed';
    }

    if (report.status === 'processing') {
      return `${report.percentComplete}% · ${report.currentStep || 'Processing'}`;
    }

    if (report.status === 'draft') {
      return report.currentSubStep || report.currentStep || 'Draft retained for reference';
    }

    return report.currentSubStep || report.currentStep || 'Ready to open';
  }

  openReport(reportId: string): void {
    void this.router.navigate(['/reports', reportId]);
  }

  primaryActionLabel(report: ReportSummary): string {
    return report.status === 'ready' ? 'Open report' : 'View detail';
  }

  private parseDateOrNow(value: string): Date {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}
