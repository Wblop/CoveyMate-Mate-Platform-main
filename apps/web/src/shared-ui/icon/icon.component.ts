import { ChangeDetectionStrategy, Component, Input, computed } from '@angular/core';

@Component({
  selector: 'app-icon',
  standalone: true,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IconComponent {
  @Input({ required: true }) name:
    | 'search'
    | 'map-pin'
    | 'phone'
    | 'mail'
    | 'globe'
    | 'briefcase'
    | 'shield'
    | 'book'
    | 'wrench'
    | 'sliders'
    | 'sparkles'
    | 'building'
    | 'calculator' = 'search';

  @Input() size: 'default' | 'lg' = 'default';

  readonly iconClass = computed(() => (this.size === 'lg' ? 'icon icon--lg' : 'icon'));

  readonly path = computed(() => {
    const paths: Record<string, string> = {
      search: 'm21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z',
      'map-pin': 'M12 21s7-4.2 7-10a7 7 0 1 0-14 0c0 5.8 7 10 7 10Zm0-7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
      phone: 'M22 16.9v2.8a2 2 0 0 1-2.2 2A19.9 19.9 0 0 1 2.3 4.2 2 2 0 0 1 4.2 2h2.8a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.8l-2 2a16 16 0 0 0 6.1 6.1l2-2a2 2 0 0 1 1.8-.6l3 .5a2 2 0 0 1 1.7 2Z',
      mail: 'm4 6 8 6 8-6M4 6h16v12H4z',
      globe: 'M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18M4.5 7.5a16 16 0 0 0 15 0M4.5 16.5a16 16 0 0 1 15 0',
      briefcase: 'M3 7h18v12H3zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18',
      shield: 'M12 3 5 6v6c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3Z',
      sliders: 'M4 6h16M4 12h16M4 18h16M9 6v2M15 12v2M7 18v2',
      sparkles: 'M12 3l1.6 3.7L17 8.3l-3.4 1.6L12 13.5l-1.6-3.6L7 8.3l3.4-1.6L12 3Zm7 10 1 2.2L22 16l-2 .8-1 2.2-1-2.2-2-.8 2-.8 1-2.2ZM5 14l1.2 2.8L9 18l-2.8 1.2L5 22l-1.2-2.8L1 18l2.8-1.2L5 14Z',
      building: 'M4 21h16M6 21V7l6-3 6 3v14M9 10h.01M12 10h.01M15 10h.01M9 14h.01M12 14h.01M15 14h.01',
      calculator: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm2 4h6M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h6',
      book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
      wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z'
    };

    return paths[this.name] ?? paths['search'];
  });
}
