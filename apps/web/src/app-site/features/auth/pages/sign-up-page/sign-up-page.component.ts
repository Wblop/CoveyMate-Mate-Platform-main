import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '@shared-core/auth/auth.service';
import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';

@Component({
  selector: 'app-sign-up-page',
  standalone: true,
  imports: [FormsModule, RouterLink, UIButtonComponent, UIFormFieldComponent, UIAlertBannerComponent],
  templateUrl: './sign-up-page.component.html',
  styleUrl: './sign-up-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SignUpPageComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  readonly siteUrls = inject(SiteUrlService);

  @ViewChild('pageHeading') private readonly pageHeading?: ElementRef<HTMLHeadingElement>;

  readonly loading = signal(false);
  readonly verifyLoading = signal(false);
  readonly resendLoading = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly codeError = signal('');
  readonly awaitingVerification = signal(false);
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);
  readonly fieldErrors = signal<{ fullName: string; email: string; password: string; confirmPassword: string; terms: string }>({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    terms: ''
  });

  fullName = '';
  email = '';
  password = '';
  confirmPassword = '';
  termsAccepted = false;
  verificationCode = '';

  constructor() {
    // When the page transitions to the verification step, move focus to the
    // updated heading so screen-reader users know the form state has changed.
    effect(() => {
      if (this.awaitingVerification()) {
        queueMicrotask(() => this.pageHeading?.nativeElement.focus());
      }
    });
  }

  get passwordRequirements(): { minLength: boolean; hasUppercase: boolean; hasNumber: boolean } {
    return {
      minLength: this.password.length >= 12,
      hasUppercase: /[A-Z]/.test(this.password),
      hasNumber: /[0-9]/.test(this.password)
    };
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.errorMessage.set('');
    this.successMessage.set('');
    this.codeError.set('');

    const errors = {
      fullName: this.fullName.trim() ? '' : 'Full name is required.',
      email: this.email.trim() ? '' : 'Email is required.',
      password: this.password ? '' : 'Password is required.',
      confirmPassword: this.confirmPassword ? '' : 'Please confirm your password.',
      terms: this.termsAccepted ? '' : 'You must accept the Terms of Use and Privacy Policy to continue.'
    };

    if (this.password && this.confirmPassword && this.password !== this.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    this.fieldErrors.set(errors);
    if (Object.values(errors).some((value) => value)) {
      return;
    }

    this.loading.set(true);
    this.authService.signUp(this.fullName, this.email, this.password).subscribe({
      next: (result) => {
        if (result.userConfirmed) {
          this.awaitingVerification.set(false);
          this.successMessage.set('Account created. You can now sign in.');
          return;
        }

        this.awaitingVerification.set(true);
        this.successMessage.set('Verification code sent. Enter the code from your email to finish registration.');
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.loading.set(false);
      },
      complete: () => {
        this.loading.set(false);
        if (!this.awaitingVerification()) {
          setTimeout(() => {
            void this.router.navigateByUrl('/signin');
          }, 500);
        }
      }
    });
  }

  onVerifyCode(event: Event): void {
    event.preventDefault();
    this.errorMessage.set('');
    this.successMessage.set('');
    this.codeError.set('');

    if (!this.verificationCode.trim()) {
      this.codeError.set('Verification code is required.');
      return;
    }

    this.verifyLoading.set(true);
    this.authService.confirmRegistration(this.email, this.verificationCode).subscribe({
      next: () => {
        this.awaitingVerification.set(false);
        this.successMessage.set('Email verified. You can now sign in.');
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.verifyLoading.set(false);
      },
      complete: () => {
        this.verifyLoading.set(false);
        setTimeout(() => {
          void this.router.navigateByUrl('/signin?verified=1');
        }, 500);
      }
    });
  }

  onResendCode(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.resendLoading.set(true);

    this.authService.resendConfirmationCode(this.email).subscribe({
      next: () => {
        this.successMessage.set('A new verification code was sent to your email.');
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
        this.resendLoading.set(false);
      },
      complete: () => {
        this.resendLoading.set(false);
      }
    });
  }
}
