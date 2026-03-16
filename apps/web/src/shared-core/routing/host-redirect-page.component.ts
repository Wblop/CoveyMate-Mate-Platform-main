import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { SiteUrlService } from './site-url.service';

type RedirectHost = 'app' | 'marketing';

@Component({
  selector: 'app-host-redirect-page',
  standalone: true,
  templateUrl: './host-redirect-page.component.html',
  styleUrl: './host-redirect-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HostRedirectPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly siteUrls = inject(SiteUrlService);
  private redirectTimer: ReturnType<typeof setTimeout> | null = null;

  readonly redirectHost = computed<RedirectHost>(
    () => (this.route.snapshot.data['redirectHost'] as RedirectHost | undefined) ?? 'marketing'
  );
  readonly targetPath = computed(() => {
    const configuredRedirectPath = this.route.snapshot.data['redirectPath'];
    if (typeof configuredRedirectPath === 'string' && configuredRedirectPath.trim().length > 0) {
      return configuredRedirectPath.trim();
    }

    return this.router.url || '/';
  });

  readonly targetHref = computed(() => {
    return this.redirectHost() === 'app'
      ? this.siteUrls.appHref(this.targetPath())
      : this.siteUrls.marketingHref(this.targetPath());
  });

  readonly heading = computed(() =>
    this.redirectHost() === 'app'
      ? 'Redirecting to your all-in-one AI insights platform'
      : 'Redirecting to ConveyMate'
  );

  readonly description = computed(() =>
    this.redirectHost() === 'app'
      ? 'Opening reports, buyer insights, and quote workflows.'
      : 'Opening the latest guides, calculators, and insights.'
  );

  readonly statusLabel = computed(() =>
    this.redirectHost() === 'app'
      ? 'Taking you there now'
      : 'Taking you there now'
  );

  ngOnInit(): void {
    if (!this.siteUrls.isBrowser()) {
      return;
    }

    this.redirectTimer = setTimeout(() => {
      void this.siteUrls.navigate(this.targetHref());
    }, 420);
  }

  ngOnDestroy(): void {
    if (this.redirectTimer !== null) {
      clearTimeout(this.redirectTimer);
      this.redirectTimer = null;
    }
  }
}
