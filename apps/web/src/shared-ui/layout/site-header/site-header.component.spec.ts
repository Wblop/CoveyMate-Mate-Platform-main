import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthPresenceService } from '@shared-core/auth/auth-presence.service';

import { SiteHeaderComponent } from './site-header.component';

@Component({ standalone: true, template: '' })
class DummyComponent {}

class AuthPresenceServiceStub {
  readonly isSignedIn = signal(false);

  refreshFromCookie(): void {
    // No-op for tests.
  }
}

describe('SiteHeaderComponent', () => {
  let fixture: ComponentFixture<SiteHeaderComponent>;
  let host: HTMLElement;
  let authPresence: AuthPresenceServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteHeaderComponent],
      providers: [
        provideRouter([
          { path: '', component: DummyComponent },
          { path: 'insights', component: DummyComponent },
          { path: 'guides', component: DummyComponent }
        ]),
        { provide: AuthPresenceService, useClass: AuthPresenceServiceStub }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SiteHeaderComponent);
    host = fixture.nativeElement as HTMLElement;
    authPresence = TestBed.inject(AuthPresenceService) as unknown as AuthPresenceServiceStub;
    fixture.detectChanges();
  });

  it('renders the signed-out navigation by default', () => {
    const links = Array.from(host.querySelectorAll('.public-header__nav a')).map((link) =>
      (link.textContent || '').trim()
    );

    expect(links).toEqual(['Insights', 'Guides', 'Sign in', 'Create Account']);
  });

  it('renders the signed-in navigation when auth presence is detected', () => {
    authPresence.isSignedIn.set(true);
    fixture.detectChanges();

    const links = Array.from(host.querySelectorAll('.public-header__nav a')).map((link) =>
      (link.textContent || '').trim()
    );

    expect(links).toEqual(['Insights', 'Guides', 'Dashboard', 'New Report']);
  });

  it('toggles the mobile navigation state', () => {
    const toggle = host.querySelector('.public-header__mobile-toggle') as HTMLButtonElement;
    const nav = host.querySelector('.public-header__nav') as HTMLElement;

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(nav.classList.contains('is-open')).toBeFalse();

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(nav.classList.contains('is-open')).toBeTrue();
  });
});
