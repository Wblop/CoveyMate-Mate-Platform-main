import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { MetadataConfiguration } from '../config/metadata-configuration.models';
import { AddressAutocompleteService } from './address-autocomplete.service';

class MetadataConfigurationServiceStub {
  value: MetadataConfiguration = {
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
    },
    addressAutocomplete: {
      provider: 'nominatim-au'
    }
  };

  getValueAsync() {
    return Promise.resolve(this.value);
  }
}

describe('AddressAutocompleteService', () => {
  let service: AddressAutocompleteService;
  let httpMock: HttpTestingController;
  let metadataStub: MetadataConfigurationServiceStub;

  beforeEach(() => {
    metadataStub = new MetadataConfigurationServiceStub();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: MetadataConfigurationService,
          useValue: metadataStub
        }
      ]
    });

    service = TestBed.inject(AddressAutocompleteService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('uses Nominatim AU autocomplete by default and maps full addresses', async () => {
    const resultPromise = firstValueFrom(service.searchAustralianAddresses('13 McVilly Close Gordon', 'ACT'));
    await Promise.resolve();

    const request = httpMock.expectOne((req) => req.url === 'https://nominatim.openstreetmap.org/search');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('countrycodes')).toBe('au');
    expect(request.request.params.get('q')).toContain('ACT');

    request.flush([
      {
        place_id: 1001,
        address: {
          country_code: 'au',
          house_number: '13',
          road: 'McVilly Close',
          suburb: 'Gordon',
          state: 'Australian Capital Territory',
          postcode: '2906'
        }
      },
      {
        place_id: 1002,
        address: {
          country_code: 'au',
          house_number: '13',
          road: 'McVilly Close',
          suburb: 'Gordon',
          state: 'Australian Capital Territory',
          postcode: '2906'
        }
      },
      {
        place_id: 1003,
        address: {
          country_code: 'au',
          house_number: '15',
          road: 'McVilly Close',
          suburb: 'Gordon',
          state: 'Australian Capital Territory',
          postcode: '2906'
        }
      }
    ]);

    const suggestions = await resultPromise;
    expect(suggestions).toEqual([
      {
        id: '1001',
        label: '13 McVilly Close, Gordon, ACT 2906',
        stateOrTerritory: 'ACT'
      },
      {
        id: '1003',
        label: '15 McVilly Close, Gordon, ACT 2906',
        stateOrTerritory: 'ACT'
      }
    ]);
  });

  it('synthesizes house-number suggestions when Nominatim returns a road match only', async () => {
    const resultPromise = firstValueFrom(service.searchAustralianAddresses('13 McVilly Close Gordon ACT'));
    await Promise.resolve();

    const request = httpMock.expectOne((req) => req.url === 'https://nominatim.openstreetmap.org/search');
    request.flush([
      {
        place_id: 19839219,
        address: {
          country_code: 'au',
          road: 'McVilly Close',
          suburb: 'Gordon',
          state: 'Australian Capital Territory',
          postcode: '2906'
        }
      }
    ]);

    const suggestions = await resultPromise;
    expect(suggestions).toEqual([
      {
        id: '19839219',
        label: '13 McVilly Close, Gordon, ACT 2906',
        stateOrTerritory: 'ACT'
      }
    ]);
  });

  it('uses Photon directly when photon provider is configured', async () => {
    metadataStub.value = {
      ...metadataStub.value,
      addressAutocomplete: {
        provider: 'photon-au'
      }
    };

    const resultPromise = firstValueFrom(service.searchAustralianAddresses('13 McVilly Close Gordon ACT'));
    await Promise.resolve();

    const request = httpMock.expectOne((req) => req.url === 'https://photon.komoot.io/api/');
    request.flush({
      features: [
        {
          properties: {
            countrycode: 'AU',
            type: 'street',
            name: 'McVilly Close',
            district: 'Gordon',
            city: 'District of Tuggeranong',
            state: 'Australian Capital Territory',
            postcode: '2906'
          }
        }
      ]
    });

    const suggestions = await resultPromise;
    expect(suggestions[0]?.label).toBe('McVilly Close, Gordon, ACT 2906');
    expect(suggestions[0]?.stateOrTerritory).toBe('ACT');
  });

  it('returns an empty list without HTTP calls for short queries', async () => {
    const suggestions = await firstValueFrom(service.searchAustralianAddresses('a '));

    httpMock.expectNone('https://photon.komoot.io/api/');
    httpMock.expectNone('https://nominatim.openstreetmap.org/search');
    expect(suggestions).toEqual([]);
  });

  it('falls back to Photon when Nominatim returns no matches', async () => {
    const resultPromise = firstValueFrom(service.searchAustralianAddresses('12 Collins'));
    await Promise.resolve();

    const nominatimRequest = httpMock.expectOne((req) => req.url === 'https://nominatim.openstreetmap.org/search');
    nominatimRequest.flush([]);

    const photonRequest = httpMock.expectOne((req) => req.url === 'https://photon.komoot.io/api/');
    photonRequest.flush({
      features: [
        {
          properties: {
            countrycode: 'AU',
            housenumber: '12',
            street: 'Collins Street',
            suburb: 'Melbourne',
            state: 'Victoria',
            postcode: '3000'
          }
        }
      ]
    });

    const suggestions = await resultPromise;
    expect(suggestions).toEqual([
      {
        id: '12 collins street|melbourne|vic|3000',
        label: '12 Collins Street, Melbourne, VIC 3000',
        stateOrTerritory: 'VIC'
      }
    ]);
  });
});
