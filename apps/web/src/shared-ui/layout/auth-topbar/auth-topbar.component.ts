import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { SiteUrlService } from '@shared-core/routing/site-url.service';

@Component({
  selector: 'app-auth-topbar',
  standalone: true,
  templateUrl: './auth-topbar.component.html',
  styleUrl: './auth-topbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuthTopbarComponent {
  readonly siteUrls = inject(SiteUrlService);
}
