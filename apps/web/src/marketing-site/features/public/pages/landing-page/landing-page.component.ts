import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

import { LandingBenefitsComponent } from '../../components/landing/landing-benefits/landing-benefits.component';
import { LandingCompareComponent } from '../../components/landing/landing-compare/landing-compare.component';
import { LandingDirectoryComponent } from '../../components/landing/landing-directory/landing-directory.component';
import { LandingFaqComponent } from '../../components/landing/landing-faq/landing-faq.component';
import { LandingFinalCtaComponent } from '../../components/landing/landing-final-cta/landing-final-cta.component';
import { LandingHeroComponent } from '../../components/landing/landing-hero/landing-hero.component';
import { LandingHowItWorksComponent } from '../../components/landing/landing-how-it-works/landing-how-it-works.component';
import { LandingPricingComponent } from '../../components/landing/landing-pricing/landing-pricing.component';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [
    LandingHeroComponent,
    LandingHowItWorksComponent,
    LandingBenefitsComponent,
    LandingCompareComponent,
    LandingPricingComponent,
    LandingDirectoryComponent,
    LandingFaqComponent,
    LandingFinalCtaComponent
  ],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingPageComponent {}
