import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';

import { AuthService } from '@shared-core/auth/auth.service';
import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { SiteNotificationService } from '@shared-core/services/site-notification.service';
import { UserService } from '@shared-core/services/user.service';
import { AppHeaderComponent } from '@app-site/layout/app-header/app-header.component';
import { AppSidebarComponent } from '@app-site/layout/app-sidebar/app-sidebar.component';
import { FeedbackDialogComponent } from '@app-site/layout/feedback-dialog/feedback-dialog.component';
import { FooterComponent } from '@shared-ui/layout/footer/footer.component';
import { UISiteNotificationStackComponent } from '@shared-ui/ui/site-notification-stack/site-notification-stack.component';

@Component({
  selector: 'app-app-shell',
  standalone: true,
  imports: [RouterOutlet, AppHeaderComponent, AppSidebarComponent, FeedbackDialogComponent, FooterComponent, UISiteNotificationStackComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppShellComponent {
  private readonly authService = inject(AuthService);
  private readonly notificationService = inject(SiteNotificationService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly siteUrls = inject(SiteUrlService);

  private readonly document = inject(DOCUMENT);

  readonly sidebarOpen = signal(false);
  readonly feedbackOpen = signal(false);
  readonly isMobile = signal(false);
  readonly showScrollTop = signal(false);
  readonly notifications = toSignal(this.notificationService.watchActiveNotifications('dashboard'), { initialValue: [] });
  readonly currentUser = toSignal(this.userService.user$, { initialValue: null });
  readonly isAdmin = computed(() => this.currentUser()?.isAdmin === true);
  readonly sidebarInert = computed(() => this.isMobile() && !this.sidebarOpen());

  constructor() {
    this.syncViewportState();
    if (this.authService.isAuthenticatedSnapshot()) {
      this.userService.loadUserInfo().subscribe({
        error: () => {
          this.authService.signOut();
          this.userService.clearCache();
          void this.siteUrls.navigate(this.siteUrls.signInHref(this.router.url));
        }
      });
    }
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.showScrollTop.set(this.document.documentElement.scrollTop > 300);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.syncViewportState();
    if (!this.isMobile() && this.sidebarOpen()) {
      this.sidebarOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.sidebarOpen()) {
      this.sidebarOpen.set(false);
    }
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((current) => !current);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  scrollToTop(): void {
    this.document.defaultView?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  handleSignOut(): void {
    this.authService.signOut();
    this.userService.clearCache();
    void this.siteUrls.navigate(this.siteUrls.signOutHref());
  }

  private syncViewportState(): void {
    const view = this.document.defaultView;
    if (!view?.matchMedia) {
      this.isMobile.set(false);
      return;
    }

    this.isMobile.set(!view.matchMedia('(min-width: 1025px)').matches);
  }
}
