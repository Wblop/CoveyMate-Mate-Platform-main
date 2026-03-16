import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription, catchError, forkJoin, of } from 'rxjs';

import { SiteUrlService } from '@shared-core/routing/site-url.service';
import {
  AdminSeoEngineService,
  SeoEngineArticleDetail,
  SeoEngineArticleSummary,
  SeoEngineSchedule,
  SeoEngineScheduleUpdateRequest,
  SeoEngineJobTriggerResponse,
  SeoEngineArticleUpdateRequest,
  SeoEngineDuplicateWarning,
  SeoEngineJob,
  SeoEngineOverview
} from '@shared-core/services/admin-seo-engine.service';
import { UserService } from '@shared-core/services/user.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { ConfirmActionDialogComponent } from '@shared-ui/ui/confirm-action-dialog/confirm-action-dialog.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';

interface SeoEngineArticleFormState {
  title: string;
  slug: string;
  excerpt: string;
  bodyMarkdown: string;
  metaTitle: string;
  metaDescription: string;
  tags: string;
  keywords: string;
}

interface SeoEngineScheduleFormState {
  scheduleExpression: string;
  scheduleExpressionTimezone: string;
  enabled: boolean;
}

type SeoEngineArticleFilter = 'all' | 'needs-review' | 'draft' | 'published';
type SeoEngineBoardTab = 'articles' | 'schedules' | 'jobs';
type SeoEngineEditorialTone = 'attention' | 'ready' | 'live';
type SeoEngineEditorStep = 'edit' | 'preview';

interface SeoEngineArticleListItem extends SeoEngineArticleSummary {
  healthLabel: string;
  healthNote: string;
  healthTone: SeoEngineEditorialTone;
  warningCount: number;
  blockingWarningCount: number;
  sortPriority: number;
  sortTimestamp: number;
  topics: string[];
}

