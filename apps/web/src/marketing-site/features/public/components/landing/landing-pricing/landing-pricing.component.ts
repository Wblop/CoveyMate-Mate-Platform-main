import { ChangeDetectionStrategy, Component } from '@angular/core';

import { UIButtonComponent } from '@shared-ui/ui/button/button.component';

type LandingPricingPoint = {
  title: string;
  description: string;
};

type LandingPricingItem = {
  icon: 'document' | 'analysis' | 'brief';
  title: string;
  description: string;
};

@Component({
  selector: 'app-landing-pricing',
  standalone: true,
  imports: [UIButtonComponent],
  templateUrl: './landing-pricing.component.html',
  styleUrl: './landing-pricing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingPricingComponent {
  readonly summaryPoints: LandingPricingPoint[] = [
    {
      title: 'Full-pack insights workflow',
      description: 'Reads the entire contract pack — not just the clause you happened to paste in.'
    },
    {
      title: 'Visible progress while it runs',
      description: 'Watch extraction, review, and briefing stages happen in real time. Know exactly when your report is ready.'
    },
    {
      title: 'Structured adviser handover',
      description: 'A concise PDF brief with key findings, clause citations, and follow-up questions — ready to take into your next legal conversation.'
    }
  ];

  readonly includedItems: LandingPricingItem[] = [
    {
      icon: 'document',
      title: 'Full pack extraction',
      description: 'Every page parsed, text extracted, and clauses captured — including OCR fallback for scanned documents.'
    },
    {
      icon: 'analysis',
      title: 'Citation-backed review',
      description: 'Staged review with citation-backed findings, risk flags, and key dates — referenced back to your documents.'
    },
    {
      icon: 'brief',
      title: 'Structured insights brief',
      description: 'A PDF summary your adviser can open straight away — issues, clause references, and the questions worth asking.'
    }
  ];
}
