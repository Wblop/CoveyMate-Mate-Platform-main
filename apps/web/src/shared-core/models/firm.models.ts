export interface FirmRecord {
  [key: string]: unknown;
}

export interface FirmView {
  name: string;
  practitionerName: string;
  suburb: string;
  practisingStatus: string;
  address: string;
  phone: string;
  email: string;
  websiteLabel: string;
  websiteUrl: string | null;
  practiceAreas: string[];
  practiceAreaCount: number;
  costDisplay: string | null;
}

export interface FirmStats {
  totalFirms: number;
  withPublishedCosts: number;
  hiddenCosts: number;
  transparencyRate: number;
  distinctPracticeAreas: number;
  averageCoverage: number;
}

export type SortOption = 'practice-high' | 'practice-low' | 'alpha';
