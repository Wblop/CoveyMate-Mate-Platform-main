import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';

@Component({
  selector: 'app-landing-how-it-works',
  standalone: true,
  templateUrl: './landing-how-it-works.component.html',
  styleUrl: './landing-how-it-works.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingHowItWorksComponent implements AfterViewInit, OnDestroy {
  readonly visible = signal(false);

  @ViewChild('howItWorksSection')
  private howItWorksSection?: ElementRef<HTMLElement>;

  private observer: IntersectionObserver | null = null;

  ngAfterViewInit(): void {
    const section = this.howItWorksSection?.nativeElement;
    if (!section) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((entry) => entry.isIntersecting || entry.intersectionRatio >= 0.24);
        if (!isVisible) {
          return;
        }

        this.visible.set(true);
        this.observer?.disconnect();
        this.observer = null;
      },
      {
        threshold: [0.2, 0.38],
        rootMargin: '0px 0px -10% 0px'
      }
    );

    this.observer.observe(section);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
