import { of } from 'rxjs';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SiteNotificationService } from '@shared-core/services/site-notification.service';
import { PublicShellComponent } from './public-shell.component';

describe('PublicShellComponent', () => {
  let fixture: ComponentFixture<PublicShellComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicShellComponent],
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

    fixture = TestBed.createComponent(PublicShellComponent);
    fixture.detectChanges();
  });

  it('renders the public shell furniture', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-public-header')).toBeTruthy();
    expect(host.querySelector('app-footer')).toBeTruthy();
  });
});
