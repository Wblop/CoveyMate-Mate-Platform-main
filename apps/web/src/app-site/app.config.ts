import { ViewportScroller, isPlatformBrowser } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { APP_INITIALIZER, ApplicationConfig, PLATFORM_ID, inject, provideZoneChangeDetection } from '@angular/core';
import { InMemoryScrollingOptions, provideRouter, withInMemoryScrolling } from '@angular/router';

import { AnalyticsService } from '@shared-core/analytics/analytics.service';
import { authTokenInterceptor } from '@shared-core/auth/auth-token.interceptor';
import { AuthService } from '@shared-core/auth/auth.service';
import { MetadataConfigurationService } from '@shared-core/config/metadata-configuration.service';
import { routes } from './app.routes';

function isBrowserRuntime(): boolean {
  return isPlatformBrowser(inject(PLATFORM_ID));
}

function initializeMetadataConfiguration() {
  if (!isBrowserRuntime()) {
    return () => undefined;
  }

  const metadataConfiguration = inject(MetadataConfigurationService);
  return () => metadataConfiguration.load();
}

function initializeAuth() {
  if (!isBrowserRuntime()) {
    return () => undefined;
  }

  const auth = inject(AuthService);
  return () => auth.tryRestoreSessionAsync();
}

function initializeAnalytics() {
  if (!isBrowserRuntime()) {
    return () => undefined;
  }

  const analytics = inject(AnalyticsService);
  return () => analytics.init();
}

function initializeViewportScrolling() {
  const viewportScroller = inject(ViewportScroller);
  return () => {
    viewportScroller.setOffset(appAnchorScrollOffset);
  };
}

export const appInMemoryScrollingOptions: InMemoryScrollingOptions = {
  anchorScrolling: 'enabled'
};

export const appAnchorScrollOffset: [number, number] = [0, 92];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([authTokenInterceptor])),
    provideRouter(routes, withInMemoryScrolling(appInMemoryScrollingOptions)),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeMetadataConfiguration,
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAnalytics,
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeViewportScrolling,
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      multi: true
    }
  ]
};
