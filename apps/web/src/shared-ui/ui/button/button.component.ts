import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'ui-button',
  standalone: true,
  imports: [NgClass, RouterLink],
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UIButtonComponent {
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() title = '';
  @Input() disabled = false;
  @Input() loading = false;
  @Input() variant: 'primary' | 'secondary' | 'tertiary' | 'destructive' = 'primary';
  @Input() routerLink: string | unknown[] | null = null;
  @Input() fragment: string | null = null;
  @Input() queryParams: Record<string, unknown> | null = null;

  @Output() pressed = new EventEmitter<MouseEvent>();
}
