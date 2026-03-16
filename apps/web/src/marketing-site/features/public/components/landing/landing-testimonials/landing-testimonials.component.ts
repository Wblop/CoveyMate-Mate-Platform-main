import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-landing-testimonials',
  standalone: true,
  imports: [],
  templateUrl: './landing-testimonials.component.html',
  styleUrl: './landing-testimonials.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingTestimonialsComponent {
  readonly testimonials = [
    {
      quote: 'I had no idea what half the clauses meant. ConveyMate gave me a clear summary I could actually take to my solicitor with specific questions prepared.',
      name: 'Sarah M.',
      location: 'First home buyer, Sydney NSW'
    },
    {
      quote: 'The risk flags section was eye-opening. Caught an easement I completely missed. Absolutely worth it before exchange.',
      name: 'James T.',
      location: 'Property investor, Melbourne VIC'
    },
    {
      quote: 'Really useful for understanding the settlement timeline and what I needed to have sorted before the cooling-off period ended.',
      name: 'Priya K.',
      location: 'Buyer, Brisbane QLD'
    }
  ];

  readonly trustStats = [
    { value: '4.9★', label: 'Average user rating' },
    { value: '~8 mins', label: 'Typical report time' },
    { value: 'All states', label: 'Australian coverage' }
  ];
}
