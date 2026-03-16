import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  OnInit,
  Output,
  inject,
  signal
} from '@angular/core';
import { Router } from '@angular/router';

import { FeedbackService } from '@shared-core/services/feedback.service';
import { UserService } from '@shared-core/services/user.service';

type FeedbackType = 'bug' | 'suggestion' | 'general';

@Component({
  selector: 'app-feedback-dialog',
  standalone: true,
  templateUrl: './feedback-dialog.component.html',
  styleUrl: './feedback-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeedbackDialogComponent implements OnInit {
  private readonly feedbackService = inject(FeedbackService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  @Output() readonly closed = new EventEmitter<void>();

  readonly feedbackType = signal<FeedbackType>('general');
  readonly message = signal('');
  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // Snapshot the current user to attach to submission (no-op; user resolved server-side)
    this.userService.user$;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('feedback-overlay')) {
      this.close();
    }
  }

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    if (!this.message().trim() || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set(null);

    this.feedbackService
      .submitFeedback({
        type: this.feedbackType(),
        message: this.message().trim(),
        pageUrl: this.router.url
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.submitted.set(true);
        },
        error: (err: Error) => {
          this.submitting.set(false);
          this.error.set(err.message);
        }
      });
  }
}
