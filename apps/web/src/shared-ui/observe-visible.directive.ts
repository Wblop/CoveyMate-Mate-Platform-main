import {
  AfterViewInit,
  Directive,
  ElementRef,
  EventEmitter,
  NgZone,
  OnDestroy,
  Output,
  inject
} from '@angular/core';

@Directive({
  selector: '[appObserveVisible]',
  standalone: true
})
export class ObserveVisibleDirective implements AfterViewInit, OnDestroy {
  @Output() visible = new EventEmitter<void>();

  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly ngZone = inject(NgZone);
  private observer: IntersectionObserver | null = null;

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) {
              continue;
            }

            this.ngZone.run(() => this.visible.emit());
          }
        },
        {
          root: null,
          threshold: 0,
          rootMargin: '500px'
        }
      );

      this.observer.observe(this.element.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
