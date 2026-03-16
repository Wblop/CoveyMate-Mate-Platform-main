import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { AuthService } from '@shared-core/auth/auth.service';
import { UserProfile, UserService } from '@shared-core/services/user.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';

@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [DatePipe, UIPageHeaderComponent, UIButtonComponent, UIAlertBannerComponent, UISkeletonBlockComponent],
  templateUrl: './account-page.component.html',
  styleUrl: './account-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AccountPageComponent implements OnDestroy {
  readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private loadSubscription: Subscription | null = null;

  readonly loading = signal(true);
  readonly user = signal<UserProfile | null>(null);
  readonly errorMessage = signal('');

  constructor() {
    this.loadProfile();
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
  }

  loadProfile(forceRefresh = false): void {
    this.loading.set(true);
    this.errorMessage.set('');

    this.loadSubscription?.unsubscribe();

    try {
      this.loadSubscription = this.userService.loadUserInfo(forceRefresh).subscribe({
        next: (user) => {
          this.user.set(user);
        },
        error: () => {
          this.errorMessage.set('Refresh the page or try signing in again.');
          this.loading.set(false);
        },
        complete: () => {
          this.loading.set(false);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load account details.';
      this.errorMessage.set(message);
      this.loading.set(false);
    }
  }

  signOut(): void {
    this.auth.signOut();
    this.userService.clearCache();
    this.router.navigateByUrl('/');
  }

  initials(fullName: string): string {
    const tokens = fullName
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return 'SM';
    }
    if (tokens.length === 1) {
      return tokens[0].slice(0, 2).toUpperCase();
    }
    return `${tokens[0].charAt(1)}${tokens[1].charAt(0)}`.toUpperCase();
  }
}
