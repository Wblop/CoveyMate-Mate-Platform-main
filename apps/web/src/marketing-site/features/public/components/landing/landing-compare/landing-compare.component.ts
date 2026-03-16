import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-landing-compare',
  standalone: true,
  templateUrl: './landing-compare.component.html',
  styleUrl: './landing-compare.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingCompareComponent {}
