import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';

interface RetiredFeatureRouteData {
  eyebrow?: string;
  title?: string;
  description?: string;
  detail?: string;
  primaryLabel?: string;
  primaryLink?: string;
  secondaryLabel?: string;
  secondaryLink?: string;
}

@Component({
  selector: 'app-retired-feature-page',
  standalone: true,
  imports: [RouterLink, UIAlertBannerComponent, UIButtonComponent, UIPageHeaderComponent],
  templateUrl: './retired-feature-page.component.html',
  styleUrl: './retired-feature-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RetiredFeaturePageComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly routeData = computed<RetiredFeatureRouteData>(() => this.route.snapshot.data as RetiredFeatureRouteData);

  readonly eyebrow = computed(() => this.routeData().eyebrow?.trim() || 'Feature retired');
  readonly title = computed(() => this.routeData().title?.trim() || 'This workflow is no longer available');
  readonly description = computed(
    () => this.routeData().description?.trim() || 'ConveyMate has retired this feature. Existing reports and directory search remain available.'
  );
  readonly detail = computed(
    () => this.routeData().detail?.trim() || 'Use Reports to review existing records, or open Conveyancers to continue manually.'
  );
  readonly primaryLabel = computed(() => this.routeData().primaryLabel?.trim() || 'Open reports');
  readonly primaryLink = computed(() => this.routeData().primaryLink?.trim() || '/reports');
  readonly secondaryLabel = computed(() => this.routeData().secondaryLabel?.trim() || 'Browse conveyancers');
  readonly secondaryLink = computed(() => this.routeData().secondaryLink?.trim() || '/conveyancers');
}
