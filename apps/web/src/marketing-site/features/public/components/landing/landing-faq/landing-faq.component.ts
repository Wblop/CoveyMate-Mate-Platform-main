import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

type LandingFaqItem = {
  id: string;
  question: string;
  answer: string;
};

type LandingFaqGroup = {
  id: string;
  title: string;
  items: LandingFaqItem[];
};

@Component({
  selector: 'app-landing-faq',
  standalone: true,
  templateUrl: './landing-faq.component.html',
  styleUrl: './landing-faq.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingFaqComponent {
  readonly faqGroups: LandingFaqGroup[] = [
    {
      id: 'understanding',
      title: 'Understanding the report',
      items: [
        {
          id: 'legal-advice',
          question: 'Is ConveyMate legal advice?',
          answer:
            'No. ConveyMate generates structured contract insights to help you prepare for professional legal advice — it does not replace your solicitor or conveyancer. Always confirm findings before exchange or any binding decision.'
        },
        {
          id: 'included',
          question: 'What do I get for AUD $19.99?',
          answer:
            'The full contract briefing workflow: upload, extraction from your complete pack, citation-backed review, live progress tracking, and a structured PDF brief with findings, clause citations, and follow-up questions for your adviser conversation.'
        },
        {
          id: 'generic-ai',
          question: 'Why not just paste the contract into ChatGPT?',
          answer:
            'Generic chat tools can explain a clause if you know what to ask. ConveyMate reads the full pack without you needing to paste anything, tracks the job, and delivers a structured briefing you can carry into your next legal conversation.'
        }
      ]
    },
    {
      id: 'next-steps',
      title: 'Using it with a professional',
      items: [
        {
          id: 'conveyancer',
          question: 'How do you help me find a conveyancer?',
          answer:
            'Once your report is ready, you can search the ConveyMate directory by state, review firm details, and take your report summary and questions into your outreach manually.'
        },
        {
          id: 'when-to-involve',
          question: 'When should I involve my solicitor or conveyancer?',
          answer:
            'Before exchange, settlement, waiver, rescission, or any binding decision. The insights report is designed to sharpen that legal conversation — not replace it.'
        }
      ]
    }
  ];

  readonly openItemId = signal(this.faqGroups[0]?.items[0]?.id ?? '');

  toggleItem(id: string): void {
    this.openItemId.set(this.openItemId() === id ? '' : id);
  }
}
