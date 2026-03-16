import { of } from 'rxjs';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SiteNotificationService } from '@shared-core/services/site-notification.service';

import { AuthShellComponent } from './auth-shell.component';

describe('AuthShellComponent', () => {
  let fixture: ComponentFixture<AuthShellComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthShellComponent],
      providers: [
        provideRouter([]),
        {
          provide: SiteNotificationService,
          useValue: {
            watchActiveNotifications: () => of([])
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AuthShellComponent);
    fixture.detectChanges();
  });

  it('renders the auth shell furniture', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.sm-shell--auth')).toBeTruthy();
    expect(host.querySelector('app-auth-topbar')).toBeTruthy();
    expect(host.querySelector('app-footer')).toBeTruthy();
  });
});
