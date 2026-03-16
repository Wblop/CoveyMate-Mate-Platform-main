import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { UnsubscribePublicQuoteRequestConveyancerResult } from '@shared-core/models/quote-request.models';
import { QuoteRequestService } from '@shared-core/services/quote-request.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';

@Component({
  selector: 'app-quote-unsubscribe-page',
  standalone: true,
  imports: [DatePipe, RouterLink, UIAlertBannerComponent, UIButtonComponent, UIPageHeaderComponent, UISkeletonBlockComponent],
  templateUrl: './quote-unsubscribe-page.component.html',
  styleUrl: './quote-unsubscribe-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuoteUnsubscribePageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly quoteRequestService = inject(QuoteRequestService);
  private readonly subscriptions = new Subscription();

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly result = signal<UnsubscribePublicQuoteRequestConveyancerResult | null>(null);

  constructor() {
    this.unsubscribe();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private unsubscribe(): void {
    const token = this.route.snapshot.paramMap.get('token')?.trim() ?? '';
    if (!token) {
      this.errorMessage.set('This unsubscribe link is invalid.');
      this.loading.set(false);
      return;
    }

    const subscription = this.quoteRequestService.unsubscribePublicConveyancer(token).subscribe({
      next: (result) => {
        this.result.set(result);
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.result.set(null);
      },
      complete: () => this.loading.set(false)
    });

    this.subscriptions.add(subscription);
  }
}
