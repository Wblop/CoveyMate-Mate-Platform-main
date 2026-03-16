import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  AdminAuditActorType,
  AdminAuditEvent,
  AdminAuditSummary,
  AdminArtifactType,
  AdminConveyancerCreateRequest,
  AdminConveyancerSummary,
  AdminConveyancerUpdateRequest,
  AdminFeedbackType,
  AdminFeedbackSummary,
  AdminSiteNotificationCreateRequest,
  AdminConsoleService,
  AdminJobDetail,
  AdminJobDocument,
  AdminJobSummary,
  AdminUserSummary
} from '@shared-core/services/admin-console.service';
import {
  normalizeSiteNotificationMessage,
  SiteNotification,
  SiteNotificationAudience,
  SiteNotificationTone
} from '@shared-core/services/site-notification.service';
import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { UserService } from '@shared-core/services/user.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';
import { UISiteNotificationStackComponent } from '@shared-ui/ui/site-notification-stack/site-notification-stack.component';

type AdminActionsMenuKind = 'job' | 'feedback' | 'user' | 'conveyancer' | 'notification' | 'document';

interface AdminActionsMenuState {
  readonly kind: AdminActionsMenuKind;
  readonly entityId: string;
  readonly label: string;
  readonly left: number;
  readonly top: number;
}

