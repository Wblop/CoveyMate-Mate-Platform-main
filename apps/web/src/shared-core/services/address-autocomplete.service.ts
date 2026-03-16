import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { MetadataConfiguration } from '../config/metadata-configuration.models';

interface NominatimSearchResult {
  place_id?: number | string;
  display_name?: string;
  address?: NominatimAddress | null;
}

interface NominatimAddress {
  country_code?: string;
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  suburb?: string;
  town?: string;
  village?: string;
  city?: string;
  territory?: string;
  state?: string;
  postcode?: string;
}

interface PhotonSearchResponse {
  features: PhotonFeature[];
}

interface PhotonFeature {
  properties?: PhotonFeatureProperties | null;
}

interface PhotonFeatureProperties {
  type?: string;
  countrycode?: string;
  housenumber?: string;
  name?: string;
  street?: string;
  suburb?: string;
  city?: string;
  district?: string;
  locality?: string;
  state?: string;
  postcode?: string;
}

export interface AddressSuggestion {
  id: string;
  label: string;
  stateOrTerritory?: string;
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/';
const AUSTRALIA_BOUNDING_BOX = '112,-44,154,-10';
const MIN_QUERY_LENGTH = 3;
const NOMINATIM_MIN_QUERY_LENGTH = 6;
const MAX_SUGGESTIONS = 6;
const NOMINATIM_PROVIDER = 'nominatim-au';
const PHOTON_PROVIDER = 'photon-au';

@Injectable({
  providedIn: 'root'
})
export class AddressAutocompleteService {
  private readonly http = inject(HttpClient);
  private readonly metadata = inject(MetadataConfigurationService);
  private readonly stateCodeByName = new Map<string, string>([
    ['AUSTRALIAN CAPITAL TERRITORY', 'ACT'],
    ['NEW SOUTH WALES', 'NSW'],
    ['NORTHERN TERRITORY', 'NT'],
    ['QUEENSLAND', 'QLD'],
    ['SOUTH AUSTRALIA', 'SA'],
    ['TASMANIA', 'TAS'],
    ['VICTORIA', 'VIC'],
    ['WESTERN AUSTRALIA', 'WA']
  ]);
  private readonly supportedStateCodes = new Set(['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT']);

  searchAustralianAddresses(query: string, stateOrTerritory = ''): Observable<AddressSuggestion[]> {
    const normalizedQuery = (query || '').trim();
    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      return of([]);
    }

    return from(this.metadata.getValueAsync()).pipe(
      map((metadata) => this.resolveAddressAutocompleteProvider(metadata)),
      switchMap((provider) => {
        if (provider === PHOTON_PROVIDER) {
          return this.searchWithPhoton(normalizedQuery);
        }

        return this.searchWithNominatim(normalizedQuery, stateOrTerritory).pipe(
          switchMap((suggestions) => (suggestions.length > 0 ? of(suggestions) : this.searchWithPhoton(normalizedQuery))),
          catchError(() => this.searchWithPhoton(normalizedQuery))
        );
      }),
      catchError(() => of([]))
    );
  }

  private resolveAddressAutocompleteProvider(metadata: MetadataConfiguration): string {
    const config = metadata.addressAutocomplete;
    const provider = (config?.provider || NOMINATIM_PROVIDER).trim().toLowerCase();

    return provider || NOMINATIM_PROVIDER;
  }

  private searchWithNominatim(query: string, stateOrTerritory: string): Observable<AddressSuggestion[]> {
    const normalizedQuery = this.withSelectedState(query, stateOrTerritory);
    if (normalizedQuery.length < NOMINATIM_MIN_QUERY_LENGTH) {
      return of([]);
    }

    const params = new HttpParams()
      .set('q', normalizedQuery)
      .set('format', 'jsonv2')
      .set('addressdetails', '1')
      .set('countrycodes', 'au')
      .set('accept-language', 'en-AU,en')
      .set('dedupe', '1')
      .set('limit', String(MAX_SUGGESTIONS * 2));

    return this.http.get<NominatimSearchResult[]>(NOMINATIM_SEARCH_URL, { params }).pipe(
      map((results) => this.mapNominatimSuggestions(results ?? [], query))
    );
  }

