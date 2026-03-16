import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  const metadataStub = {
    getValueAsync: async () => ({
      environment: 'Development',
      apiBaseUrl: 'https://api.conveymate.test',
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
    })
  } as Pick<MetadataConfigurationService, 'getValueAsync'>;

  const authStub = {
    isAuthenticatedSnapshot: () => true
  } as Pick<AuthService, 'isAuthenticatedSnapshot'>;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        { provide: MetadataConfigurationService, useValue: metadataStub },
        { provide: AuthService, useValue: authStub }
      ]
    });

    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('fetches user info from API and caches it', async () => {
    const firstLoad = firstValueFrom(service.loadUserInfo());
    await Promise.resolve();

    const request = httpMock.expectOne('https://api.conveymate.test/user/userinfo');
    request.flush({
      id: '1',
      fullName: 'Casey Buyer',
      email: 'buyer@conveymate.test',
      createdAt: '2026-02-23T00:00:00Z'
    });

    const firstUser = await firstLoad;
    expect(firstUser.email).toBe('buyer@conveymate.test');

    const secondUser = await firstValueFrom(service.loadUserInfo());

    httpMock.expectNone('https://api.conveymate.test/user/userinfo');
    expect(secondUser.email).toBe('buyer@conveymate.test');
  });

  it('throws when user is not authenticated', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        { provide: MetadataConfigurationService, useValue: metadataStub },
        { provide: AuthService, useValue: { isAuthenticatedSnapshot: () => false } }
      ]
    });

    const unauthenticatedService = TestBed.inject(UserService);

    expect(() => unauthenticatedService.loadUserInfo()).toThrowError('User is not authenticated.');
  });
});
