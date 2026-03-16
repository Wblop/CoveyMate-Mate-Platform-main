import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';

import { type GeneratedInsightsManifest } from '@marketing-site/generated/insights.generated';
import {
  INITIAL_PUBLISHED_INSIGHTS,
  INITIAL_TRENDING_INSIGHT_KEYWORDS,
  buildMarketingInsightsCatalog,
  type MarketingInsightArticle,
  type MarketingTrendingKeyword
} from './insights-content';

@Injectable({ providedIn: 'root' })
export class MarketingInsightsStore {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly articlesState = signal<ReadonlyArray<MarketingInsightArticle>>(INITIAL_PUBLISHED_INSIGHTS);
  private readonly trendingKeywordsState = signal<ReadonlyArray<MarketingTrendingKeyword>>(INITIAL_TRENDING_INSIGHT_KEYWORDS);
  private readonly runtimeResolvedState = signal(!this.isBrowser);
  private readonly runtimeLoadingState = signal(false);
  private readonly articleMap = computed(
    () => new Map(this.articlesState().map((article) => [article.slug, article] as const))
  );

  readonly articles = this.articlesState.asReadonly();
  readonly trendingKeywords = this.trendingKeywordsState.asReadonly();
  readonly runtimeResolved = this.runtimeResolvedState.asReadonly();
  readonly runtimeLoading = this.runtimeLoadingState.asReadonly();

  ensureFreshManifest(): void {
    if (!this.isBrowser || this.runtimeResolvedState() || this.runtimeLoadingState()) {
      return;
    }

    this.runtimeLoadingState.set(true);
    this.http.get<GeneratedInsightsManifest>('/insights/latest.json').subscribe({
      next: (manifest) => {
        const catalog = buildMarketingInsightsCatalog(manifest);
        this.articlesState.set(catalog.articles);
        this.trendingKeywordsState.set(catalog.trendingKeywords);
        this.runtimeResolvedState.set(true);
        this.runtimeLoadingState.set(false);
      },
      error: () => {
        this.runtimeResolvedState.set(true);
        this.runtimeLoadingState.set(false);
      }
    });
  }

  findArticle(slug: string | null | undefined): MarketingInsightArticle | null {
    const normalizedSlug = (slug ?? '').trim().toLowerCase();
    return this.articleMap().get(normalizedSlug) ?? null;
  }
}
