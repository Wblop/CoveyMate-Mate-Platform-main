import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

interface LegalSectionViewModel extends LegalSection {
  tocTitle: string;
}

@Component({
  selector: 'app-legal-page',
  standalone: true,
  templateUrl: './legal-page.component.html',
  styleUrl: './legal-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LegalPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly title = this.route.snapshot.data['title'] ?? 'Legal';
  readonly subtitle = this.route.snapshot.data['subtitle'] ?? '';
  readonly tocTitle = this.route.snapshot.data['tocTitle'] ?? 'Table of contents';
  readonly paragraphs: string[] = this.route.snapshot.data['paragraphs'] ?? [];
  readonly sections: LegalSectionViewModel[] = ((this.route.snapshot.data['sections'] ?? []) as LegalSection[]).map((section) => ({
    ...section,
    tocTitle: this.toTocTitle(section.title)
  }));

  private toTocTitle(title: string): string {
    return title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, '').trim();
  }
}
