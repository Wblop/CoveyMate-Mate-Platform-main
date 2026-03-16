import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { UIAlertBannerComponent } from '@shared-ui/ui/alert-banner/alert-banner.component';
import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';

interface StubSamlAssertion {
  sub: string;
  email: string;
  name: string;
  groups: string[];
  isAdmin: boolean;
}

@Component({
  selector: 'app-saml-stub-sign-in-page',
  standalone: true,
  imports: [FormsModule, RouterLink, UIButtonComponent, UIFormFieldComponent, UIAlertBannerComponent],
  templateUrl: './saml-stub-sign-in-page.component.html',
  styleUrl: './saml-stub-sign-in-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SamlStubSignInPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly errorMessage = signal('');

  email = this.route.snapshot.queryParamMap.get('login_hint') ?? 'buyer@example.com';
  fullName = this.route.snapshot.queryParamMap.get('name') ?? 'Casey Buyer';
  isAdmin = this.route.snapshot.queryParamMap.get('admin') === '1';

  onSubmit(event: Event): void {
    event.preventDefault();
    this.errorMessage.set('');

    const email = this.email.trim().toLowerCase();
    const fullName = this.fullName.trim();
    const relayState = this.route.snapshot.queryParamMap.get('RelayState');

    if (!relayState) {
      this.errorMessage.set('The SAML sign-in request expired. Start again from the sign-in page.');
      return;
    }

    if (!email.includes('@')) {
      this.errorMessage.set('Enter a valid email address for the stub identity.');
      return;
    }

    if (!fullName) {
      this.errorMessage.set('Enter a display name for the stub identity.');
      return;
    }

    this.loading.set(true);

    const assertion = this.buildAssertion(email, fullName, this.isAdmin);
    const samlResponse = this.base64UrlEncode(JSON.stringify(assertion));

    void this.router.navigate(['/saml/callback'], {
      queryParams: {
        SAMLResponse: samlResponse,
        RelayState: relayState
      }
    });
  }

  private buildAssertion(email: string, fullName: string, isAdmin: boolean): StubSamlAssertion {
    return {
      sub: `stub-saml:${this.base64UrlEncode(email)}`,
      email,
      name: fullName,
      groups: isAdmin ? ['admins'] : [],
      isAdmin
    };
  }

  private base64UrlEncode(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const character of Array.from(bytes)) {
      binary += String.fromCharCode(character);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
}
