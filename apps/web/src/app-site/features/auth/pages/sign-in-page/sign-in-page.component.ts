import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

import { AuthService } from '@shared-core/auth/auth.service';
import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { AuditService } from '@shared-core/services/audit.service';
import { UserService } from '@shared-core/services/user.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';

@Component({
  selector: 'app-sign-in-page',
  standalone: true,
  imports: [FormsModule, RouterLink, UIButtonComponent, UIFormFieldComponent, UIAlertBannerComponent],
  templateUrl: './sign-in-page.component.html',
  styleUrl: './sign-in-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SignInPageComponent {
  private readonly authService = inject(AuthService);
  private readonly auditService = inject(AuditService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly siteUrls = inject(SiteUrlService);

  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly fieldErrors = signal<{ email: string; password: string }>({ email: '', password: '' });
  readonly showVerifiedBanner = signal(false);
  readonly showPassword = signal(false);
  readonly signInMode = signal<'credentials' | 'stub-saml'>('credentials');
  readonly googleSignInAvailable = signal(false);
  readonly googleLoading = signal(false);
  readonly samlLoading = signal(false);

  constructor() {
    if (this.route.snapshot.queryParamMap.get('verified') === '1') {
      this.showVerifiedBanner.set(true);
    }

    if (isPlatformBrowser(this.platformId)) {
      void this.loadSignInExperience();
    }
  }

  email = '';
  password = '';

  onSubmit(event: Event): void {
    event.preventDefault();
    this.errorMessage.set('');
    this.fieldErrors.set({ email: '', password: '' });

    const errors = {
      email: !this.email.trim() ? '' : 'Email is required.',
      password: this.password.trim() ? '' : 'Password is required.'
    };
    this.fieldErrors.set(errors);

    if (errors.email || errors.password) {
      return;
    }

    this.loading.set(true);
    this.authService.signIn(this.email, this.password).pipe(
      switchMap(() => this.userService.loadUserInfo(true))
    ).subscribe({
      next: () => {
        this.auditService.recordSignInSucceeded().subscribe();
        const rawRedirect = this.route.snapshot.queryParamMap.get('redirect') ?? '';
        const redirect = this.siteUrls.normalizeAppRedirect(rawRedirect);
        void this.siteUrls.navigateToApp(redirect);
      },
      error: (error: Error) => {
        this.errorMessage.set(this.resolveSignInErrorMessage(error));
        this.loading.set(false);
      },
      complete: () => {
        this.loading.set(false);
      }
    });
  }

  onGoogleSignIn(): void {
    this.errorMessage.set('');
    this.googleLoading.set(true);

    const requestedRedirect = this.route.snapshot.queryParamMap.get('redirect') ?? undefined;

    void this.authService.startGoogleSignInAsync(requestedRedirect).catch((error: unknown) => {
      this.errorMessage.set(this.resolveSignInErrorMessage(error));
      this.googleLoading.set(false);
    });
  }

  onSamlSignIn(): void {
    this.errorMessage.set('');
    this.samlLoading.set(true);

    const requestedRedirect = this.route.snapshot.queryParamMap.get('redirect') ?? undefined;

    void this.authService.startSamlSignInAsync(requestedRedirect).catch((error: unknown) => {
      this.errorMessage.set(this.resolveSignInErrorMessage(error));
      this.samlLoading.set(false);
    });
  }

  private resolveSignInErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your account details could not be loaded. Please try again or contact support.';
    }

    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'Your account is suspended. Contact support for assistance.';
    }

    if (error instanceof Error) {
      if (error.message.includes('Metadata configuration is unavailable')) {
        return 'App configuration was not ready. Refresh and try again.';
      }

      return error.message;
    }

    return 'Sign-in failed. Please try again.';
  }

  private async loadSignInExperience(): Promise<void> {
    try {
      const experience = await this.authService.getSignInExperienceAsync();
      this.signInMode.set(experience.mode);
      this.googleSignInAvailable.set(experience.googleAvailable);
    } catch {
      this.signInMode.set('credentials');
      this.googleSignInAvailable.set(false);
    }
  }
}
