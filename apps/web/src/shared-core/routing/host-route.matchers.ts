import { inject } from '@angular/core';
import { CanMatchFn, UrlSegment } from '@angular/router';

import { SiteUrlService } from './site-url.service';

function segmentsToPath(segments: UrlSegment[]): string {
  if (segments.length === 0) {
    return '/';
  }

  return `/${segments.map((segment) => segment.path).join('/')}`;
}

export const marketingHostCanMatch: CanMatchFn = (_route, segments) => {
  const siteUrls = inject(SiteUrlService);
  if (siteUrls.isAppHost()) {
    return false;
  }

  return true;
};

export const appHostCanMatch: CanMatchFn = (_route, segments) => {
  const siteUrls = inject(SiteUrlService);
  if (siteUrls.isAppHost()) {
    return true;
  }

  return siteUrls.isAppOnlyRoutePath(segmentsToPath(segments));
};