  private mapNominatimSuggestions(results: ReadonlyArray<NominatimSearchResult>, query: string): AddressSuggestion[] {
    const suggestionsByLabel = new Map<string, AddressSuggestion>();
    const queryHouseNumber = this.extractQueryHouseNumber(query);
    const normalizedQuery = this.normalizeForMatching(query);

    for (const result of results) {
      const suggestion = this.toNominatimSuggestion(result, queryHouseNumber, normalizedQuery);
      if (!suggestion) {
        continue;
      }

      const key = suggestion.label.toLowerCase();
      if (suggestionsByLabel.has(key)) {
        continue;
      }

      suggestionsByLabel.set(key, suggestion);

      if (suggestionsByLabel.size > MAX_SUGGESTIONS) {
        break;
      }
    }

    return Array.from(suggestionsByLabel.values());
  }

  private toNominatimSuggestion(
    result: NominatimSearchResult,
    queryHouseNumber: string,
    normalizedQuery: string
  ): AddressSuggestion | null {
    const address = result.address;
    const countryCode = this.clean(address?.country_code).toUpperCase();
    if (countryCode && countryCode !== 'AU') {
      return null;
    }

    const streetName = this.firstNonEmpty(address?.road, address?.pedestrian, address?.footway, address?.path);
    const fallbackLabel = this.clean(result.display_name);
    if (!streetName && !fallbackLabel) {
      return null;
    }

    let houseNumber = this.clean(address?.house_number);
    if (queryHouseNumber && this.queryContainsStreet(normalizedQuery, streetName)) {
      if (!houseNumber || this.apiHouseNumberStrippedUnitPrefix(queryHouseNumber, houseNumber)) {
        houseNumber = queryHouseNumber;
      }
    }

    const streetLine = [houseNumber, streetName]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .trim();

    if (!streetLine) {
      if (!fallbackLabel) {
        return null;
      }

      const fallbackId = this.clean(String(result.place_id ?? '')) || fallbackLabel.toLowerCase();
      return {
        id: fallbackId,
        label: this.trimAustraliaSuffix(fallbackLabel),
        stateOrTerritory: this.toStateCode(this.firstNonEmpty(address?.territory, address?.state)) || undefined
      };
    }

    const suburb = this.firstNonEmpty(address?.suburb, address?.town, address?.village, address?.city);
    const stateCode = this.toStateCode(this.firstNonEmpty(address?.territory, address?.state));
    const postcode = this.clean(address?.postcode);
    const trailingParts = [suburb, [stateCode, postcode].filter((value) => value.length > 0).join(' ')]
      .filter((value) => value.length > 0);
    const label = trailingParts.length > 0 ? `${streetLine}, ${trailingParts.join(', ')}` : streetLine;
    const placeId = this.clean(String(result.place_id ?? ''));

    return {
      id: placeId || `${streetLine.toLowerCase()}|${suburb.toLowerCase()}|${stateCode.toLowerCase()}|${postcode}`,
      label,
      stateOrTerritory: stateCode || undefined
    };
  }

  private searchWithPhoton(query: string): Observable<AddressSuggestion[]> {
    const params = new HttpParams()
      .set('q', `${query} Australia`)
      .set('limit', String(MAX_SUGGESTIONS * 2))
      .set('lang', 'en')
      .set('bbox', AUSTRALIA_BOUNDING_BOX)
      .append('layer', 'house')
      .append('layer', 'street');

    return this.http.get<PhotonSearchResponse>(PHOTON_SEARCH_URL, { params }).pipe(
      map((response) => this.mapSuggestions(response.features ?? [], query)),
      catchError(() => of([]))
    );
  }

  private mapSuggestions(features: ReadonlyArray<PhotonFeature>, query: string): AddressSuggestion[] {
    const suggestionsByLabel = new Map<string, AddressSuggestion>();

    for (const feature of features) {
      const suggestion = this.toSuggestion(feature, query);
      if (!suggestion) {
        continue;
      }

      const key = suggestion.label.toLowerCase();
      if (!suggestionsByLabel.has(key)) {
        suggestionsByLabel.set(key, suggestion);
      }

      if (suggestionsByLabel.size >= MAX_SUGGESTIONS) {
        break;
      }
    }

    return Array.from(suggestionsByLabel.values());
  }

