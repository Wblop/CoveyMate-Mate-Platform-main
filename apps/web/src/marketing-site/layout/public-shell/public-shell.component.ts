import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { SiteNotificationService } from '@shared-core/services/site-notification.service';
import { FooterComponent } from '@shared-ui/layout/footer/footer.component';
import { SiteHeaderComponent } from '@shared-ui/layout/site-header/site-header.component';
import { UISiteNotificationStackComponent } from '@shared-ui/ui/site-notification-stack/site-notification-stack.component';

@Component({
  selector: 'app-public-shell',
  standalone: true,
  imports: [RouterOutlet, SiteHeaderComponent, FooterComponent, UISiteNotificationStackComponent],
  templateUrl: './public-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PublicShellComponent {
  private readonly notificationService = inject(SiteNotificationService);
  private readonly router = inject(Router);

  readonly notifications = toSignal(this.notificationService.watchActiveNotifications('public'), { initialValue: [] });
  readonly compactFooter = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/insights')),
      startWith(this.router.url.startsWith('/insights'))
    ),
    { initialValue: this.router.url.startsWith('/insights') }
  );
}
