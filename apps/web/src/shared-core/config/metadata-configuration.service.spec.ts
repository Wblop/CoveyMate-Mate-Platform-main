import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { MetadataConfigurationService } from './metadata-configuration.service';

describe('MetadataConfigurationService', () => {
  let service: MetadataConfigurationService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });

    service = TestBed.inject(MetadataConfigurationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('loads metadata from API and caches it with TTL', async () => {
    const loadPromise = service.load();

    const request = httpMock.expectOne('/metadataconfiguration');
    request.flush(
      {
        environment: 'Development',
        apiBaseUrl: 'http://localhost:5141',
        cacheTtlSeconds: 300,
        cognito: {
          region: 'ap-southeast-2',
          userPoolId: 'pool',
          appClientId: 'client',
          issuer: 'issuer',
          scopes: ['openid', 'email']
        },
        payments: {
          stripePublishableKey: 'pk_test_123',
          priceAudCents: 1999,
          currency: 'aud'
        }
      },
      {
        headers: { 'Cache-Control': 'public, max-age=120' }
      }
    );

    await loadPromise;
    expect(service.value.apiBaseUrl).toBe('http://localhost:5141');

    await service.load();
    httpMock.expectNone('/metadataconfiguration');
  });

  it('uses valid local storage cache during startup load', async () => {
    const cached = {
      value: {
        environment: 'Production',
        apiBaseUrl: 'https://api.conveymate.test',
        cacheTtlSeconds: 300,
        cognito: {
          region: 'ap-southeast-2',
          userPoolId: 'pool',
          appClientId: 'client',
          issuer: 'issuer',
          scopes: ['openid', 'email', 'profile']
        },
        payments: {
          stripePublishableKey: 'pk_test_123',
          priceAudCents: 1999,
          currency: 'aud'
        }
      },
      expiresAtEpochMs: Date.now() + 60_000
    };

    localStorage.setItem('conveymate.metadata.configuration.v1', JSON.stringify(cached));

    await service.load();
    httpMock.expectNone('/metadataconfiguration');

    expect(service.value.apiBaseUrl).toBe('https://api.conveymate.test');
  });

  it('refreshes from API when cache is expired', async () => {
    const cached = {
      value: {
        environment: 'Development',
        apiBaseUrl: 'https://stale.conveymate.test',
        cacheTtlSeconds: 300,
        cognito: {
          region: 'ap-southeast-2',
          userPoolId: 'pool',
          appClientId: 'client',
          issuer: 'issuer',
          scopes: ['openid', 'email']
        },
        payments: {
          stripePublishableKey: 'pk_test_stale',
          priceAudCents: 1999,
          currency: 'aud'
        }
      },
      expiresAtEpochMs: Date.now() - 10_000
    };

    localStorage.setItem('conveymate.metadata.configuration.v1', JSON.stringify(cached));

    const getPromise = service.getValueAsync();
    const request = httpMock.expectOne('/metadataconfiguration');
    request.flush({
      environment: 'Development',
      apiBaseUrl: 'http://localhost:5141',
      cacheTtlSeconds: 120,
      cognito: {
        region: 'ap-southeast-2',
        userPoolId: 'pool',
        appClientId: 'client',
        issuer: 'issuer',
        scopes: ['openid', 'email']
      },
      payments: {
        stripePublishableKey: 'pk_test_123',
        priceAudCents: 1999,
        currency: 'aud'
      }
    });

    const value = await getPromise;
    expect(value.apiBaseUrl).toBe('http://localhost:5141');
  });

  it('uses stale configuration if refresh fails temporarily', async () => {
    const cached = {
      value: {
        environment: 'Development',
        apiBaseUrl: 'https://stale.conveymate.test',
        cacheTtlSeconds: 300,
        cognito: {
          region: 'ap-southeast-2',
          userPoolId: 'pool',
          appClientId: 'client',
          issuer: 'issuer',
          scopes: ['openid', 'email']
        },
        payments: {
          stripePublishableKey: 'pk_test_stale',
          priceAudCents: 1999,
          currency: 'aud'
        }
      },
      expiresAtEpochMs: Date.now() - 10_000
    };

    localStorage.setItem('conveymate.metadata.configuration.v1', JSON.stringify(cached));

    const getPromise = service.getValueAsync();
    const request = httpMock.expectOne('/metadataconfiguration');
    request.flush('offline', { status: 503, statusText: 'Service Unavailable' });

    const value = await getPromise;
    expect(value.apiBaseUrl).toBe('https://stale.conveymate.test');
  });
});
