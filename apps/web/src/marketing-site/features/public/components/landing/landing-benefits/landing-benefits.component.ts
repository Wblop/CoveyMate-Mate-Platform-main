import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-landing-benefits',
  standalone: true,
  templateUrl: './landing-benefits.component.html',
  styleUrl: './landing-benefits.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingBenefitsComponent {}
