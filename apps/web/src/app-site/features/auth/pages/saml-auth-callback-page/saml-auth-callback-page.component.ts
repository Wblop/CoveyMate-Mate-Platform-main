import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { map, switchMap, tap } from 'rxjs';

import { AuthService } from '@shared-core/auth/auth.service';
import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { AuditService } from '@shared-core/services/audit.service';
import { UserService } from '@shared-core/services/user.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';

type SamlCallbackStage = 'assertion' | 'profile' | 'redirect';

@Component({
  selector: 'app-saml-auth-callback-page',
  standalone: true,
  imports: [RouterLink, UIAlertBannerComponent],
  templateUrl: './saml-auth-callback-page.component.html',
  styleUrl: '../google-auth-callback-page/google-auth-callback-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SamlAuthCallbackPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly auditService = inject(AuditService);
  private readonly userService = inject(UserService);
  private readonly route = inject(ActivatedRoute);
  private readonly siteUrls = inject(SiteUrlService);

  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly stage = signal<SamlCallbackStage>('assertion');
  readonly steps = [
    {
      id: 'assertion',
      title: 'Validating SAML response',
      detail: 'Checking the stub assertion and restoring the requested redirect.'
    },
    {
      id: 'profile',
      title: 'Restoring your ConveyMate account',
      detail: 'Loading your profile, access, and saved workspace.'
    },
    {
      id: 'redirect',
      title: 'Sending you back in',
      detail: 'Redirecting you to the requested page as soon as your session is ready.'
    }
  ] as const;
  readonly heading = computed(() => {
    if (!this.loading()) {
      return 'SAML sign-in failed';
    }

    switch (this.stage()) {
      case 'profile':
        return 'Loading your account';
      case 'redirect':
        return 'Taking you back in';
      case 'assertion':
      default:
        return 'Signing you in';
    }
  });
  readonly description = computed(() => {
    if (!this.loading()) {
      return 'The SAML authentication flow could not be completed.';
    }

    switch (this.stage()) {
      case 'profile':
        return 'The SAML assertion is valid. We are restoring your ConveyMate workspace now.';
      case 'redirect':
        return 'Your local SAML session is connected. Redirecting you back into the app.';
      case 'assertion':
      default:
        return 'We are finalising the SAML return and setting up your local session.';
    }
  });
  readonly loadingNote = computed(() => {
    switch (this.stage()) {
      case 'profile':
        return 'The SAML response is accepted. We are loading your account details now.';
      case 'redirect':
        return 'Everything is ready. Redirecting you now.';
      case 'assertion':
      default:
        return 'This usually takes a moment after the identity provider returns you here.';
    }
  });

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    const providerError = query.get('error');
    const providerErrorDescription = query.get('error_description');
    const samlResponse = query.get('SAMLResponse');
    const relayState = query.get('RelayState');

    if (providerError) {
      this.fail(this.resolveProviderError(providerError, providerErrorDescription));
      return;
    }

    if (!samlResponse) {
      this.fail('SAML sign-in did not return a response. Start again.');
      return;
    }

    this.auth.completeSamlSignIn(samlResponse, relayState).pipe(
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
      return 'SAML sign-in was cancelled before it completed.';
    }

    return description?.trim() || 'SAML sign-in could not be completed. Start again.';
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'SAML sign-in could not be completed. Start again.';
  }

  isStepCurrent(stepId: SamlCallbackStage): boolean {
    return this.stage() === stepId;
  }

  isStepComplete(stepId: SamlCallbackStage): boolean {
    return this.stageOrder.indexOf(stepId) < this.stageOrder.indexOf(this.stage());
  }

  private readonly stageOrder: SamlCallbackStage[] = ['assertion', 'profile', 'redirect'];
}
