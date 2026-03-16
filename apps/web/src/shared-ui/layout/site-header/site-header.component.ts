import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AuthPresenceService } from '@shared-core/auth/auth-presence.service';
import { SiteUrlService } from '@shared-core/routing/site-url.service';

@Component({
  selector: 'app-site-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './site-header.component.html',
  styleUrl: './site-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SiteHeaderComponent {
  private readonly document = inject(DOCUMENT);

  readonly siteUrls = inject(SiteUrlService);
  readonly authPresence = inject(AuthPresenceService);
  readonly mobileNavOpen = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.public-header__nav') && !target.closest('.public-header__mobile-toggle')) {
      this.closeMobileNav();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMobileNav();
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    this.authPresence.refreshFromCookie();
  }

  @HostListener('window:pageshow')
  onPageShow(): void {
    this.authPresence.refreshFromCookie();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (this.document.visibilityState === 'visible') {
      this.authPresence.refreshFromCookie();
    }
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.update((current) => !current);
  }

  closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }
}