  private toSuggestion(feature: PhotonFeature, query: string): AddressSuggestion | null {
    const properties = feature.properties;
    if (!properties) {
      return null;
    }

    if ((properties.countrycode || '').toUpperCase() !== 'AU') {
      return null;
    }

    const streetName = this.resolveStreetName(properties);
    if (!streetName) {
      return null;
    }

    const queryHouseNumber = this.extractQueryHouseNumber(query);
    const normalizedQuery = this.normalizeForMatching(query);
    let housenumber = this.clean(properties.housenumber);
    if (queryHouseNumber && this.queryContainsStreet(normalizedQuery, streetName)) {
      if (!housenumber || this.apiHouseNumberStrippedUnitPrefix(queryHouseNumber, housenumber)) {
        housenumber = queryHouseNumber;
      }
    }

    const streetLine = [housenumber, streetName]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .trim();

    if (!streetLine) {
      return null;
    }

    const suburb = this.firstNonEmpty(properties.suburb, properties.locality, properties.district, properties.city);
    const stateCode = this.toStateCode(properties.state);
    const postcode = this.clean(properties.postcode);
    const trailingParts = [suburb, [stateCode, postcode].filter((value) => value.length > 0).join(' ')]
      .filter((value) => value.length > 0);
    const label = trailingParts.length > 0 ? `${streetLine}, ${trailingParts.join(', ')}` : streetLine;

    return {
      id: `${streetLine.toLowerCase()}|${suburb.toLowerCase()}|${stateCode.toLowerCase()}|${postcode}`,
      label,
      stateOrTerritory: stateCode || undefined
    };
  }

  private clean(value: string | undefined): string {
    return (value || '').trim();
  }

  private extractQueryHouseNumber(query: string): string {
    // Captures patterns like: 5, 5A, 5/12, 5A/12B (unit/street-number formats)
    const match = query.trim().match(/^(\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?)\b/);
    return this.clean(match?.[1]);
  }

  private apiHouseNumberStrippedUnitPrefix(queryHouseNumber: string, apiHouseNumber: string): boolean {
    // Detects when the query had "5/12" but the API only returned "12" (dropped the unit prefix)
    const slashIdx = queryHouseNumber.indexOf('/');
    if (slashIdx === -1) {
      return false;
    }
    return queryHouseNumber.slice(slashIdx + 1).toLowerCase() === apiHouseNumber.toLowerCase();
  }

  private normalizeForMatching(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private queryContainsStreet(normalizedQuery: string, street: string): boolean {
    const normalizedStreet = this.normalizeForMatching(street);
    if (!normalizedStreet) {
      return false;
    }

    return normalizedQuery.includes(normalizedStreet);
  }

  private trimAustraliaSuffix(label: string): string {
    return label.replace(/,\s*Australia$/i, '');
  }

  private firstNonEmpty(...values: Array<string | undefined>): string {
    for (const value of values) {
      const cleaned = this.clean(value);
      if (cleaned) {
        return cleaned;
      }
    }

    return '';
  }

  private toStateCode(rawState: string | undefined): string {
    const cleaned = this.clean(rawState);
    if (!cleaned) {
      return '';
    }

    const uppercase = cleaned.toUpperCase();
    if (uppercase.length <= 3) {
      return uppercase;
    }

    return this.stateCodeByName.get(uppercase) ?? cleaned;
  }

  private withSelectedState(query: string, stateOrTerritory: string): string {
    const normalizedState = stateOrTerritory.trim().toUpperCase();
    if (!this.supportedStateCodes.has(normalizedState)) {
      return query;
    }

    const paddedQuery = ` ${query.toUpperCase()} `;
    if (paddedQuery.includes(` ${normalizedState} `)) {
      return query;
    }

    return `${query} ${normalizedState}`;
  }

  private resolveStreetName(properties: PhotonFeatureProperties): string {
    const directStreet = this.clean(properties.street);
    if (directStreet) {
      return directStreet;
    }

    const featureType = this.clean(properties.type).toLowerCase();
    if (featureType === 'street') {
      return this.clean(properties.name);
    }

    return '';
  }
}
