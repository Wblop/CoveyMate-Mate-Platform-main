import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';

import { SiteNotificationService } from '@shared-core/services/site-notification.service';
import { AuthTopbarComponent } from '@shared-ui/layout/auth-topbar/auth-topbar.component';
import { FooterComponent } from '@shared-ui/layout/footer/footer.component';
import { UISiteNotificationStackComponent } from '@shared-ui/ui/site-notification-stack/site-notification-stack.component';

@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [RouterOutlet, AuthTopbarComponent, FooterComponent, UISiteNotificationStackComponent],
  templateUrl: './auth-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuthShellComponent {
  private readonly notificationService = inject(SiteNotificationService);

  readonly notifications = toSignal(this.notificationService.watchActiveNotifications('public'), { initialValue: [] });
}
