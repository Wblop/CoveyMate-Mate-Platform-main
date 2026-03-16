import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { renderInsightRichText } from '@shared-core/utils/insight-rich-text';
import {
  type MarketingInsightArticle
} from '@marketing-site/features/public/insights/insights-content';
import { MarketingInsightsStore } from '@marketing-site/features/public/insights/marketing-insights.store';

interface RenderedInsightSection {
  sectionId: string;
  heading: string;
  paragraphsHtml: string[];
  bulletsHtml: string[];
}

const MISSING_ARTICLE: MarketingInsightArticle = {
  id: '',
  title: 'Insight not found',
  slug: 'missing',
  excerpt: 'The requested article could not be found.',
  bodyHtml: '',
  metaTitle: 'Insight not found',
  metaDescription: 'The requested insight could not be found.',
  tags: [],
  keywords: [],
  publishedAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  sections: [
    {
      sectionId: 'missing',
      heading: 'Insight unavailable',
      paragraphs: ['The requested insight is not available in the current published Insights manifest.'],
      bullets: [],
      position: 0
    }
  ],
  sources: [],
  canonicalPath: '/insights',
  publishedLabel: '11 Mar 2026',
  updatedLabel: '11 Mar 2026',
  readingMinutes: 1
};

const LOADING_ARTICLE: MarketingInsightArticle = {
  ...MISSING_ARTICLE,
  title: 'Loading insight',
  slug: 'loading',
  excerpt: 'Loading the latest published insight.',
  metaTitle: 'Loading insight',
  metaDescription: 'Loading the latest published insight.',
  sections: [
    {
      sectionId: 'loading',
      heading: 'Loading insight',
      paragraphs: ['Checking the latest published Insights manifest for this article.'],
      bullets: [],
      position: 0
    }
  ]
};

@Component({
  selector: 'app-insight-article-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './insight-article-page.component.html',
  styleUrl: './insight-article-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InsightArticlePageComponent implements AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly insightsStore = inject(MarketingInsightsStore);

  private sectionObserver: IntersectionObserver | null = null;
  readonly slug = signal(this.route.snapshot.paramMap.get('slug'));
  readonly isAwaitingRuntimeArticle = computed(
    () => !this.insightsStore.runtimeResolved() && !this.insightsStore.findArticle(this.slug())
  );
  readonly currentArticle = computed<MarketingInsightArticle>(() => {
    const article = this.insightsStore.findArticle(this.slug());
    if (article) {
      return article;
    }

    return this.isAwaitingRuntimeArticle() ? LOADING_ARTICLE : MISSING_ARTICLE;
  });
  readonly recentInsights = computed(() =>
    this.insightsStore.articles()
      .filter((article) => article.slug !== this.currentArticle().slug)
      .slice(0, 5)
  );
  readonly trendingKeywords = computed(() => this.insightsStore.trendingKeywords().slice(0, 8));
  readonly renderedSections = computed<RenderedInsightSection[]>(() => {
    const article = this.currentArticle();
    return article.sections.map((section) => ({
      sectionId: section.sectionId,
      heading: section.heading,
      paragraphsHtml: section.paragraphs.map((paragraph) => renderInsightRichText(paragraph, article.sources)),
      bulletsHtml: section.bullets.map((bullet) => renderInsightRichText(bullet, article.sources))
    }));
  });
  readonly activeSectionId = signal<string>(this.currentArticle().sections[0]?.sectionId ?? '');

  constructor() {
    this.insightsStore.ensureFreshManifest();

    effect(() => {
      const article = this.currentArticle();
      this.activeSectionId.set(article.sections[0]?.sectionId ?? '');
      this.queueSectionObserverSetup();
    });

    this.route.paramMap.subscribe((params) => {
      this.slug.set(params.get('slug'));
      this.insightsStore.ensureFreshManifest();
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    });

    this.destroyRef.onDestroy(() => {
      this.sectionObserver?.disconnect();
      this.sectionObserver = null;
    });
  }

  ngAfterViewInit(): void {
    this.queueSectionObserverSetup();
  }

  scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    if (typeof window === 'undefined') {
      return;
    }

    const target = document.getElementById(sectionId);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: this.prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    this.activeSectionId.set(sectionId);
    window.history.replaceState(null, '', `${window.location.pathname}#${sectionId}`);
  }

  private queueSectionObserverSetup(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.setTimeout(() => this.setupSectionObserver(), 0);
  }

  private setupSectionObserver(): void {
    this.sectionObserver?.disconnect();
    this.sectionObserver = null;

    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const sectionNodes = Array.from(document.querySelectorAll<HTMLElement>('.insight-anchor'));
    if (sectionNodes.length === 0) {
      return;
    }

    this.activeSectionId.set(sectionNodes[0].id);

    this.sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));

        const closest = visible[0]?.target;
        if (closest instanceof HTMLElement && closest.id) {
          this.activeSectionId.set(closest.id);
        }
      },
      {
        root: null,
        rootMargin: '-120px 0px -65% 0px',
        threshold: [0.1, 0.3, 0.6]
      }
    );

    sectionNodes.forEach((node) => this.sectionObserver?.observe(node));
  }

  private prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
