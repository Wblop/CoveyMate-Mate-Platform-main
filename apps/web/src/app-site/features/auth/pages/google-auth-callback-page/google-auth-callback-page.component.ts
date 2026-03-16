import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map, switchMap, tap } from 'rxjs';

import { AuthService } from '@shared-core/auth/auth.service';
import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { AuditService } from '@shared-core/services/audit.service';
import { UserService } from '@shared-core/services/user.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';

type GoogleCallbackStage = 'exchange' | 'profile' | 'redirect';

@Component({
  selector: 'app-google-auth-callback-page',
  standalone: true,
  imports: [RouterLink, UIAlertBannerComponent],
  templateUrl: './google-auth-callback-page.component.html',
  styleUrl: './google-auth-callback-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GoogleAuthCallbackPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly auditService = inject(AuditService);
  private readonly userService = inject(UserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly siteUrls = inject(SiteUrlService);

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly stage = signal<GoogleCallbackStage>('exchange');
  readonly steps = [
    {
      id: 'exchange',
      title: 'Verifying with Google',
      detail: 'Securely exchanging the authorisation code.'
    },
    {
      id: 'profile',
      title: 'Restoring your ConveyMate account',
      detail: 'Loading your profile, access, and saved workspace.'
    },
    {
      id: 'redirect',
      title: 'Sending you back in',
      detail: 'Redirecting you to the right page as soon as everything is ready.'
    }
  ] as const;
  readonly heading = computed(() => {
    if (!this.loading()) {
      return 'Google sign-in failed';
    }

    switch (this.stage()) {
      case 'profile':
        return 'Loading your account';
      case 'redirect':
        return 'Taking you back in';
      case 'exchange':
      default:
        return 'Signing you in';
    }
  });
  readonly description = computed(() => {
    if (!this.loading()) {
      return 'The Google authentication flow could not be completed.';
    }

    switch (this.stage()) {
      case 'profile':
        return 'Google sign-in is confirmed. We are restoring your ConveyMate workspace now.';
      case 'redirect':
        return 'Your account is connected. Redirecting you to continue where you left off.';
      case 'exchange':
      default:
        return 'We are finalising your secure Google sign-in and setting up your session.';
    }
  });
  readonly loadingNote = computed(() => {
    switch (this.stage()) {
      case 'profile':
        return 'Your Google account is connected. We are loading your account details now.';
      case 'redirect':
        return 'Everything is ready. Redirecting you now.';
      case 'exchange':
      default:
        return 'This usually takes a moment after Google returns you here.';
    }
  });

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    const providerError = query.get('error');
    const providerErrorDescription = query.get('error_description');
    const code = query.get('code');
    const state = query.get('state');

    if (providerError) {
      this.fail(this.resolveProviderError(providerError, providerErrorDescription));
      return;
    }

    if (!code) {
      this.fail('Google sign-in did not return an authorization code. Start again.');
      return;
    }

    this.auth.completeGoogleSignIn(code, state).pipe(
      tap(() => this.stage.set('profile')),
      switchMap((redirectPath) =>
        this.userService.loadUserInfo(true).pipe(
          tap(() => this.stage.set('redirect')),
          map(() => redirectPath)
        )
      )
    ).subscribe({
      next: (redirectPath) => {
        this.auditService.recordSignInSucceeded().subscribe();
        void this.siteUrls.navigateToApp(redirectPath);
      },
      error: (error: unknown) => {
        this.auth.signOut();
        this.userService.clearCache();
        this.fail(this.resolveErrorMessage(error));
      }
    });
  }

  private fail(message: string): void {
    this.errorMessage.set(message);
    this.loading.set(false);
  }

  private resolveProviderError(error: string, description: string | null): string {
    if (error === 'access_denied') {
      return 'Google sign-in was cancelled before it completed.';
    }

    return description?.trim() || 'Google sign-in could not be completed. Start again.';
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'Google sign-in could not be completed. Start again.';
  }

  isStepCurrent(stepId: GoogleCallbackStage): boolean {
    return this.stage() === stepId;
  }

  isStepComplete(stepId: GoogleCallbackStage): boolean {
    return this.stageOrder.indexOf(stepId) < this.stageOrder.indexOf(this.stage());
  }

  private readonly stageOrder: GoogleCallbackStage[] = ['exchange', 'profile', 'redirect'];
}
