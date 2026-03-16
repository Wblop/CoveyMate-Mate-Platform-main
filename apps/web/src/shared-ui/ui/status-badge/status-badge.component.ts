import { ChangeDetectionStrategy, Component, Input, computed } from '@angular/core';
import { NgClass } from '@angular/common';

export type StatusBadgeValue = 'draft' | 'processing' | 'ready' | 'failed';

@Component({
  selector: 'ui-status-badge',
  standalone: true,
  imports: [NgClass],
  templateUrl: './status-badge.component.html',
  styleUrl: './status-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UIStatusBadgeComponent {
  @Input({ required: true }) status: StatusBadgeValue = 'draft';

  readonly label = computed(() => {
    if (this.status === 'processing') {
      return 'Processing';
    }
    if (this.status === 'ready') {
      return 'Ready';
    }
    if (this.status === 'failed') {
      return 'Failed';
    }
    return 'Draft';
  });
}
