import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UISiteNotificationStackComponent } from './site-notification-stack.component';

describe('UISiteNotificationStackComponent', () => {
  let fixture: ComponentFixture<UISiteNotificationStackComponent>;
  let component: UISiteNotificationStackComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UISiteNotificationStackComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UISiteNotificationStackComponent);
    component = fixture.componentInstance;
  });

  it('renders a stacked warning banner with normalized message copy', () => {
    component.notifications = [
      {
        id: 'notification-1',
        message: '  Report processing is in beta.\n\nPlease take this into consideration before purchase.  ',
        tone: 'warning',
        audience: 'both',
        isEnabled: true,
        createdAt: '2026-03-08T00:00:00Z',
        updatedAt: '2026-03-08T00:00:00Z'
      }
    ];

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const label = host.querySelector('.site-notification__label');
    const message = host.querySelector('.site-notification__message');
    const banner = host.querySelector('.site-notification');

    expect(label?.textContent?.trim()).toBe('Important update');
    expect(message?.textContent?.trim()).toBe('Report processing is in beta. Please take this into consideration before purchase.');
    expect(banner?.getAttribute('role')).toBe('alert');
  });

  it('does not render when there are no notifications', () => {
    component.notifications = [];

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.site-notification-stack')).toBeNull();
  });
});
