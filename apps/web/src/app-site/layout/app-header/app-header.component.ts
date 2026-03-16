import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { SiteUrlService } from '@shared-core/routing/site-url.service';
import { UserService } from '@shared-core/services/user.service';

@Component({
  selector: 'app-app-header',
  standalone: true,
  imports: [RouterLink, AsyncPipe],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppHeaderComponent {
  readonly siteUrls = inject(SiteUrlService);
  readonly userService = inject(UserService);
  readonly menuOpen = signal(false);

  @Input() sidebarOpen = false;
  @Output() signOut = new EventEmitter<void>();
  @Output() sidebarToggle = new EventEmitter<void>();
  @Output() feedbackRequest = new EventEmitter<void>();

  @ViewChild('menuTrigger') private menuTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('menuPanel') private menuPanel?: ElementRef<HTMLElement>;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.app-header__menu-wrap')) {
      this.closeMenu(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuOpen()) {
      this.closeMenu(true);
    }
  }

  initials(fullNameValue: string | null | undefined): string {
    const fullName = fullNameValue?.trim();
    if (!fullName) {
      return 'A';
    }

    const parts = fullName.split(/\s+/).slice(0, 2);
    const computed = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
    return computed || 'A';
  }

  toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeMenu(false);
      return;
    }

    this.menuOpen.set(true);
    queueMicrotask(() => this.focusFirstMenuItem());
  }

  closeMenu(returnFocus = false): void {
    if (!this.menuOpen()) {
      return;
    }

    this.menuOpen.set(false);
    if (returnFocus) {
      queueMicrotask(() => this.menuTrigger?.nativeElement.focus());
    }
  }

  emitFeedback(): void {
    this.closeMenu(false);
    this.feedbackRequest.emit();
  }

  emitSignOut(): void {
    this.closeMenu(false);
    this.signOut.emit();
  }

  onMenuTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.menuOpen()) {
        this.menuOpen.set(true);
      }
      queueMicrotask(() => this.focusFirstMenuItem());
    }
  }

  onMenuKeydown(event: KeyboardEvent): void {
    const items = this.menuItems();
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu(true);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      items[nextIndex].focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const previousIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      items[previousIndex].focus();
    }
  }

  private focusFirstMenuItem(): void {
    this.menuItems()[0]?.focus();
  }

  private menuItems(): HTMLElement[] {
    const panel = this.menuPanel?.nativeElement;
    if (!panel) {
      return [];
    }

    return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }
}
