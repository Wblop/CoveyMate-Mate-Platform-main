import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';

import { FirmRecord, FirmView } from '../models/firm.models';

@Injectable({
  providedIn: 'root'
})
export class FirmDataService {
  private readonly currencyFormatter = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  });

  constructor(private readonly http: HttpClient) {}

  getFirms() {
    return this.http.get<FirmRecord[]>('/data/act_law_firms.json').pipe(
      map((records) =>
        records
          .map((record) => this.toFirmView(record))
          .filter((firm) => firm.name !== '')
          .filter((firm) => this.isConveyancingFirm(firm))
      )
    );
  }

  private toFirmView(record: FirmRecord): FirmView {
    const areas = this.toStringArray(record['areas_of_practice'])
      .map((value) => this.cleanText(value))
      .filter((value): value is string => value.length > 0);

    const practiceAreaCount = this.toNumber(record['areas_of_practice_count']) ?? areas.length;
    const websiteLabel = this.cleanText(this.toString(record['web']) ?? '');
    const address = this.cleanText(this.toString(record['address']) ?? '');
    const email = this.cleanText(this.toString(record['email']) ?? '');
    const name = this.cleanText(this.toString(record['name']) ?? '');

    return {
      name,
      practitionerName: this.resolvePractitionerName(record, email),
      suburb: this.extractSuburb(address),
      practisingStatus: 'Check current status on the ACT register',
      address,
      phone: this.cleanText(this.toString(record['phone']) ?? ''),
      email,
      websiteLabel,
      websiteUrl: this.normalizeWebsite(websiteLabel),
      practiceAreas: areas,
      practiceAreaCount,
      costDisplay: this.extractCost(record)
    };
  }

  private isConveyancingFirm(firm: FirmView): boolean {
    const haystack = [firm.name, ...firm.practiceAreas].join(' ').toLowerCase();
    return haystack.includes('conveyancing');
  }

  private resolvePractitionerName(record: FirmRecord, email: string): string {
    const candidateKeys = ['practitioner_name', 'practitioner', 'principal', 'solicitor', 'contact_name'];

    for (const key of candidateKeys) {
      const value = this.cleanText(this.toString(record[key]) ?? '');
      if (value) {
        return value;
      }
    }

    const localPart = email.split('@')[0]?.trim().toLowerCase() ?? '';
    const blockedValues = new Set([
      '',
      'admin',
      'accounts',
      'contact',
      'enquiries',
      'enquiry',
      'hello',
      'info',
      'office',
      'reception',
      'team'
    ]);

    if (blockedValues.has(localPart)) {
      return 'Not listed';
    }

    if (localPart) {
      return this.toTitleCase(localPart.replace(/[._-]+/g, ''));
    }

    return 'Not listed';
  }

  private extractSuburb(address: string): string {
    if (!address) {
      return 'Not listed';
    }

    const commaActMatch = address.match(/([A-Za-z][A-Za-z\s'-]+),\s*ACT\b/i);
    if (commaActMatch?.[1]) {
      return this.toTitleCase(commaActMatch[1]);
    }

    const upperActMatch = address.match(/([A-Z][A-Z\s'-]{2,})\s+ACT\b/);
    if (upperActMatch?.[1]) {
      return this.toTitleCase(upperActMatch[1]);
    }

    return 'Not listed';
  }

  private extractCost(record: FirmRecord): string | null {
    const keys = [
      'cost',
      'costs',
      'fee',
      'fees',
      'price',
      'prices',
      'hourly_rate',
      'hourlyRate',
      'consultation_fee',
      'consultationFee'
    ];

    for (const key of keys) {
      const normalized = this.formatCostValue(record[key]);
      if (normalized !== null) {
        return normalized;
      }
    }

    return null;
  }

  private formatCostValue(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return this.currencyFormatter.format(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const numericCandidate = trimmed.replace(/[A-Za-z$\s,]/g, '');
      const isNumeric = /^\d+(\.\d+)?$/.test(numericCandidate);

      if (isNumeric) {
        return this.currencyFormatter.format(Number(numericCandidate));
      }

      return trimmed;
    }

    return null;
  }

  private normalizeWebsite(value: string): string | null {
    if (!value) {
      return null;
    }

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    return `https://${value}`;
  }

  private toString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private toNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }

    if (typeof value === 'string') {
      return value
        .split(';')
        .map((item) => item.trim())
        .filter((item): item is string => item.length > 0);
    }

    return [];
  }

  private cleanText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private toTitleCase(value: string): string {
    return value
      .toLowerCase()
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
