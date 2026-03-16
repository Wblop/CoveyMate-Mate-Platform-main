import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { LegalPageComponent } from './legal-page.component';

describe('LegalPageComponent', () => {
  async function setup(routeData: unknown): Promise<ComponentFixture<LegalPageComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LegalPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: routeData
            }
          }
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(LegalPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders table of contents and section content when sections are provided', async () => {
    const fixture = await setup({
      title: 'Terms of use',
      subtitle: 'Service terms',
      tocTitle: 'Terms contents',
      sections: [
        {
          id: 'scope',
          title: '1. Scope',
          paragraphs: ['Scope paragraph.']
        },
        {
          id: 'refunds',
          title: '2. Refunds',
          paragraphs: ['Refund paragraph.'],
          bullets: ['No refund for completed report change-of-mind requests.']
        }
      ]
    });

    const host = fixture.nativeElement as HTMLElement;
    const tocLinks = Array.from(host.querySelectorAll('.legal-toc a'));

    expect(host.querySelector('h1')?.textContent).toContain('Terms of use');
    expect(host.querySelector('.legal-toc h2')?.textContent).toContain('Terms contents');
    expect(tocLinks).toHaveSize(2);
    expect(tocLinks[0].getAttribute('href')).toBe('#scope');
    expect(tocLinks.map((link) => link.textContent?.trim())).toEqual(['Scope', 'Refunds']);
    expect(Array.from(host.querySelectorAll('.legal-section h2')).map((item) => item.textContent?.trim())).toEqual([
      '1. Scope',
      '2. Refunds'
    ]);
    expect(host.textContent).toContain('Scope paragraph.');
    expect(host.textContent).toContain('Refund paragraph.');
    expect(host.textContent).toContain('No refund for completed report change-of-mind requests.');
  });

  it('renders paragraph fallback when sections are not provided', async () => {
    const fixture = await setup({
      title: 'Privacy',
      subtitle: 'How we handle data',
      paragraphs: ['Paragraph one.', 'Paragraph two.']
    });

    const host = fixture.nativeElement as HTMLElement;
    const toc = host.querySelector('.legal-toc');
    const paragraphs = Array.from(host.querySelectorAll('.legal-copy p')).map((item) => item.textContent?.trim() ?? '');

    expect(toc).toBeNull();
    expect(paragraphs).toEqual(['Paragraph one.', 'Paragraph two.']);
  });
});
