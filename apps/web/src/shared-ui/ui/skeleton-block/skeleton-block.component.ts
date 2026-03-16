import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'ui-skeleton-block',
  standalone: true,
  templateUrl: './skeleton-block.component.html',
  styleUrl: './skeleton-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UISkeletonBlockComponent {
  @Input() height = 24;
}
