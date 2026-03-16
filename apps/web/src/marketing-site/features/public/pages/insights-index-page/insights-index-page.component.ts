import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { matchesInsightQuery } from '@marketing-site/features/public/insights/insights-content';
import { MarketingInsightsStore } from '@marketing-site/features/public/insights/marketing-insights.store';

@Component({
  selector: 'app-insights-index-page',
  standalone: true,
  templateUrl: './insights-index-page.component.html',
  styleUrl: './insights-index-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InsightsIndexPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly insightsStore = inject(MarketingInsightsStore);

  readonly searchTerm = signal('');
  readonly trendingKeywords = this.insightsStore.trendingKeywords;
  readonly filteredArticles = computed(() =>
    this.insightsStore.articles().filter((article) => matchesInsightQuery(article, this.searchTerm(), ''))
  );
  readonly visibleArticles = computed(() => this.filteredArticles().slice(0, 10));

  constructor() {
    this.insightsStore.ensureFreshManifest();

    this.route.queryParamMap.subscribe((params) => {
      this.searchTerm.set((params.get('q') ?? '').trim());
    });
  }

  updateSearch(event: Event): void {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    this.searchTerm.set(value);
    this.pushQueryState();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.pushQueryState();
  }

  private pushQueryState(): void {
    const queryParams: Record<string, string> = {};
    if (this.searchTerm().trim()) {
      queryParams['q'] = this.searchTerm().trim();
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true
    });
  }
}
