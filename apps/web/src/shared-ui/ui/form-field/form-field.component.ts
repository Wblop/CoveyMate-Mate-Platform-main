import { AfterContentInit, ChangeDetectionStrategy, Component, ElementRef, Input, inject, signal } from '@angular/core';

@Component({
  selector: 'ui-form-field',
  standalone: true,
  templateUrl: './form-field.component.html',
  styleUrl: './form-field.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UIFormFieldComponent implements AfterContentInit {
  private readonly el = inject(ElementRef);

  @Input({ required: true }) label = '';
  @Input() forId = '';
  @Input() hint = '';
  @Input() error = '';
  @Input() required = false;

  readonly tooltipOpen = signal(false);

  toggleTooltip(): void {
    this.tooltipOpen.update(v => !v);
  }

  closeTooltip(): void {
    this.tooltipOpen.set(false);
  }

  ngAfterContentInit(): void {
    const control = this.el.nativeElement.querySelector('input, select, textarea') as HTMLElement | null;
    if (!control) {
      return;
    }

    if (this.required) {
      control.setAttribute('aria-required', 'true');
    }

    if (this.forId) {
      const parts: string[] = [];
      if (this.hint) {
        parts.push(`${this.forId}-hint`);
      }
      // Always include error id - dangling references are ignored until the element renders
      parts.push(`${this.forId}-error`);
      control.setAttribute('aria-describedby', parts.join(' '));
    }
  }
}
