import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'ui-alert-banner',
  standalone: true,
  imports: [NgClass],
  templateUrl: './alert-banner.component.html',
  styleUrl: './alert-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UIAlertBannerComponent {
  @Input({ required: true }) title = '';
  @Input() message = '';
  @Input() tone: 'info' | 'success' | 'warn' | 'error' = 'info';
}
