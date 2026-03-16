import { ChangeDetectionStrategy, Component } from '@angular/core';

import { UIButtonComponent } from '@shared-ui/ui/button/button.component';

@Component({
  selector: 'app-landing-final-cta',
  standalone: true,
  imports: [UIButtonComponent],
  templateUrl: './landing-final-cta.component.html',
  styleUrl: './landing-final-cta.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingFinalCtaComponent {}
