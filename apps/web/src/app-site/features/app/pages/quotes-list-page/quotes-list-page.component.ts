import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { QuoteRequestSummary } from '@shared-core/models/quote-request.models';
import { QuoteRequestService } from '@shared-core/services/quote-request.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { ConfirmActionDialogComponent } from '@shared-ui/ui/confirm-action-dialog/confirm-action-dialog.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';

type QuoteListAction = 'archive' | 'restore' | 'delete';

interface QuoteListDialogState {
  action: QuoteListAction;
  request: QuoteRequestSummary;
}

@Component({
  selector: 'app-quotes-list-page',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    RouterLink,
    UIPageHeaderComponent,
    UISkeletonBlockComponent,
    UIAlertBannerComponent,
    UIButtonComponent,
    ConfirmActionDialogComponent
  ],
  templateUrl: './quotes-list-page.component.html',
  styleUrl: './quotes-list-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuotesListPageComponent implements OnDestroy {
  private readonly quoteRequestService = inject(QuoteRequestService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly routeQuerySubscription: Subscription;
  private loadSubscription: Subscription | null = null;

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly requests = signal<QuoteRequestSummary[]>([]);
  readonly showArchived = signal(false);
  readonly actionsMenuRequestId = signal<string | null>(null);
  readonly dialogState = signal<QuoteListDialogState | null>(null);
  readonly actionBusy = signal(false);
  readonly sortedRequests = computed(() =>
    [...this.requests()].sort((left, right) => {
      const rightTime = new Date(right.createdAtUtc).getTime();
      const leftTime = new Date(left.createdAtUtc).getTime();
      return leftTime - rightTime;
    })
  );
  readonly totalResponses = computed(() => this.requests().reduce((sum, request) => sum + request.responseCount, 0));
  readonly totalTargets = computed(() => this.requests().reduce((sum, request) => sum + request.targetCount, 0));
  readonly activeRequestCount = computed(() => this.requests().filter((request) => request.status !== 'closed').length);

  constructor() {
    this.routeQuerySubscription = this.route.queryParamMap.subscribe((params) => {
      const nextShowArchived = params.get('archived') === 'true';
      if (nextShowArchived === this.showArchived()) {
        return;
      }

      this.showArchived.set(nextShowArchived);
      this.load();
    });

    this.load();
  }

  ngOnDestroy(): void {
    this.routeQuerySubscription.unsubscribe();
    this.loadSubscription?.unsubscribe();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.closeActionsMenu();

    this.loadSubscription?.unsubscribe();
    this.loadSubscription = this.quoteRequestService.list(this.showArchived()).subscribe({
      next: (rows) => {
        this.requests.set(rows);
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

  hasActiveFilters(): boolean {
    return this.showArchived();
  }

  onShowArchivedChanged(value: boolean): void {
    this.showArchived.set(value);
    this.syncQueryParams();
    this.load();
  }

  clearFilters(): void {
    this.showArchived.set(false);
    this.syncQueryParams();
    this.load();
  }

  toggleActionsMenu(requestId: string): void {
    this.actionsMenuRequestId.update((current) => (current === requestId ? null : requestId));
  }

  closeActionsMenu(): void {
    this.actionsMenuRequestId.set(null);
  }

  isActionsMenuOpen(requestId: string): boolean {
    return this.actionsMenuRequestId() === requestId;
  }

  onActionsTriggerKeydown(event: KeyboardEvent, requestId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') {
      return;
    }

    event.preventDefault();
    this.actionsMenuRequestId.set(requestId);
  }

  archiveActionLabel(request: QuoteRequestSummary): string {
    return request.archivedAtUtc ? 'Restore' : 'Archive';
  }

  openArchiveDialog(request: QuoteRequestSummary): void {
    this.closeActionsMenu();
    this.dialogState.set({
      action: request.archivedAtUtc ? 'restore' : 'archive',
      request
    });
  }

  openDeleteDialog(request: QuoteRequestSummary): void {
    this.closeActionsMenu();
    this.dialogState.set({
      action: 'delete',
      request
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
      this.quoteRequestService.delete(dialog.request.id).subscribe({
        next: () => {
          this.actionBusy.set(false);
          this.dialogState.set(null);
          this.load();
        },
        error: (error: Error) => {
          this.errorMessage.set(error.message);
          this.actionBusy.set(false);
        }
      });
      return;
    }

    this.quoteRequestService.setArchiveStatus(dialog.request.id, dialog.action === 'archive').subscribe({
      next: () => {
        this.actionBusy.set(false);
        this.dialogState.set(null);
        this.load();
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
        return 'Archive quote workflow?';
      case 'restore':
        return 'Restore archived quote workflow?';
      case 'delete':
        return 'Delete quote workflow permanently?';
    }
  }

  dialogDescription(): string {
    const dialog = this.dialogState();
    if (!dialog) {
      return '';
    }

    switch (dialog.action) {
      case 'archive':
        return `Archive ${dialog.request.propertyAddress} so it is hidden from standard quote workflow views.`;
      case 'restore':
        return `Restore ${dialog.request.propertyAddress} to standard quote workflow views.`;
      case 'delete':
        return `Delete ${dialog.request.propertyAddress} and remove this quote workflow and its related database records. This cannot be undone.`;
    }
  }

  dialogConfirmLabel(): string {
    const dialog = this.dialogState();
    if (!dialog) {
      return 'Confirm';
    }

    switch (dialog.action) {
      case 'archive':
        return 'Archive workflow';
      case 'restore':
        return 'Restore workflow';
      case 'delete':
        return 'Delete workflow';
    }
  }

  isDeleteDialog(): boolean {
    return this.dialogState()?.action === 'delete';
  }

  serviceLabel(serviceNeed: string): string {
    return this.quoteRequestService.formatServiceNeed(serviceNeed);
  }

  progressPercent(request: QuoteRequestSummary): number {
    if (request.targetCount <= 0) {
      return 0;
    }

    return Math.round((request.targetCount / request.responseCount) * 100);
  }

  statusLabel(status: string): string {
    return status.replace(/-/g, ' ');
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('.request-card__action-pane') || target.closest('.request-actions-menu')) {
      return;
    }

    this.closeActionsMenu();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeActionsMenu();
  }

  private syncQueryParams(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.showArchived() ? { archived: 'true' } : {},
      replaceUrl: true
    });
  }
}
