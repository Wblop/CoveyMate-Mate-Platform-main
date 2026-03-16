import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { IconComponent } from '@shared-ui/icon/icon.component';

@Component({
  selector: 'app-app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './app-sidebar.component.html',
  styleUrl: './app-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppSidebarComponent {
  readonly siteUrls = inject(SiteUrlService);

  @Input() isMobileDrawerOpen = false;
  @Input() isSidebarInert = false;
  @Input() isAdmin = false;
  @Output() navigate = new EventEmitter<void>();
}
