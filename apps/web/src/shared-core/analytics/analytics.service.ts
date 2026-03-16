import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';

interface AnalyticsWindow extends Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private readonly metadataConfiguration = inject(MetadataConfigurationService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);

  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    const measurementId = (await this.metadataConfiguration.getValueAsync()).analytics?.googleMeasurementId?.trim() ?? '';
    if (!measurementId || measurementId.startsWith('__') || !measurementId.toUpperCase().startsWith('G-')) {
      return;
    }

    const win = this.document.defaultView as AnalyticsWindow | null;
    if (!win) {
      return;
    }

    if (!this.document.querySelector(`script[data-sm-ga-id="${measurementId}"]`)) {
      const scriptTag = this.document.createElement('script');
      scriptTag.async = true;
      scriptTag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      scriptTag.setAttribute('data-sm-ga-id', measurementId);
      this.document.head.appendChild(scriptTag);
    }

    const dataLayer = win.dataLayer ?? [];
    win.dataLayer = dataLayer;
    win.gtag = function (..._args: unknown[]) {
      dataLayer.push(arguments);
    };
    const gtag = win.gtag;

    gtag('js', new Date());
    gtag('config', measurementId, { send_page_view: false });

    if (this.router.navigated) {
      this.trackPageView(gtag);
    }

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.trackPageView(gtag));
  }

  private trackPageView(gtag: (...args: unknown[]) => void): void {
    const location = this.document.location;
    const pagePath = location ? `${location.pathname}${location.search}` : this.router.url;

    gtag('event', 'page_view', {
      page_location: location?.href ?? pagePath,
      page_path: pagePath,
      page_title: this.document.title
    });
  }
}
