import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'ui-stepper',
  standalone: true,
  imports: [NgClass],
  templateUrl: './stepper.component.html',
  styleUrl: './stepper.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UIStepperComponent {
  @Input({ required: true }) steps: string[] = [];
  @Input() currentStepIndex = 0;

  statusClass(index: number): string {
    if (index < this.currentStepIndex) {
      return 'is-complete';
    }
    if (index === this.currentStepIndex) {
      return 'is-current';
    }
    return 'is-upcoming';
  }
}
