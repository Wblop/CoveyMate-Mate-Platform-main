import { BehaviorSubject } from 'rxjs';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { UserService } from '@shared-core/services/user.service';
import { AppHeaderComponent } from './app-header.component';

describe('AppHeaderComponent', () => {
  let fixture: ComponentFixture<AppHeaderComponent>;
  let component: AppHeaderComponent;

  const userSubject = new BehaviorSubject({
    id: 'usr-1',
    fullName: 'Casey Buyer',
    email: 'buyer@conveymate.test',
    createdAt: '2026-02-23T00:00:00Z'
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppHeaderComponent],
      providers: [
        provideRouter([]),
        {
          provide: UserService,
          useValue: {
            user$: userSubject.asObservable()
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AppHeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('displays real user name and email from user service', () => {
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector('.app-header__menu-trigger') as HTMLButtonElement;

    expect(trigger.textContent).toContain('Casey Buyer');

    trigger.click();
    fixture.detectChanges();

    const menuEmail = host.querySelector('.app-header__menu-email');
    expect(menuEmail?.textContent).toContain('buyer@conveymate.test');
  });

  it('opens and closes account menu with keyboard controls', fakeAsync(() => {
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector('.app-header__menu-trigger') as HTMLButtonElement;

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();

    const menu = host.querySelector('#user-menu');
    expect(menu).toBeTruthy();

    const firstMenuItem = menu?.querySelector('[role="menuitem"]') as HTMLElement;
    expect(document.activeElement).toBe(firstMenuItem);

    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();

    expect(host.querySelector('#user-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  }));

  it('emits sign out from account menu action', () => {
    const host = fixture.nativeElement as HTMLElement;
    const signOutSpy = jasmine.createSpy('signOut');
    component.signOut.subscribe(signOutSpy);

    const trigger = host.querySelector('.app-header__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const signOutButton = host.querySelector('#user-menu .app-header__menu-signout') as HTMLButtonElement;
    signOutButton.click();
    fixture.detectChanges();

    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });

  it('emits feedback from account menu action', () => {
    const host = fixture.nativeElement as HTMLElement;
    const feedbackSpy = jasmine.createSpy('feedbackRequest');
    component.feedbackRequest.subscribe(feedbackSpy);

    const trigger = host.querySelector('.app-header__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const feedbackButton = Array.from(host.querySelectorAll('#user-menu button[role="menuitem"]')).find(
      (button) => button.textContent?.trim() === 'Feedback'
    ) as HTMLButtonElement | undefined;

    feedbackButton?.click();
    fixture.detectChanges();

    expect(feedbackSpy).toHaveBeenCalledTimes(1);
  });

  it('renders a home link back to the landing page', () => {
    const host = fixture.nativeElement as HTMLElement;
    const homeLink = host.querySelector('.app-header__home-link') as HTMLAnchorElement;

    expect(homeLink.textContent?.trim()).toBe('Home');
    expect(homeLink.getAttribute('href')).toBe('/');
  });
});
