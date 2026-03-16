import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';

import { MetadataConfiguration, MetadataCognitoConfiguration, MetadataPaymentsConfiguration } from '../config/metadata-configuration.models';
import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let metadataStub: Pick<MetadataConfigurationService, 'getValueAsync'>;
  let routerEvents: Subject<NavigationEnd>;
  let routerStub: Pick<Router, 'events' | 'navigated' | 'url'>;
  let originalUrl: string;

  beforeEach(() => {
    originalUrl = window.location.href;
    metadataStub = {
      getValueAsync: jasmine.createSpy().and.resolveTo(buildMetadata('G-TEST123456'))
    };
    routerEvents = new Subject<NavigationEnd>();
    routerStub = {
      events: routerEvents.asObservable(),
      navigated: false,
      url: '/signin'
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: MetadataConfigurationService, useValue: metadataStub },
        { provide: Router, useValue: routerStub }
      ]
    });

    window.history.replaceState({}, '', '/signin');
    document.title = 'ConveyMate | Sign in';
    service = TestBed.inject(AnalyticsService);
  });

  afterEach(() => {
    routerEvents.complete();
    document.querySelectorAll('script[data-sm-ga-id]').forEach((node) => node.remove());

    const analyticsWindow = window as Window & {
      dataLayer?: unknown[];
      gtag?: (...args: unknown[]) => void;
    };
    delete analyticsWindow.dataLayer;
    delete analyticsWindow.gtag;

    window.history.replaceState({}, '', originalUrl);
  });

  it('injects gtag script and tracks page views when measurement id is configured', async () => {
    await service.init();

    expect(metadataStub.getValueAsync).toHaveBeenCalledTimes(1);

    const scriptTag = document.querySelector('script[data-sm-ga-id="G-TEST123456"]') as HTMLScriptElement | null;
    expect(scriptTag).not.toBeNull();
    expect(scriptTag?.src).toContain('https://www.googletagmanager.com/gtag/js?id=G-TEST123456');

    const analyticsWindow = window as Window & { dataLayer?: unknown[] };
    expect(Array.isArray(analyticsWindow.dataLayer)).toBeTrue();

    routerEvents.next(new NavigationEnd(1, '/signin', '/signin'));

    const dataLayerEntries = analyticsWindow.dataLayer ?? [];
    expect(dataLayerEntries.some((entry) => isCommand(entry, (command) => command[0] === 'js' && command[1] instanceof Date))).toBeTrue();
    expect(
      dataLayerEntries.some(
        (entry) => isCommand(entry, (command) =>
          command[0] === 'config' &&
          command[1] === 'G-TEST123456' &&
          JSON.stringify(command[2]) === JSON.stringify({ send_page_view: false })
        )
      )
    ).toBeTrue();
    expect(
      dataLayerEntries.some(
        (entry) => isCommand(entry, (command) =>
          command[0] === 'event' &&
          command[1] === 'page_view' &&
          JSON.stringify(command[2]) ===
            JSON.stringify({
              page_location: window.location.href,
              page_path: '/signin',
              page_title: 'ConveyMate | Sign in'
            })
        )
      )
    ).toBeTrue();
  });

  it('does not inject script when measurement id is not configured', async () => {
    (metadataStub.getValueAsync as jasmine.Spy).and.resolveTo(buildMetadata(''));

    await service.init();

    const scriptTag = document.querySelector('script[data-sm-ga-id]') as HTMLScriptElement | null;
    expect(scriptTag).toBeNull();
  });
});

function buildMetadata(measurementId: string): MetadataConfiguration {
  const cognito: MetadataCognitoConfiguration = {
    region: 'ap-southeast-2',
    userPoolId: 'pool',
    appClientId: 'client',
    issuer: 'issuer',
    scopes: ['openid', 'email']
  };

  const payments: MetadataPaymentsConfiguration = {
    stripePublishableKey: 'pk_test_123',
    priceAudCents: 1999,
    currency: 'aud'
  };

  return {
    environment: 'Development',
    apiBaseUrl: 'http://localhost:5141',
    cognito,
    payments,
    analytics: {
      googleMeasurementId: measurementId
    },
    cacheTtlSeconds: 120
  };
}

function isCommand(entry: unknown, predicate: (command: unknown[]) => boolean): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const command = Array.from(entry as ArrayLike<unknown>);
  return predicate(command);
}
