import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { normalizeSiteNotificationMessage, SiteNotification } from '@shared-core/services/site-notification.service';

@Component({
  selector: 'ui-site-notification-stack',
  standalone: true,
  templateUrl: './site-notification-stack.component.html',
  styleUrl: './site-notification-stack.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UISiteNotificationStackComponent {
  @Input() notifications: SiteNotification[] = [];

  headingForTone(tone: SiteNotification['tone']): string {
    return tone === 'warning' ? 'Important update' : 'Notice';
  }

  formattedMessage(message: string): string {
    return normalizeSiteNotificationMessage(message);
  }
}