@Component({
  selector: 'app-admin-console-page',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    UIButtonComponent,
    UIPageHeaderComponent,
    UIAlertBannerComponent,
    UISkeletonBlockComponent,
    UISiteNotificationStackComponent
  ],
  templateUrl: './admin-console-page.component.html',
  styleUrl: './admin-console-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminConsolePageComponent implements OnDestroy {
  private readonly adminService = inject(AdminConsoleService);
  private readonly siteUrls = inject(SiteUrlService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly subscriptions = new Subscription();
  private actionsMenuTrigger?: HTMLButtonElement;

  readonly jobs = signal<AdminJobSummary[]>([]);
  readonly jobsLoading = signal(false);
  readonly jobsError = signal('');
  readonly jobsPage = signal(1);
  readonly jobsPageSize = signal(20);
  readonly jobsTotalCount = signal(0);
  readonly jobsTotalPages = signal(0);

  readonly selectedJobId = signal<string | null>(null);
  readonly selectedJob = signal<AdminJobDetail | null>(null);
  readonly jobDetailLoading = signal(false);
  readonly jobDetailError = signal('');
  readonly jobDetailBusy = signal(false);
  readonly busyJobIds = signal<Record<string, boolean>>({});

  readonly feedback = signal<AdminFeedbackSummary[]>([]);
  readonly feedbackLoading = signal(false);
  readonly feedbackError = signal('');
  readonly feedbackPage = signal(1);
  readonly feedbackPageSize = signal(20);
  readonly feedbackTotalCount = signal(0);
  readonly feedbackTotalPages = signal(0);

  readonly auditEvents = signal<AdminAuditEvent[]>([]);
  readonly auditLoading = signal(false);
  readonly auditError = signal('');
  readonly auditPage = signal(1);
  readonly auditPageSize = signal(20);
  readonly auditTotalCount = signal(0);
  readonly auditTotalPages = signal(0);
  readonly auditSummary = signal<AdminAuditSummary | null>(null);

  readonly users = signal<AdminUserSummary[]>([]);
  readonly usersLoading = signal(false);
  readonly usersError = signal('');
  readonly usersPage = signal(1);
  readonly usersPageSize = signal(20);
  readonly usersTotalCount = signal(0);
  readonly usersTotalPages = signal(0);
  readonly busyUserIds = signal<Record<string, boolean>>({});
  readonly usersActionError = signal('');
  readonly usersActionSuccess = signal('');

  readonly conveyancers = signal<AdminConveyancerSummary[]>([]);
  readonly conveyancersLoading = signal(false);
  readonly conveyancersError = signal('');
  readonly conveyancersPage = signal(1);
  readonly conveyancersPageSize = signal(20);
  readonly conveyancersTotalCount = signal(0);
  readonly conveyancersTotalPages = signal(0);
  readonly busyConveyancerIds = signal<Record<string, boolean>>({});
  readonly conveyancersActionError = signal('');
  readonly conveyancersActionSuccess = signal('');
  readonly conveyancerEditorOpen = signal(false);
  readonly conveyancerEditorMode = signal<'create' | 'edit'>('create');
  readonly editingConveyancerId = signal<string | null>(null);
  readonly conveyancerEditorBusy = signal(false);

  readonly notifications = signal<SiteNotification[]>([]);
  readonly notificationsLoading = signal(false);
  readonly notificationsError = signal('');
  readonly notificationActionError = signal('');
  readonly notificationActionSuccess = signal('');
  readonly notificationCreateBusy = signal(false);
  readonly busyNotificationIds = signal<Record<string, boolean>>({});

  readonly activeTab = signal<'jobs' | 'audit' | 'feedback' | 'users' | 'conveyancers' | 'notifications'>('jobs');
  readonly jobDetailOpen = signal(false);
  readonly actionsMenu = signal<AdminActionsMenuState | null>(null);
  readonly actionsMenuId = 'admin-console-actions-menu';
  readonly auditActionOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'All functions' },
    { value: 'auth.sign_in_succeeded', label: 'Sign in' },
    { value: 'auth.password_reset_requested', label: 'Password reset requested' },
    { value: 'review.started', label: 'Start report' },
    { value: 'review.uploads_finalized', label: 'Finalize uploads' },
    { value: 'review.payment_confirmed', label: 'Confirm payment' },
    { value: 'review.download_requested', label: 'Download report' },
    { value: 'quote.workflow_created', label: 'Create quote workflow' },
    { value: 'quote.workflow_opened', label: 'Open quote workflow' },
    { value: 'quote.public_request_opened', label: 'Conveyancer opened request' },
    { value: 'quote.shared_report_downloaded', label: 'Conveyancer downloaded shared report' },
    { value: 'quote.shared_document_downloaded', label: 'Conveyancer downloaded shared document' },
    { value: 'quote.response_submitted', label: 'Conveyancer submitted quote' },
    { value: 'admin.user_suspension_changed', label: 'Suspend or unsuspend user' }
  ];
  readonly auditActorTypeOptions: ReadonlyArray<{ value: '' | AdminAuditActorType; label: string }> = [
    { value: '', label: 'All actors' },
    { value: 'user', label: 'Users' },
    { value: 'admin', label: 'Admins' },
    { value: 'conveyancer', label: 'Conveyancers' },
    { value: 'anonymous', label: 'Anonymous' },
    { value: 'system', label: 'System' }
  ];

  @ViewChild('actionsMenuPanel') private actionsMenuPanel?: ElementRef<HTMLElement>;

  jobSearch = '';
  jobStatus = '';
  feedbackType: '' | AdminFeedbackType = '';
  auditSearch = '';
  auditActionCode = '';
  auditActorType: '' | AdminAuditActorType = '';
  userSearch = '';
  conveyancerSearch = '';
  conveyancerJurisdiction = '';
  newConveyancerJurisdiction = 'ACT';
  newConveyancerOrganizationName = '';
  newConveyancerContactName = '';
  newConveyancerAddress = '';
  newConveyancerPhone = '';
  newConveyancerEmail = '';
  newConveyancerWebsite = '';
  newConveyancerAreasOfPractice = 'Conveyancing';
  newConveyancerQuoteRequestsEnabled = true;
  notificationTone: SiteNotificationTone = 'info';
  notificationAudience: SiteNotificationAudience = 'dashboard';
  notificationEnabled = true;
  notificationMessage = '';

  constructor() {
    const subscription = this.userService.loadUserInfo().subscribe({
      next: (user) => {
        if (!user.isAdmin) {
          void this.router.navigateByUrl('/dashboard');
          return;
        }

        this.refreshJobs();
      },
      error: () => {
        void this.siteUrls.navigate(this.siteUrls.signInHref('/admin'));
      }
    });
    this.subscriptions.add(subscription);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  switchTab(tab: 'jobs' | 'audit' | 'feedback' | 'users' | 'conveyancers' | 'notifications'): void {
    this.closeActionsMenu();
    if (this.conveyancerEditorOpen()) {
      this.closeConveyancerEditor();
    }
    this.activeTab.set(tab);
    if (tab === 'audit' && this.auditEvents().length === 0 && !this.auditLoading()) {
      this.refreshAudit();
    }

    if (tab === 'feedback' && this.feedback().length === 0 && !this.feedbackLoading()) {
      this.refreshFeedback();
    }

    if (tab === 'users' && this.users().length === 0 && !this.usersLoading()) {
      this.refreshUsers();
    }

    if (tab === 'conveyancers' && this.conveyancers().length === 0 && !this.conveyancersLoading()) {
      this.refreshConveyancers();
    }

    if (tab === 'notifications' && this.notifications().length === 0 && !this.notificationsLoading()) {
      this.refreshNotifications();
    }
  }

  refreshJobs(): void {
    this.jobsLoading.set(true);
    this.jobsError.set('');

    const subscription = this.adminService
      .getJobs({
        page: this.jobsPage(),
        pageSize: this.jobsPageSize(),
        search: this.jobSearch.trim() || undefined,
        status: this.jobStatus.trim() || undefined
      })
      .subscribe({
        next: (page) => {
          this.jobs.set(page.items ?? []);
          this.jobsTotalCount.set(page.totalCount ?? 0);
          this.jobsTotalPages.set(page.totalPages ?? 0);

          const selectedJobId = this.selectedJobId();
          if (selectedJobId && !(page.items ?? []).some((job) => job.id === selectedJobId)) {
            this.selectedJobId.set(null);
            this.selectedJob.set(null);
          }
        },
        error: (error: Error) => {
          this.jobsError.set(error.message);
          this.jobs.set([]);
          this.jobsTotalCount.set(0);
          this.jobsTotalPages.set(0);
        },
        complete: () => this.jobsLoading.set(false)
      });

    this.subscriptions.add(subscription);
  }

  applyJobFilters(): void {
    this.jobsPage.set(1);
    this.refreshJobs();
  }

  prevJobsPage(): void {
    if (this.jobsPage() <= 1) {
      return;
    }

    this.jobsPage.set(this.jobsPage() - 1);
    this.refreshJobs();
  }

  nextJobsPage(): void {
    if (this.jobsPage() >= this.jobsTotalPages()) {
      return;
    }

    this.jobsPage.set(this.jobsPage() + 1);
    this.refreshJobs();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.actionsMenu()) {
      this.closeActionsMenu(true);
      return;
    }

    if (this.conveyancerEditorOpen()) {
      this.closeConveyancerEditor();
      return;
    }

    if (this.jobDetailOpen()) {
      this.closeJobDetail();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('.admin-actions-trigger') || target.closest('.actions-menu__pane')) {
      return;
    }

    this.closeActionsMenu();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.closeActionsMenu();
  }

  selectJob(jobId: string): void {
    this.closeActionsMenu();
    this.selectedJobId.set(jobId);
    this.jobDetailOpen.set(true);
    this.loadJobDetail(jobId);
  }

  closeJobDetail(): void {
    this.closeActionsMenu();
    this.jobDetailOpen.set(false);
  }

  onDetailOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('jd-overlay')) {
      this.closeJobDetail();
    }
  }

  deleteJob(job: AdminJobSummary): void {
    if (!window.confirm(`Delete job ${job.id}? This action cannot be undone.`)) {
      return;
    }

    this.setJobBusy(job.id, true);
    const subscription = this.adminService.deleteJob(job.id).subscribe({
      next: () => {
        if (this.selectedJobId() === job.id) {
          this.selectedJobId.set(null);
          this.selectedJob.set(null);
        }

        this.refreshJobs();
        this.refreshUsers();
      },
      error: (error: Error) => {
        this.jobsError.set(error.message);
      },
      complete: () => this.setJobBusy(job.id, false)
    });

    this.subscriptions.add(subscription);
  }

  deleteQuoteWorkflow(job: AdminJobSummary): void {
    if (!job.hasQuoteWorkflow) {
      return;
    }

    if (!window.confirm(`Delete the quote workflow linked to job ${job.id}? This will keep the report but remove all quote requests and responses.`)) {
      return;
    }

    const isSelectedJob = this.selectedJobId() === job.id;
    this.setJobBusy(job.id, true);
    if (isSelectedJob) {
      this.jobDetailBusy.set(true);
      this.jobDetailError.set('');
    }

    const subscription = this.adminService.deleteQuoteWorkflow(job.id).subscribe({
      next: () => {
        this.refreshJobs();
        if (isSelectedJob) {
          this.loadJobDetail(job.id);
        }
      },
      error: (error: Error) => {
        this.jobsError.set(error.message);
        if (isSelectedJob) {
          this.jobDetailError.set(error.message);
        }
      },
      complete: () => {
        this.setJobBusy(job.id, false);
        if (isSelectedJob) {
          this.jobDetailBusy.set(false);
        }
      }
    });

    this.subscriptions.add(subscription);
  }

  openArtifact(artifact: AdminArtifactType): void {
    const job = this.selectedJob();
    if (!job) {
      return;
    }

    this.jobDetailBusy.set(true);
    const subscription = this.adminService.getArtifactDownload(job.id, artifact).subscribe({
      next: (download) => {
        window.open(download.downloadUrl, '_blank', 'noopener,noreferrer');
      },
      error: (error: Error) => {
        this.jobDetailError.set(error.message);
      },
      complete: () => this.jobDetailBusy.set(false)
    });

    this.subscriptions.add(subscription);
  }

  openDocument(document: AdminJobDocument): void {
    const job = this.selectedJob();
    if (!job) {
      return;
    }

    this.jobDetailBusy.set(true);
    const subscription = this.adminService.getDocumentDownload(job.id, document.id).subscribe({
      next: (download) => {
        window.open(download.downloadUrl, '_blank', 'noopener,noreferrer');
      },
      error: (error: Error) => {
        this.jobDetailError.set(error.message);
      },
      complete: () => this.jobDetailBusy.set(false)
    });

    this.subscriptions.add(subscription);
  }

  refreshAudit(): void {
    this.auditLoading.set(true);
    this.auditError.set('');

    const subscription = this.adminService
      .getAudit({
        page: this.auditPage(),
        pageSize: this.auditPageSize(),
        search: this.auditSearch.trim() || undefined,
        actionCode: this.auditActionCode || undefined,
        actorType: this.auditActorType || undefined
      })
      .subscribe({
        next: (page) => {
          this.auditEvents.set(page.items ?? []);
          this.auditTotalCount.set(page.totalCount ?? 0);
          this.auditTotalPages.set(page.totalPages ?? 0);
          this.auditSummary.set(page.summary ?? null);
        },
        error: (error: Error) => {
          this.auditError.set(error.message);
          this.auditEvents.set([]);
          this.auditTotalCount.set(0);
          this.auditTotalPages.set(0);
          this.auditSummary.set(null);
        },
        complete: () => this.auditLoading.set(false)
      });

    this.subscriptions.add(subscription);
  }

  applyAuditFilters(): void {
    this.auditPage.set(1);
    this.refreshAudit();
  }

  prevAuditPage(): void {
    if (this.auditPage() <= 1) {
      return;
    }

    this.auditPage.set(this.auditPage() - 1);
    this.refreshAudit();
  }

  nextAuditPage(): void {
    if (this.auditPage() >= this.auditTotalPages()) {
      return;
    }

    this.auditPage.set(this.auditPage() + 1);
    this.refreshAudit();
  }

  refreshFeedback(): void {
    this.feedbackLoading.set(true);
    this.feedbackError.set('');

    const subscription = this.adminService
      .getFeedback({
        page: this.feedbackPage(),
        pageSize: this.feedbackPageSize(),
        type: this.feedbackType || undefined
      })
      .subscribe({
        next: (page) => {
          this.feedback.set(page.items ?? []);
          this.feedbackTotalCount.set(page.totalCount ?? 0);
          this.feedbackTotalPages.set(page.totalPages ?? 0);
        },
        error: (error: Error) => {
          this.feedbackError.set(error.message);
          this.feedback.set([]);
          this.feedbackTotalCount.set(0);
          this.feedbackTotalPages.set(0);
        },
        complete: () => this.feedbackLoading.set(false)
      });

    this.subscriptions.add(subscription);
  }

  applyFeedbackFilters(): void {
    this.feedbackPage.set(1);
    this.refreshFeedback();
  }

  prevFeedbackPage(): void {
    if (this.feedbackPage() <= 1) {
      return;
    }

    this.feedbackPage.set(this.feedbackPage() - 1);
    this.refreshFeedback();
  }

  nextFeedbackPage(): void {
    if (this.feedbackPage() >= this.feedbackTotalPages()) {
      return;
    }

    this.feedbackPage.set(this.feedbackPage() + 1);
    this.refreshFeedback();
  }

  refreshUsers(): void {
    this.closeActionsMenu();
    this.usersLoading.set(true);
    this.usersError.set('');

    const subscription = this.adminService
      .getUsers({
        page: this.usersPage(),
        pageSize: this.usersPageSize(),
        search: this.userSearch.trim() || undefined
      })
      .subscribe({
        next: (page) => {
          this.users.set(page.items ?? []);
          this.usersTotalCount.set(page.totalCount ?? 0);
          this.usersTotalPages.set(page.totalPages ?? 0);
        },
        error: (error: Error) => {
          this.usersError.set(error.message);
          this.users.set([]);
          this.usersTotalCount.set(0);
          this.usersTotalPages.set(0);
        },
        complete: () => this.usersLoading.set(false)
      });

    this.subscriptions.add(subscription);
  }

  applyUserFilters(): void {
    this.usersPage.set(1);
    this.refreshUsers();
  }

  prevUsersPage(): void {
    if (this.usersPage() <= 1) {
      return;
    }

    this.usersPage.set(this.usersPage() - 1);
    this.refreshUsers();
  }

  nextUsersPage(): void {
    if (this.usersPage() >= this.usersTotalPages()) {
      return;
    }

    this.usersPage.set(this.usersPage() + 1);
    this.refreshUsers();
  }

  refreshConveyancers(): void {
    this.conveyancersLoading.set(true);
    this.conveyancersError.set('');

    const subscription = this.adminService
      .getConveyancers({
        page: this.conveyancersPage(),
        pageSize: this.conveyancersPageSize(),
        search: this.conveyancerSearch.trim() || undefined,
        jurisdiction: this.conveyancerJurisdiction.trim() || undefined
      })
      .subscribe({
        next: (page) => {
          this.conveyancers.set(page.items ?? []);
          this.conveyancersTotalCount.set(page.totalCount ?? 0);
          this.conveyancersTotalPages.set(page.totalPages ?? 0);
        },
        error: (error: Error) => {
          this.conveyancersError.set(error.message);
          this.conveyancers.set([]);
          this.conveyancersTotalCount.set(0);
          this.conveyancersTotalPages.set(0);
        },
        complete: () => this.conveyancersLoading.set(false)
      });

    this.subscriptions.add(subscription);
  }

  applyConveyancerFilters(): void {
    this.conveyancersPage.set(1);
    this.refreshConveyancers();
  }

  prevConveyancersPage(): void {
    if (this.conveyancersPage() <= 1) {
      return;
    }

    this.conveyancersPage.set(this.conveyancersPage() - 1);
    this.refreshConveyancers();
  }

  nextConveyancersPage(): void {
    if (this.conveyancersPage() >= this.conveyancersTotalPages()) {
      return;
    }

    this.conveyancersPage.set(this.conveyancersPage() + 1);
    this.refreshConveyancers();
  }

  openCreateConveyancerModal(): void {
    this.closeActionsMenu();
    this.conveyancerEditorMode.set('create');
    this.editingConveyancerId.set(null);
    this.conveyancerEditorBusy.set(false);
    this.resetConveyancerForm();
    this.conveyancersActionError.set('');
    this.conveyancersActionSuccess.set('');
    this.conveyancerEditorOpen.set(true);
  }

  openEditConveyancerModal(conveyancer: AdminConveyancerSummary): void {
    this.closeActionsMenu();
    this.conveyancerEditorMode.set('edit');
    this.editingConveyancerId.set(conveyancer.id);
    this.conveyancerEditorBusy.set(false);
    this.populateConveyancerForm(conveyancer);
    this.conveyancersActionError.set('');
    this.conveyancersActionSuccess.set('');
    this.conveyancerEditorOpen.set(true);
  }

  closeConveyancerEditor(): void {
    this.conveyancerEditorBusy.set(false);
    this.conveyancersActionError.set('');
    this.conveyancerEditorOpen.set(false);
    this.editingConveyancerId.set(null);
  }

  onConveyancerEditorOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('conveyancer-editor-overlay')) {
      this.closeConveyancerEditor();
    }
  }

  submitConveyancerEditor(): void {
    const organizationName = this.newConveyancerOrganizationName.trim();
    if (!organizationName) {
      this.conveyancersActionSuccess.set('');
      this.conveyancersActionError.set('Organization name is required.');
      return;
    }

    this.conveyancerEditorBusy.set(true);
    this.conveyancersActionError.set('');
    this.conveyancersActionSuccess.set('');

    const currentMode = this.conveyancerEditorMode();
    const editingConveyancerId = this.editingConveyancerId();
    const requestBase: AdminConveyancerUpdateRequest = {
      organizationName,
      contactName: this.nullIfBlank(this.newConveyancerContactName),
      address: this.nullIfBlank(this.newConveyancerAddress),
      phone: this.nullIfBlank(this.newConveyancerPhone),
      email: this.nullIfBlank(this.newConveyancerEmail),
      website: this.nullIfBlank(this.newConveyancerWebsite),
      areasOfPractice: this.parseAreasOfPractice(this.newConveyancerAreasOfPractice),
      quoteRequestsEnabled: this.newConveyancerQuoteRequestsEnabled
    };
    const createRequest: AdminConveyancerCreateRequest = {
      jurisdiction: this.newConveyancerJurisdiction,
      ...requestBase
    };

    const request$ =
      currentMode === 'edit' && editingConveyancerId
        ? this.adminService.updateConveyancer(editingConveyancerId, requestBase)
        : this.adminService.createConveyancer(createRequest);

    const subscription = request$.subscribe({
      next: (saved) => {
        this.resetConveyancerForm();
        this.closeConveyancerEditor();
        this.replaceConveyancer(saved);
        this.conveyancersActionSuccess.set(
          currentMode === 'edit'
            ? `${saved.organizationName || saved.name} updated.`
            : `${saved.organizationName || saved.name} added${saved.quoteRequestsEnabled ? ' and enabled for quote requests' : ''}.`
        );
        this.refreshConveyancers();
      },
      error: (error: Error) => {
        this.conveyancersActionError.set(error.message);
      },
      complete: () => this.conveyancerEditorBusy.set(false)
    });

    this.subscriptions.add(subscription);
  }

  toggleConveyancerActive(conveyancer: AdminConveyancerSummary): void {
    const nextState = !conveyancer.isActive;
    const action = nextState ? 'restore to the directory' : 'remove from the directory';
    if (!window.confirm(`Are you sure you want to ${action} ${this.conveyancerLabel(conveyancer)}?`)) {
      return;
    }

    this.setConveyancerBusy(conveyancer.id, true);
    this.conveyancersActionError.set('');
    this.conveyancersActionSuccess.set('');

    const subscription = this.adminService.setConveyancerActive(conveyancer.id, nextState).subscribe({
      next: (updated) => {
        this.replaceConveyancer(updated);
        this.conveyancersActionSuccess.set(
          `${this.conveyancerLabel(updated)} ${updated.isActive ? 'restored to the directory' : 'removed from the directory'}.`
        );
      },
      error: (error: Error) => {
        this.conveyancersActionError.set(error.message);
      },
      complete: () => this.setConveyancerBusy(conveyancer.id, false)
    });

    this.subscriptions.add(subscription);
  }

  toggleConveyancerQuoteRequests(conveyancer: AdminConveyancerSummary): void {
    const nextState = !conveyancer.quoteRequestsEnabled;
    const action = nextState ? 'enable quote requests for' : 'disable quote requests for';
    if (!window.confirm(`Are you sure you want to ${action} ${this.conveyancerLabel(conveyancer)}?`)) {
      return;
    }

    this.setConveyancerBusy(conveyancer.id, true);
    this.conveyancersActionError.set('');
    this.conveyancersActionSuccess.set('');

    const subscription = this.adminService.setConveyancerQuoteRequestsEnabled(conveyancer.id, nextState).subscribe({
      next: (updated) => {
        this.replaceConveyancer(updated);
        this.conveyancersActionSuccess.set(
          `${this.conveyancerLabel(updated)} ${updated.quoteRequestsEnabled ? 'can be shortlisted again' : 'will no longer be shortlisted'}.`
        );
      },
      error: (error: Error) => {
        this.conveyancersActionError.set(error.message);
      },
      complete: () => this.setConveyancerBusy(conveyancer.id, false)
    });

    this.subscriptions.add(subscription);
  }

  toggleSuspension(user: AdminUserSummary): void {
    const nextState = !user.isSuspended;
    const confirmationLabel = nextState ? 'unsuspend' : 'suspend';
    if (!window.confirm(`Are you sure you want to ${confirmationLabel} ${user.email}?`)) {
      return;
    }

    this.setUserBusy(user.id, true);
    this.usersActionError.set('');
    this.usersActionSuccess.set('');
    const subscription = this.adminService.setUserSuspension(user.id, nextState).subscribe({
      next: (updated) => {
        this.replaceUser(updated);
        this.usersActionSuccess.set(`${updated.email} ${updated.isSuspended ? 'suspended' : 'unsuspended'}.`);
      },
      error: (error: Error) => {
        this.usersActionError.set(error.message);
      },
      complete: () => this.setUserBusy(user.id, false)
    });

    this.subscriptions.add(subscription);
  }

  toggleActionsMenu(kind: AdminActionsMenuKind, entityId: string, trigger: HTMLButtonElement, label: string): void {
    const current = this.actionsMenu();
    if (current?.kind === kind && current.entityId === entityId) {
      this.closeActionsMenu();
      return;
    }

    this.actionsMenuTrigger = trigger;
    this.actionsMenu.set(this.buildActionsMenuState(kind, entityId, trigger, label));
  }

  closeActionsMenu(returnFocus = false): void {
    if (!this.actionsMenu()) {
      return;
    }

    this.actionsMenu.set(null);
    const trigger = this.actionsMenuTrigger;
    this.actionsMenuTrigger = undefined;

    if (returnFocus && trigger) {
      queueMicrotask(() => trigger.focus());
    }
  }

  isActionsMenuOpen(kind: AdminActionsMenuKind, entityId: string): boolean {
    const menu = this.actionsMenu();
    return menu?.kind === kind && menu.entityId === entityId;
  }

  onActionsTriggerKeydown(
    event: KeyboardEvent,
    kind: AdminActionsMenuKind,
    entityId: string,
    trigger: HTMLButtonElement,
    label: string
  ): void {
    if (event.key !== 'ArrowDown') {
      return;
    }

    event.preventDefault();
    this.actionsMenuTrigger = trigger;
    this.actionsMenu.set(this.buildActionsMenuState(kind, entityId, trigger, label));
    queueMicrotask(() => this.focusFirstActionsMenuItem());
  }

  onActionsMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      this.closeActionsMenu();
      return;
    }

    const items = this.actionsMenuItems();
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeActionsMenu(true);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      items[nextIndex].focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const previousIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      items[previousIndex].focus();
    }
  }

  onTableWrapScroll(): void {
    this.closeActionsMenu();
  }

  toggleSuspensionFromMenu(user: AdminUserSummary): void {
    this.closeActionsMenu();
    this.toggleSuspension(user);
  }

  openEditConveyancerFromMenu(conveyancer: AdminConveyancerSummary): void {
    this.closeActionsMenu();
    this.openEditConveyancerModal(conveyancer);
  }

  toggleConveyancerActiveFromMenu(conveyancer: AdminConveyancerSummary): void {
    this.closeActionsMenu();
    this.toggleConveyancerActive(conveyancer);
  }

  toggleConveyancerQuoteRequestsFromMenu(conveyancer: AdminConveyancerSummary): void {
    this.closeActionsMenu();
    this.toggleConveyancerQuoteRequests(conveyancer);
  }

  inspectJobFromMenu(jobId: string): void {
    this.closeActionsMenu();
    this.selectJob(jobId);
  }

  deleteJobFromMenu(job: AdminJobSummary): void {
    this.closeActionsMenu();
    this.deleteJob(job);
  }

  deleteQuoteWorkflowFromMenu(job: AdminJobSummary): void {
    this.closeActionsMenu();
    this.deleteQuoteWorkflow(job);
  }

  openFeedbackPageFromMenu(pageUrl: string): void {
    this.closeActionsMenu();
    this.openFeedbackPage(pageUrl);
  }

  toggleNotificationEnabledFromMenu(notification: SiteNotification): void {
    this.closeActionsMenu();
    this.toggleNotificationEnabled(notification);
  }

  deleteNotificationFromMenu(notification: SiteNotification): void {
    this.closeActionsMenu();
    this.deleteNotification(notification);
  }

  openDocumentFromMenu(document: AdminJobDocument): void {
    this.closeActionsMenu();
    this.openDocument(document);
  }

  refreshNotifications(): void {
    this.notificationsLoading.set(true);
    this.notificationsError.set('');

    const subscription = this.adminService.getNotifications().subscribe({
      next: (items) => {
        this.notifications.set(items ?? []);
      },
      error: (error: Error) => {
        this.notificationsError.set(error.message);
        this.notifications.set([]);
        this.notificationsLoading.set(false);
      },
      complete: () => this.notificationsLoading.set(false)
    });

    this.subscriptions.add(subscription);
  }

  createNotification(): void {
    const request: AdminSiteNotificationCreateRequest = {
      message: this.normalizedNotificationMessage(),
      tone: this.notificationTone,
      audience: this.notificationAudience,
      isEnabled: this.notificationEnabled
    };

    if (!request.message) {
      this.notificationActionSuccess.set('');
      this.notificationActionError.set('Enter a message before creating a notification.');
      return;
    }

    this.notificationCreateBusy.set(true);
    this.notificationActionError.set('');
    this.notificationActionSuccess.set('');

    const subscription = this.adminService.createNotification(request).subscribe({
      next: (notification) => {
        this.notificationMessage = '';
        this.notificationTone = 'info';
        this.notificationAudience = 'dashboard';
        this.notificationEnabled = true;
        this.notificationActionSuccess.set(
          `${this.notificationAudienceLabel(notification.audience)} notification created${notification.isEnabled ? ' and enabled' : ''}.`
        );
        this.refreshNotifications();
      },
      error: (error: Error) => {
        this.notificationActionError.set(error.message);
        this.notificationCreateBusy.set(false);
      },
      complete: () => this.notificationCreateBusy.set(false)
    });

    this.subscriptions.add(subscription);
  }

  toggleNotificationEnabled(notification: SiteNotification): void {
    const nextState = !notification.isEnabled;
    const action = nextState ? 'enable' : 'disable';
    if (!window.confirm(`Are you sure you want to ${action} this notification?`)) {
      return;
    }

    this.setNotificationBusy(notification.id, true);
    this.notificationActionError.set('');
    this.notificationActionSuccess.set('');

    const subscription = this.adminService.setNotificationEnabled(notification.id, nextState).subscribe({
      next: (updated) => {
        this.notificationActionSuccess.set(
          `${this.notificationAudienceLabel(updated.audience)} notification ${updated.isEnabled ? 'enabled' : 'disabled'}.`
        );
        this.refreshNotifications();
      },
      error: (error: Error) => {
        this.notificationActionError.set(error.message);
        this.setNotificationBusy(notification.id, false);
      },
      complete: () => this.setNotificationBusy(notification.id, false)
    });

    this.subscriptions.add(subscription);
  }

  deleteNotification(notification: SiteNotification): void {
    if (!window.confirm('Delete this notification? This action cannot be undone.')) {
      return;
    }

    this.setNotificationBusy(notification.id, true);
    this.notificationActionError.set('');
    this.notificationActionSuccess.set('');

    const subscription = this.adminService.deleteNotification(notification.id).subscribe({
      next: () => {
        this.notificationActionSuccess.set('Notification deleted.');
        this.refreshNotifications();
      },
      error: (error: Error) => {
        this.notificationActionError.set(error.message);
        this.setNotificationBusy(notification.id, false);
      },
      complete: () => this.setNotificationBusy(notification.id, false)
    });

    this.subscriptions.add(subscription);
  }

  shortJobId(jobId: string): string {
    if (!jobId) {
      return '';
    }

    if (jobId.length <= 12) {
      return jobId;
    }

    return `${jobId.slice(0, 8)}…${jobId.slice(-4)}`;
  }

  formatCurrency(amountAudCents: number): string {
    const dollars = Number.isFinite(amountAudCents) ? amountAudCents * 100 : 0;
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      maximumFractionDigits: 2
    }).format(dollars);
  }

  quoteWorkflowSummary(job: AdminJobDetail): string {
    if (!job.hasQuoteWorkflow) {
      return 'No quote workflow linked to this job.';
    }

    const statusLabel = this.formatAdminLabel(job.quoteWorkflowStatus || 'open');
    return `${statusLabel} workflow · ${job.quoteWorkflowResponseCount} of ${job.quoteWorkflowTargetCount} responses received.`;
  }

  formatAdminLabel(value: string | null | undefined): string {
    if (!value) {
      return 'Unknown';
    }

    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .trim();
  }

  formatFeedbackType(type: string): string {
    if (type === 'bug') {
      return 'Bug report';
    }

    if (type === 'suggestion') {
      return 'Suggestion';
    }

    return 'General feedback';
  }

  openFeedbackPage(pageUrl: string): void {
    if (!pageUrl.trim()) {
      return;
    }

    window.open(pageUrl, '_blank', 'noopener,noreferrer');
  }

  isJobBusy(jobId: string): boolean {
    return this.busyJobIds()[jobId] === true;
  }

  isUserBusy(userId: string): boolean {
    return this.busyUserIds()[userId] === true;
  }

  isConveyancerBusy(conveyancerId: string): boolean {
    return this.busyConveyancerIds()[conveyancerId] === true;
  }

  isNotificationBusy(notificationId: string): boolean {
    return this.busyNotificationIds()[notificationId] === true;
  }

  jobStatusTone(status: string | null | undefined): string {
    const normalized = this.normalizeStatusValue(status);
    if (normalized === 'completed') {
      return 'success';
    }

    if (normalized === 'failed') {
      return 'danger';
    }

    if (normalized === 'awaitingpayment') {
      return 'warning';
    }

    if (
      normalized === 'awaitingupload' ||
      normalized === 'queued' ||
      normalized === 'extracting' ||
      normalized === 'indexing' ||
      normalized === 'analyzing' ||
      normalized === 'analysing' ||
      normalized === 'validating' ||
      normalized === 'rendering'
    ) {
      return 'info';
    }

    return 'neutral';
  }

  paymentStatusTone(status: string | null | undefined): string {
    const normalized = this.normalizeStatusValue(status);
    if (normalized === 'paid' || normalized === 'succeeded') {
      return 'success';
    }

    if (normalized === 'failed' || normalized === 'canceled' || normalized === 'cancelled') {
      return 'danger';
    }

    if (
      normalized === 'awaitingpayment' ||
      normalized === 'pending' ||
      normalized === 'requiresaction' ||
      normalized === 'requirespaymentmethod' ||
      normalized === 'refunded'
    ) {
      return 'warning';
    }

    return 'neutral';
  }

  feedbackTypeTone(type: AdminFeedbackType): string {
    if (type === 'bug') {
      return 'danger';
    }

    if (type === 'suggestion') {
      return 'info';
    }

    return 'neutral';
  }

  auditActionTone(actionGroup: string | null | undefined): string {
    const normalized = this.normalizeStatusValue(actionGroup);
    if (normalized === 'auth') {
      return 'info';
    }

    if (normalized === 'review') {
      return 'warning';
    }

    if (normalized === 'quote') {
      return 'success';
    }

    if (normalized === 'admin') {
      return 'danger';
    }

    return 'neutral';
  }

  auditActorTypeLabel(actorType: AdminAuditActorType | string | null | undefined): string {
    switch (this.normalizeStatusValue(actorType)) {
      case 'admin':
        return 'Admin';
      case 'conveyancer':
        return 'Conveyancer';
      case 'anonymous':
        return 'Anonymous';
      case 'system':
        return 'System';
      case 'user':
      default:
        return 'User';
    }
  }

  auditSourceLabel(source: string | null | undefined): string {
    return this.normalizeStatusValue(source) === 'client' ? 'Client' : 'Server';
  }

  auditActorDisplay(event: AdminAuditEvent): string {
    return event.actorName?.trim() || event.actorEmail?.trim() || this.auditActorTypeLabel(event.actorType);
  }

  auditSubjectDisplay(event: AdminAuditEvent): string {
    const subjectLabel = event.subjectName?.trim() || event.subjectEmail?.trim();
    const actorEmail = event.actorEmail?.trim().toLowerCase();
    const subjectEmail = event.subjectEmail?.trim().toLowerCase();
    if (!subjectLabel) {
      return event.subjectUserId ? 'Affected user' : actorEmail ? 'Self' : 'Not linked';
    }

    if (actorEmail && subjectEmail && actorEmail === subjectEmail) {
      return 'Self';
    }

    return subjectLabel;
  }

  auditContextMeta(event: AdminAuditEvent): string {
    const parts: string[] = [];
    if (event.entityLabel?.trim()) {
      parts.push(event.entityLabel.trim());
    } else if (event.entityId?.trim()) {
      parts.push(event.entityId.trim());
    }

    if (event.requestMethod?.trim() && event.requestPath?.trim()) {
      parts.push(`${event.requestMethod.trim()} ${event.requestPath.trim()}`);
    } else if (event.requestPath?.trim()) {
      parts.push(event.requestPath.trim());
    }

    parts.push(`${this.auditSourceLabel(event.source)} source`);
    return parts.join(' · ');
  }

  notificationToneLabel(tone: SiteNotificationTone): string {
    return tone === 'warning' ? 'Warning' : 'Information';
  }

  notificationTonePillTone(tone: SiteNotificationTone): string {
    return tone === 'warning' ? 'danger' : 'info';
  }

  notificationAudienceLabel(audience: SiteNotificationAudience): string {
    if (audience === 'public') {
      return 'Public site';
    }

    if (audience === 'both') {
      return 'Public + dashboard';
    }

    return 'Dashboard';
  }

  notificationEnabledTone(isEnabled: boolean): string {
    return isEnabled ? 'success' : 'neutral';
  }

  normalizedNotificationMessage(): string {
    return normalizeSiteNotificationMessage(this.notificationMessage);
  }

  notificationPreview(): SiteNotification | null {
    const message = this.normalizedNotificationMessage();
    if (!message) {
      return null;
    }

    return {
      id: 'preview',
      message,
      tone: this.notificationTone,
      audience: this.notificationAudience,
      isEnabled: this.notificationEnabled,
      createdAt: '',
      updatedAt: ''
    };
  }

  formatNotificationMessage(message: string): string {
    return normalizeSiteNotificationMessage(message);
  }

  adminFlagTone(isAdmin: boolean): string {
    return isAdmin ? 'info' : 'neutral';
  }

  suspensionTone(isSuspended: boolean): string {
    return isSuspended ? 'danger' : 'success';
  }

  conveyancerActiveTone(isActive: boolean): string {
    return isActive ? 'success' : 'neutral';
  }

  conveyancerQuoteRequestTone(isEnabled: boolean): string {
    return isEnabled ? 'success' : 'warning';
  }

  jobById(jobId: string): AdminJobSummary | null {
    return this.jobs().find((job) => job.id === jobId) ?? null;
  }

  feedbackById(feedbackId: string): AdminFeedbackSummary | null {
    return this.feedback().find((item) => item.id === feedbackId) ?? null;
  }

  userById(userId: string): AdminUserSummary | null {
    return this.users().find((user) => user.id === userId) ?? null;
  }

  conveyancerById(conveyancerId: string): AdminConveyancerSummary | null {
    return this.conveyancers().find((item) => item.id === conveyancerId) ?? null;
  }

  notificationById(notificationId: string): SiteNotification | null {
    return this.notifications().find((notification) => notification.id === notificationId) ?? null;
  }

  documentById(documentId: string): AdminJobDocument | null {
    return this.selectedJob()?.uploadedDocuments.find((document) => document.id === documentId) ?? null;
  }

  private loadJobDetail(jobId: string): void {
    this.jobDetailLoading.set(true);
    this.jobDetailError.set('');

    const subscription = this.adminService.getJobById(jobId).subscribe({
      next: (job) => this.selectedJob.set(job),
      error: (error: Error) => {
        this.jobDetailError.set(error.message);
        this.selectedJob.set(null);
      },
      complete: () => this.jobDetailLoading.set(false)
    });

    this.subscriptions.add(subscription);
  }

  private setJobBusy(jobId: string, busy: boolean): void {
    this.busyJobIds.update((current) => ({
      ...current,
      [jobId]: busy
    }));
  }

  private setUserBusy(userId: string, busy: boolean): void {
    this.busyUserIds.update((current) => ({
      ...current,
      [userId]: busy
    }));
  }

  private setConveyancerBusy(conveyancerId: string, busy: boolean): void {
    this.busyConveyancerIds.update((current) => ({
      ...current,
      [conveyancerId]: busy
    }));
  }

  private replaceUser(updated: AdminUserSummary): void {
    this.users.update((current) => current.map((user) => (user.id === updated.id ? updated : user)));
  }

  private replaceConveyancer(updated: AdminConveyancerSummary): void {
    this.conveyancers.update((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  private setNotificationBusy(notificationId: string, busy: boolean): void {
    this.busyNotificationIds.update((current) => ({
      ...current,
      [notificationId]: busy
    }));
  }

  private buildActionsMenuState(
    kind: AdminActionsMenuKind,
    entityId: string,
    trigger: HTMLButtonElement,
    label: string
  ): AdminActionsMenuState {
    const menuWidth = 240;
    const menuHeight = this.estimateActionsMenuHeight(kind);
    const rect = trigger.getBoundingClientRect();
    const maxLeft = Math.max(12, window.innerWidth - menuWidth - 12);
    const maxTop = Math.max(12, window.innerHeight - menuHeight - 12);
    const left = Math.min(Math.max(12, rect.right - menuWidth), maxLeft);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const top =
      spaceBelow < menuHeight && spaceAbove > spaceBelow
        ? Math.max(12, rect.top - menuHeight - 8)
        : Math.min(maxTop, rect.bottom + 8);

    return {
      kind,
      entityId,
      label,
      left,
      top
    };
  }

  private estimateActionsMenuHeight(kind: AdminActionsMenuKind): number {
    switch (kind) {
      case 'job':
      case 'user':
      case 'conveyancer':
        return 212;
      case 'notification':
        return 168;
      case 'feedback':
      case 'document':
        return 124;
      default:
        return 168;
    }
  }

  private focusFirstActionsMenuItem(): void {
    this.actionsMenuItems()[0]?.focus();
  }

  private actionsMenuItems(): HTMLElement[] {
    const panel = this.actionsMenuPanel?.nativeElement;
    if (!panel) {
      return [];
    }

    return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  private normalizeStatusValue(value: string | null | undefined): string {
    return (value ?? '').replace(/[\s_-]+/g, '').toLowerCase();
  }

  private nullIfBlank(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseAreasOfPractice(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item, index, items) => item.length > 0 && items.lastIndexOf(item) === index);
  }

  private populateConveyancerForm(conveyancer: AdminConveyancerSummary): void {
    this.newConveyancerJurisdiction = conveyancer.jurisdiction;
    this.newConveyancerOrganizationName = conveyancer.organizationName?.trim() || conveyancer.name;
    this.newConveyancerContactName = conveyancer.contactName ?? '';
    this.newConveyancerAddress = conveyancer.address ?? '';
    this.newConveyancerPhone = conveyancer.phone ?? '';
    this.newConveyancerEmail = conveyancer.email ?? '';
    this.newConveyancerWebsite = conveyancer.website ?? '';
    this.newConveyancerAreasOfPractice = conveyancer.areasOfPractice.join(', ') || 'Conveyancing';
    this.newConveyancerQuoteRequestsEnabled = conveyancer.quoteRequestsEnabled;
  }

  private resetConveyancerForm(): void {
    this.newConveyancerJurisdiction = 'ACT';
    this.newConveyancerOrganizationName = '';
    this.newConveyancerContactName = '';
    this.newConveyancerAddress = '';
    this.newConveyancerPhone = '';
    this.newConveyancerEmail = '';
    this.newConveyancerWebsite = '';
    this.newConveyancerAreasOfPractice = 'Conveyancing';
    this.newConveyancerQuoteRequestsEnabled = true;
  }

  private conveyancerLabel(conveyancer: Pick<AdminConveyancerSummary, 'organizationName' | 'name'>): string {
    return conveyancer.organizationName?.trim() || conveyancer.name;
  }
}
