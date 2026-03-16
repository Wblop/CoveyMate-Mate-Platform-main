import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Component({
  selector: 'app-confirm-action-dialog',
  standalone: true,
  templateUrl: './confirm-action-dialog.component.html',
  styleUrl: './confirm-action-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfirmActionDialogComponent {
  @Input() title = 'Confirm action';
  @Input() description = '';
  @Input() detail = '';
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() busy = false;
  @Input() tone: 'danger' | 'neutral' = 'danger';

  @Output() readonly confirmed = new EventEmitter<void>();
  @Output() readonly cancelled = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.busy) {
      return;
    }

    this.cancelled.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if (this.busy) {
      return;
    }

    if ((event.target as HTMLElement).classList.contains('confirm-dialog-overlay')) {
      this.cancelled.emit();
    }
  }

  confirm(): void {
    if (this.busy) {
      return;
    }

    this.confirmed.emit();
  }

  cancel(): void {
    if (this.busy) {
      return;
    }

    this.cancelled.emit();
  }
}
