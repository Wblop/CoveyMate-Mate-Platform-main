import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '@shared-core/auth/auth.service';
import { AuditService } from '@shared-core/services/audit.service';
import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';

@Component({
  selector: 'app-forgot-password-page',
  standalone: true,
  imports: [FormsModule, RouterLink, UIButtonComponent, UIFormFieldComponent, UIAlertBannerComponent],
  templateUrl: './forgot-password-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ForgotPasswordPageComponent {
  private readonly authService = inject(AuthService);
  private readonly auditService = inject(AuditService);

  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly fieldError = signal('');

  email = '';

  onSubmit(event: Event): void {
    event.preventDefault();
    this.errorMessage.set('');
    this.successMessage.set('');
    this.fieldError.set('');

    if (!this.email.trim()) {
      this.fieldError.set('Email is required.');
      return;
    }

    this.loading.set(true);
    this.authService.requestPasswordReset(this.email).subscribe({
      next: () => {
        this.auditService.recordPasswordResetRequested(this.email.trim().toLowerCase()).subscribe();
        this.successMessage.set('If this email is registered, a reset link will be sent shortly.');
      },
      error: (error: Error) => {
        this.errorMessage.set(error.message);
      },
      complete: () => {
        this.loading.set(false);
      }
    });
  }
}
