import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'ui-page-header',
  standalone: true,
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UIPageHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() description = '';
  @Input() eyebrow = '';
}