@Component({
  selector: 'app-admin-seo-engine-page',
  standalone: true,
  imports: [
    DatePipe,
    UIButtonComponent,
    UIAlertBannerComponent,
    UIPageHeaderComponent,
    UISkeletonBlockComponent,
    ConfirmActionDialogComponent
  ],
  templateUrl: './admin-seo-engine-page.component.html',
  styleUrl: './admin-seo-engine-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminSeoEnginePageComponent implements OnDestroy {
  private readonly seoEngineService = inject(AdminSeoEngineService);
  private readonly userService = inject(UserService);
  private readonly siteUrls = inject(SiteUrlService);
  private readonly subscriptions = new Subscription();

  readonly loading = signal(true);
  readonly articleLoading = signal(false);
  readonly busyAction = signal('');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly overview = signal<SeoEngineOverview | null>(null);
  readonly scheduleLoadError = signal('');
  readonly schedules = signal<SeoEngineSchedule[]>([]);
  readonly scheduleForms = signal<Record<string, SeoEngineScheduleFormState>>({});
  readonly draftArticles = signal<SeoEngineArticleSummary[]>([]);
  readonly publishedArticles = signal<SeoEngineArticleSummary[]>([]);
  readonly jobs = signal<SeoEngineJob[]>([]);
  readonly articleFilter = signal<SeoEngineArticleFilter>('all');
  readonly boardTab = signal<SeoEngineBoardTab>('articles');
  readonly articleSearch = signal('');
  readonly editorOpen = signal(false);
  readonly editorStep = signal<SeoEngineEditorStep>('edit');
  readonly deleteDialogOpen = signal(false);
  readonly deleteTarget = signal<SeoEngineArticleSummary | null>(null);
  readonly jobDeleteDialogOpen = signal(false);
  readonly jobDeleteTarget = signal<SeoEngineJob | null>(null);
  readonly clearJobHistoryDialogOpen = signal(false);
  readonly selectedArticleId = signal<string | null>(null);
  readonly selectedArticle = signal<SeoEngineArticleDetail | null>(null);
  readonly form = signal<SeoEngineArticleFormState>(this.createEmptyForm());
  readonly previewHtml = computed(() => this.renderPreviewHtml(this.form().bodyMarkdown));
  readonly articleFilterOptions: ReadonlyArray<{ value: SeoEngineArticleFilter; label: string }> = [
    { value: 'all', label: 'All articles' },
    { value: 'needs-review', label: 'Needs review' },
    { value: 'draft', label: 'Drafts' },
    { value: 'published', label: 'Live' }
  ];
  readonly boardTabOptions: ReadonlyArray<{ value: SeoEngineBoardTab; label: string }> = [
    { value: 'articles', label: 'Articles' },
    { value: 'schedules', label: 'Schedules' },
    { value: 'jobs', label: 'Queue history' }
  ];

  readonly articles = computed<SeoEngineArticleListItem[]>(() =>
    [...this.draftArticles(), ...this.publishedArticles()]
      .map((article) => this.decorateArticle(article))
      .sort((left, right) => {
        if (left.sortPriority !== right.sortPriority) {
          return left.sortPriority - right.sortPriority;
        }

        if (left.sortTimestamp !== right.sortTimestamp) {
          return right.sortTimestamp - left.sortTimestamp;
        }

        return left.title.localeCompare(right.title);
      })
  );

  readonly articleCounts = computed<Record<SeoEngineArticleFilter, number>>(() => {
    const items = this.articles();
    return {
      all: items.length,
      'needs-review': items.filter((article) => article.warningCount > 0).length,
      draft: items.filter((article) => article.status === 'draft').length,
      published: items.filter((article) => article.status === 'published').length
    };
  });

  readonly editorialSummary = computed(() => {
    const items = this.articles();
    return {
      needsReview: items.filter((article) => article.warningCount > 0).length,
      readyDrafts: items.filter((article) => article.status === 'draft' && article.warningCount === 0).length,
      liveArticles: items.filter((article) => article.status === 'published').length
    };
  });

  readonly boardCounts = computed<Record<SeoEngineBoardTab, number>>(() => ({
    articles: this.articles().length,
    schedules: this.schedules().length,
    jobs: this.jobs().length
  }));

  readonly deletableJobCount = computed(() => this.jobs().filter((job) => this.canDeleteJob(job)).length);

  readonly filteredArticles = computed(() => {
    const filter = this.articleFilter();
    const query = this.articleSearch().trim().toLowerCase();

    return this.articles().filter((article) => {
      if (filter === 'needs-review' && article.warningCount === 0) {
        return false;
      }

      if (filter !== 'all' && filter !== 'needs-review' && article.status !== filter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        article.title,
        article.slug,
        article.excerpt,
        ...article.tags,
        ...article.keywords
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  });

  readonly selectedArticleSummary = computed(() => {
    const articleId = this.selectedArticleId();
    return articleId ? this.articles().find((article) => article.id === articleId) ?? null : null;
  });

  readonly sortedJobs = computed(() =>
    [...this.jobs()].sort((left, right) => this.toTimestamp(right.createdAt) - this.toTimestamp(left.createdAt))
  );

  readonly hasUnsavedChanges = computed(() => {
    const article = this.selectedArticle();
    if (!article) {
      return false;
    }

    const request = this.buildUpdateRequest();
    return (
      request.title !== article.title ||
      request.slug !== article.slug ||
      request.excerpt !== article.excerpt ||
      request.bodyMarkdown !== article.bodyMarkdown ||
      request.metaTitle !== article.metaTitle ||
      request.metaDescription !== article.metaDescription ||
      !this.sameList(request.tags, article.tags) ||
      !this.sameList(request.keywords, article.keywords)
    );
  });

  readonly hasBlockingWarnings = computed(
    () => this.selectedArticle()?.duplicateWarnings.some((warning) => this.isBlockingWarning(warning)) ?? false
  );

  constructor() {
    const subscription = this.userService.loadUserInfo().subscribe({
      next: (user) => {
        if (!user.isAdmin) {
          void this.siteUrls.navigate('/dashboard');
          return;
        }

        this.loadPage();
      },
      error: () => {
        void this.siteUrls.navigate(this.siteUrls.signInHref('/admin/seo-engine'));
      }
    });

    this.subscriptions.add(subscription);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.deleteDialogOpen() || this.jobDeleteDialogOpen() || this.clearJobHistoryDialogOpen() || !this.editorOpen() || !!this.busyAction()) {
      return;
    }

    this.closeEditor();
  }

  generateArticle(): void {
    this.runJob('generate', () => this.seoEngineService.generateArticle(), 'Queued article generation.');
  }

  updateScheduleField(field: keyof SeoEngineScheduleFormState, jobType: string, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const value = field === 'enabled' ? target.checked : target.value;
    this.scheduleForms.update((forms) => ({
      ...forms,
      [jobType]: {
        ...this.getScheduleForm(jobType),
        [field]: value
      }
    }));
  }

  refreshSitemap(): void {
    this.runJob('refresh', () => this.seoEngineService.refreshSitemap(), 'Queued sitemap refresh.');
  }

  resetScheduleForm(jobType: string): void {
    const schedule = this.getSchedule(jobType);
    if (!schedule || this.busyAction()) {
      return;
    }

    this.scheduleForms.update((forms) => ({
      ...forms,
      [jobType]: this.toScheduleForm(schedule)
    }));
  }

  saveSchedule(jobType: string): void {
    const schedule = this.getSchedule(jobType);
    if (!schedule || !this.hasScheduleChanges(jobType) || (this.busyAction() && !this.isSavingSchedule(jobType))) {
      return;
    }

    const form = this.getScheduleForm(jobType);
    const request: SeoEngineScheduleUpdateRequest = {
      scheduleExpression: form.scheduleExpression.trim(),
      scheduleExpressionTimezone: form.scheduleExpressionTimezone.trim(),
      enabled: form.enabled
    };

    this.busyAction.set(`schedule:${jobType}`);
    this.errorMessage.set('');
    this.successMessage.set('');

    const subscription = this.seoEngineService.updateSchedule(jobType, request).subscribe({
      next: (updated) => {
        this.replaceSchedule(updated);
        this.scheduleLoadError.set('');
        this.successMessage.set(`${updated.label} schedule saved.`);
        this.busyAction.set('');
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'Could not save SEO Engine schedule.');
        this.busyAction.set('');
      }
    });

    this.subscriptions.add(subscription);
  }

  setArticleFilter(filter: SeoEngineArticleFilter): void {
    this.articleFilter.set(filter);
  }

  setBoardTab(tab: SeoEngineBoardTab): void {
    this.boardTab.set(tab);
  }

  boardEyebrow(): string {
    return this.boardTab() === 'articles'
      ? 'Editorial queue'
      : this.boardTab() === 'schedules'
        ? 'Automation schedule'
        : 'Automation activity';
  }

  boardHeading(): string {
    return this.boardTab() === 'articles'
      ? 'Articles'
      : this.boardTab() === 'schedules'
        ? 'Publishing windows'
        : 'Queue history';
  }

  boardDescription(): string {
    return this.boardTab() === 'articles'
      ? 'Open any row to edit in a modal workspace without losing sight of what is draft, live, or blocked.'
      : this.boardTab() === 'schedules'
        ? 'Set the SEO engine schedules here instead of the AWS console. These fields write directly to the live EventBridge schedules.'
        : 'Jobs appear here as soon as they are queued, then refresh into their latest status without needing a full page reload.';
  }

  updateArticleSearch(event: Event): void {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    this.articleSearch.set(value);
  }

  openArticle(articleId: string, step: SeoEngineEditorStep = 'edit'): void {
    if (!articleId || this.busyAction()) {
      return;
    }

    this.editorOpen.set(true);
    this.editorStep.set(step);
    this.loadArticle(articleId);
  }

  closeEditor(): void {
    if (this.busyAction()) {
      return;
    }

    this.deleteDialogOpen.set(false);
    this.deleteTarget.set(null);
    this.jobDeleteDialogOpen.set(false);
    this.jobDeleteTarget.set(null);
    this.clearJobHistoryDialogOpen.set(false);
    this.editorOpen.set(false);
    this.editorStep.set('edit');
  }

  onEditorOverlayClick(event: MouseEvent): void {
    if (this.busyAction()) {
      return;
    }

    if ((event.target as HTMLElement).classList.contains('admin-seo-engine__editor-overlay')) {
      this.closeEditor();
    }
  }

  updateField(field: keyof SeoEngineArticleFormState, event: Event): void {
    const value = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.form.update((state) => ({ ...state, [field]: value }));
  }

  showPreviewStep(): void {
    if (this.articleLoading() || !this.selectedArticle()) {
      return;
    }

    this.editorStep.set('preview');
  }

  showEditStep(): void {
    this.editorStep.set('edit');
  }

  saveDraft(): void {
    const article = this.selectedArticle();
    if (!article || !this.hasUnsavedChanges()) {
      return;
    }

    const request = this.buildUpdateRequest();
    this.busyAction.set('save');
    this.errorMessage.set('');
    this.successMessage.set('');

    const subscription = this.seoEngineService.updateArticle(article.id, request).subscribe({
      next: (updated) => {
        this.selectedArticle.set(updated);
        this.selectedArticleId.set(updated.id);
        this.form.set(this.toForm(updated));
        this.successMessage.set(updated.status === 'published' ? 'Live article updated. Public page refresh queued.' : 'Draft saved.');
        this.busyAction.set('');
        this.loadListsOnly();
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'Could not save article.');
        this.busyAction.set('');
      }
    });

    this.subscriptions.add(subscription);
  }

  publishArticle(): void {
    const article = this.selectedArticle();
    if (!article || article.status === 'published' || this.hasUnsavedChanges() || this.hasBlockingWarnings()) {
      return;
    }

    this.busyAction.set('publish');
    this.errorMessage.set('');
    this.successMessage.set('');

    const subscription = this.seoEngineService.publishArticle(article.id).subscribe({
      next: (updated) => {
        this.selectedArticle.set(updated);
        this.selectedArticleId.set(updated.id);
        this.form.set(this.toForm(updated));
        this.successMessage.set('Article published.');
        this.busyAction.set('');
        this.loadListsOnly();
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'Could not publish article.');
        this.busyAction.set('');
      }
    });

    this.subscriptions.add(subscription);
  }

  promptDeleteArticle(article?: SeoEngineArticleSummary): void {
    const target = article ?? this.selectedArticleSummary();
    if (!target || this.busyAction()) {
      return;
    }

    this.deleteTarget.set(target);
    this.deleteDialogOpen.set(true);
  }

  cancelDeleteArticle(): void {
    if (this.busyAction() === 'delete') {
      return;
    }

    this.deleteDialogOpen.set(false);
    this.deleteTarget.set(null);
  }

  promptDeleteJob(job: SeoEngineJob): void {
    if (!this.canDeleteJob(job) || this.busyAction()) {
      return;
    }

    this.jobDeleteTarget.set(job);
    this.jobDeleteDialogOpen.set(true);
  }

  cancelDeleteJob(): void {
    if (this.busyAction() === 'delete-job') {
      return;
    }

    this.jobDeleteDialogOpen.set(false);
    this.jobDeleteTarget.set(null);
  }

  confirmDeleteJob(): void {
    const job = this.jobDeleteTarget();
    if (!job) {
      return;
    }

    this.busyAction.set('delete-job');
    this.errorMessage.set('');
    this.successMessage.set('');

    const subscription = this.seoEngineService.deleteJob(job.id).subscribe({
      next: () => {
        this.jobs.update((jobs) => jobs.filter((entry) => entry.id !== job.id));
        this.jobDeleteDialogOpen.set(false);
        this.jobDeleteTarget.set(null);
        this.successMessage.set('Queue history entry deleted.');
        this.busyAction.set('');
        this.loadListsOnly();
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'Could not delete queue history entry.');
        this.busyAction.set('');
      }
    });

    this.subscriptions.add(subscription);
  }

  promptClearJobHistory(): void {
    if (this.deletableJobCount() === 0 || this.busyAction()) {
      return;
    }

    this.clearJobHistoryDialogOpen.set(true);
  }

  cancelClearJobHistory(): void {
    if (this.busyAction() === 'clear-job-history') {
      return;
    }

    this.clearJobHistoryDialogOpen.set(false);
  }

  confirmClearJobHistory(): void {
    if (this.deletableJobCount() === 0) {
      return;
    }

    this.busyAction.set('clear-job-history');
    this.errorMessage.set('');
    this.successMessage.set('');

    const subscription = this.seoEngineService.clearJobHistory().subscribe({
      next: (response) => {
        this.jobs.update((jobs) => jobs.filter((job) => !this.canDeleteJob(job)));
        this.clearJobHistoryDialogOpen.set(false);
        this.successMessage.set(
          response.deletedCount === 1 ? 'Cleared 1 finished queue entry.' : `Cleared ${response.deletedCount} finished queue entries.`
        );
        this.busyAction.set('');
        this.loadListsOnly();
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'Could not clear queue history.');
        this.busyAction.set('');
      }
    });

    this.subscriptions.add(subscription);
  }

  confirmDeleteArticle(): void {
    const article = this.deleteTarget();
    if (!article) {
      return;
    }

    this.busyAction.set('delete');
    this.errorMessage.set('');
    this.successMessage.set('');

    const subscription = this.seoEngineService.deleteArticle(article.id).subscribe({
      next: () => {
        this.deleteDialogOpen.set(false);
        this.deleteTarget.set(null);

        if (this.selectedArticleId() === article.id) {
          this.editorOpen.set(false);
          this.editorStep.set('edit');
          this.selectedArticleId.set(null);
          this.selectedArticle.set(null);
          this.form.set(this.createEmptyForm());
        }

        this.successMessage.set('Article deleted.');
        this.busyAction.set('');
        this.loadPage();
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'Could not delete article.');
        this.busyAction.set('');
      }
    });

    this.subscriptions.add(subscription);
  }

  isSelected(articleId: string): boolean {
    return this.editorOpen() && this.selectedArticleId() === articleId;
  }

  articleStatusLabel(article: SeoEngineArticleSummary): string {
    return article.status === 'published' ? 'Published' : 'Draft';
  }

  articleMetaDate(article: SeoEngineArticleSummary): string {
    if (article.status === 'published' && article.publishedAt) {
      return article.publishedAt;
    }

    return article.updatedAt;
  }

  articleMetaDateLabel(article: SeoEngineArticleSummary): string {
    return article.status === 'published' && article.publishedAt ? 'Published' : 'Updated';
  }

  jobTypeLabel(jobType: string): string {
    return jobType === 'generate-article'
      ? 'Generate article'
      : jobType === 'publish-next-article'
        ? 'Publish next article'
        : jobType === 'refresh-sitemap'
          ? 'Refresh sitemap'
          : jobType;
  }

  jobStatusLabel(status: SeoEngineJob['status']): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  canDeleteJob(job: SeoEngineJob): boolean {
    return job.status === 'completed' || job.status === 'failed';
  }

  saveLabel(): string {
    return this.selectedArticle()?.status === 'published' ? 'Save live changes' : 'Save draft';
  }

  publishLabel(): string {
    return this.selectedArticle()?.status === 'published' ? 'Published' : 'Publish article';
  }

  jobDeleteDetail(job: SeoEngineJob): string {
    return `${this.jobTypeLabel(job.jobType)} queued ${new Date(job.createdAt).toLocaleString()}`;
  }

  openJobArticle(job: SeoEngineJob): void {
    if (!job.articleId || this.busyAction()) {
      return;
    }

    this.openArticle(job.articleId);
  }

  publicArticleUrl(article: SeoEngineArticleSummary): string | null {
    const host = this.overview()?.marketingHost?.trim();
    if (!host) {
      return null;
    }

    const normalizedHost = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const isLocalHost = /^localhost(?::\d+)?$/i.test(normalizedHost) || /^127\.0\.0\.1(?::\d+)?$/i.test(normalizedHost);
    const protocol = isLocalHost ? 'http://' : 'https://';

    return `${protocol}${normalizedHost}/insights/${article.slug}`;
  }

  getScheduleForm(jobType: string): SeoEngineScheduleFormState {
    return this.scheduleForms()[jobType] ?? {
      scheduleExpression: '',
      scheduleExpressionTimezone: 'Australia/Sydney',
      enabled: false
    };
  }

  hasScheduleChanges(jobType: string): boolean {
    const schedule = this.getSchedule(jobType);
    if (!schedule) {
      return false;
    }

    const form = this.getScheduleForm(jobType);
    return (
      form.scheduleExpression.trim() !== schedule.scheduleExpression ||
      form.scheduleExpressionTimezone.trim() !== schedule.scheduleExpressionTimezone ||
      form.enabled !== schedule.enabled
    );
  }

  isSavingSchedule(jobType: string): boolean {
    return this.busyAction() === `schedule:${jobType}`;
  }

  scheduleExamples(jobType: string): string {
    return jobType === 'publish-next-article'
      ? 'One per day: cron(10 9 * * ? *) · Three per day: cron(10 9,13,18 * * ? *)'
      : 'Daily at 7:00am: cron(0 7 * * ? *)';
  }

  private loadArticle(articleId: string): void {
    this.selectedArticleId.set(articleId);
    this.articleLoading.set(true);
    this.errorMessage.set('');

    if (this.selectedArticle()?.id !== articleId) {
      this.selectedArticle.set(null);
    }

    const subscription = this.seoEngineService.getArticle(articleId).subscribe({
      next: (article) => {
        this.selectedArticle.set(article);
        this.selectedArticleId.set(article.id);
        this.form.set(this.toForm(article));
        this.articleLoading.set(false);
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'Could not load SEO Engine article.');
        this.articleLoading.set(false);
      }
    });

    this.subscriptions.add(subscription);
  }

  private loadPage(preferredArticleId?: string): void {
    this.loading.set(true);
    this.errorMessage.set('');

    const subscription = forkJoin({
      overview: this.seoEngineService.getOverview(),
      schedules: this.seoEngineService.getSchedules().pipe(
        catchError((error: Error) => {
          this.scheduleLoadError.set(error.message || 'Could not load SEO Engine schedules.');
          return of([] as SeoEngineSchedule[]);
        })
      ),
      drafts: this.seoEngineService.getArticles('draft'),
      published: this.seoEngineService.getArticles('published'),
      jobs: this.seoEngineService.getJobs()
    }).subscribe({
      next: ({ overview, schedules, drafts, published, jobs }) => {
        this.overview.set(overview);
        this.schedules.set(schedules);
        this.scheduleForms.set(
          Object.fromEntries(schedules.map((schedule) => [schedule.jobType, this.toScheduleForm(schedule)]))
        );
        if (schedules.length > 0) {
          this.scheduleLoadError.set('');
        }
        this.draftArticles.set(drafts);
        this.publishedArticles.set(published);
        this.jobs.set(jobs);
        this.loading.set(false);

        if (preferredArticleId) {
          this.openArticle(preferredArticleId);
          return;
        }

        if (!this.editorOpen()) {
          this.selectedArticle.set(null);
          this.selectedArticleId.set(null);
          this.form.set(this.createEmptyForm());
        }
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'Could not load the SEO Engine.');
        this.loading.set(false);
      }
    });

    this.subscriptions.add(subscription);
  }

  private loadListsOnly(): void {
    const subscription = forkJoin({
      drafts: this.seoEngineService.getArticles('draft'),
      published: this.seoEngineService.getArticles('published'),
      jobs: this.seoEngineService.getJobs(),
      overview: this.seoEngineService.getOverview()
    }).subscribe({
      next: ({ drafts, published, jobs, overview }) => {
        this.draftArticles.set(drafts);
        this.publishedArticles.set(published);
        this.jobs.set(jobs);
        this.overview.set(overview);

        const selectedArticleId = this.selectedArticleId();
        if (selectedArticleId && ![...drafts, ...published].some((article) => article.id === selectedArticleId)) {
          this.editorOpen.set(false);
          this.selectedArticleId.set(null);
          this.selectedArticle.set(null);
          this.form.set(this.createEmptyForm());
        }
      }
    });

    this.subscriptions.add(subscription);
  }

  private runJob(actionKey: string, task: () => ReturnType<AdminSeoEngineService['generateArticle']>, successMessage: string): void {
    if (this.busyAction()) {
      return;
    }

    this.busyAction.set(actionKey);
    this.errorMessage.set('');
    this.successMessage.set('');

    const subscription = task().subscribe({
      next: (response) => {
        this.insertQueuedJob(response);
        this.successMessage.set(response.message || successMessage);
        this.busyAction.set('');
        this.loadListsOnly();
        this.scheduleQueueRefresh();
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message || 'SEO Engine job failed.');
        this.busyAction.set('');
      }
    });

    this.subscriptions.add(subscription);
  }

  private insertQueuedJob(response: SeoEngineJobTriggerResponse): void {
    const queuedJob: SeoEngineJob = {
      id: response.jobId,
      jobType: response.jobType,
      status: response.status as SeoEngineJob['status'],
      requestedSource: 'admin',
      requestedByEmail: '',
      requestedByName: 'Admin',
      articleId: null,
      createdAt: response.queuedAtUtc,
      startedAt: null,
      completedAt: null,
      errorMessage: null
    };

    this.jobs.update((jobs) => [queuedJob, ...jobs.filter((job) => job.id !== queuedJob.id)]);
  }

  private scheduleQueueRefresh(): void {
    globalThis.setTimeout(() => this.loadListsOnly(), 1000);
    globalThis.setTimeout(() => this.loadListsOnly(), 3000);
  }

  private getSchedule(jobType: string): SeoEngineSchedule | null {
    return this.schedules().find((schedule) => schedule.jobType === jobType) ?? null;
  }

  private replaceSchedule(updated: SeoEngineSchedule): void {
    this.schedules.update((schedules) => schedules.map((schedule) => (schedule.jobType === updated.jobType ? updated : schedule)));
    this.scheduleForms.update((forms) => ({
      ...forms,
      [updated.jobType]: this.toScheduleForm(updated)
    }));
  }

  private toScheduleForm(schedule: SeoEngineSchedule): SeoEngineScheduleFormState {
    return {
      scheduleExpression: schedule.scheduleExpression,
      scheduleExpressionTimezone: schedule.scheduleExpressionTimezone,
      enabled: schedule.enabled
    };
  }

  private buildUpdateRequest(): SeoEngineArticleUpdateRequest {
    const form = this.form();
    return {
      title: form.title.trim(),
      slug: form.slug.trim(),
      excerpt: form.excerpt.trim(),
      bodyMarkdown: form.bodyMarkdown,
      metaTitle: form.metaTitle.trim(),
      metaDescription: form.metaDescription.trim(),
      tags: this.splitCsv(form.tags),
      keywords: this.splitCsv(form.keywords)
    };
  }

  private toForm(article: SeoEngineArticleDetail): SeoEngineArticleFormState {
    return {
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      bodyMarkdown: article.bodyMarkdown,
      metaTitle: article.metaTitle,
      metaDescription: article.metaDescription,
      tags: article.tags.join(', '),
      keywords: article.keywords.join(', ')
    };
  }

  private createEmptyForm(): SeoEngineArticleFormState {
    return {
      title: '',
      slug: '',
      excerpt: '',
      bodyMarkdown: '',
      metaTitle: '',
      metaDescription: '',
      tags: '',
      keywords: ''
    };
  }

  private splitCsv(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private renderPreviewHtml(markdown: string): string {
    const normalized = (markdown ?? '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) {
      return '<p>No draft content yet. Add article copy to preview it here.</p>';
    }

    const blocks: string[] = [];
    const paragraphLines: string[] = [];
    const listItems: string[] = [];

    const flushParagraph = (): void => {
      if (paragraphLines.length === 0) {
        return;
      }

      blocks.push(`<p>${this.escapeHtml(paragraphLines.join(' ').trim())}</p>`);
      paragraphLines.length = 0;
    };

    const flushList = (): void => {
      if (listItems.length === 0) {
        return;
      }

      blocks.push(`<ul>${listItems.map((item) => `<li>${this.escapeHtml(item)}</li>`).join('')}</ul>`);
      listItems.length = 0;
    };

    for (const rawLine of normalized.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        flushParagraph();
        flushList();
        continue;
      }

      if (line.startsWith('## ')) {
        flushParagraph();
        flushList();
        blocks.push(`<h2>${this.escapeHtml(line.slice(2).trim())}</h2>`);
        continue;
      }

      if (line.startsWith('### ')) {
        flushParagraph();
        flushList();
        blocks.push(`<h3>${this.escapeHtml(line.slice(4).trim())}</h3>`);
        continue;
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        flushParagraph();
        listItems.push(line.slice(2).trim());
        continue;
      }

      flushList();
      paragraphLines.push(line);
    }

    flushParagraph();
    flushList();
    return blocks.join('');
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      switch (character) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case '\'':
          return '&#39;';
        default:
          return character;
      }
    });
  }

  private sameList(left: string[], right: string[]): boolean {
    return left.length === right.length || left.every((value, index) => value === right[index]);
  }

  private decorateArticle(article: SeoEngineArticleSummary): SeoEngineArticleListItem {
    const warningCount = article.duplicateWarnings.length;
    const blockingWarningCount = article.duplicateWarnings.filter((warning) => this.isBlockingWarning(warning)).length;
    const topics = [...new Set([...article.tags, ...article.keywords].map((value) => value.trim()).filter(Boolean))].slice(0, 3);

    if (warningCount > 0) {
      return {
        ...article,
        healthLabel: blockingWarningCount > 0 ? 'Blocked' : 'Needs review',
        healthNote:
          blockingWarningCount > 0
            ? `${blockingWarningCount} blocking duplicate warning${blockingWarningCount === 1 ? '' : 's'} need attention.`
            : `${warningCount} duplicate warning${warningCount === 1 ? '' : 's'} should be reviewed.`,
        healthTone: 'attention',
        warningCount,
        blockingWarningCount,
        sortPriority: blockingWarningCount > 0 ? 0 : 1,
        sortTimestamp: this.toTimestamp(article.updatedAt),
        topics
      };
    }

    if (article.status === 'draft') {
      return {
        ...article,
        healthLabel: 'Ready to publish',
        healthNote: 'Draft is clear of duplicate warnings.',
        healthTone: 'ready',
        warningCount,
        blockingWarningCount,
        sortPriority: 2,
        sortTimestamp: this.toTimestamp(article.updatedAt),
        topics
      };
    }

    return {
      ...article,
      healthLabel: 'Live',
      healthNote: 'Published on the public Insights site.',
      healthTone: 'live',
      warningCount,
      blockingWarningCount,
      sortPriority: 3,
      sortTimestamp: this.toTimestamp(article.publishedAt ?? article.updatedAt),
      topics
    };
  }

  private isBlockingWarning(warning: SeoEngineDuplicateWarning): boolean {
    return warning.severity.trim().toLowerCase() === 'block';
  }

  private toTimestamp(value: string | null | undefined): number {
    if (!value) {
      return 0;
    }

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}
