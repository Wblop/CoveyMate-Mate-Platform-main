import { ChangeDetectionStrategy, Component, HostBinding, Input, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SiteUrlService } from '@shared-core/routing/site-url.service';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FooterComponent {
  readonly siteUrls = inject(SiteUrlService);

  @Input() year = new Date().getFullYear();
  @Input() lastUpdated = '';
  @Input() showHelpLinks = false;
  @Input() compact = false;

  @HostBinding('class.footer--compact') get isCompact(): boolean {
    return this.compact;
  }
}
