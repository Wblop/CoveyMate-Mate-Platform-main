import { ChangeDetectionStrategy, Component } from '@angular/core';

import { UIButtonComponent } from '@shared-ui/ui/button/button.component';

@Component({
  selector: 'app-landing-hero',
  standalone: true,
  imports: [UIButtonComponent],
  templateUrl: './landing-hero.component.html',
  styleUrl: './landing-hero.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingHeroComponent {}
