export type JurisdictionCode = 'ACT' | 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'NT';

export interface ConveyancerDirectoryItem {
  jurisdiction: JurisdictionCode;
  regulatorType: string;
  name: string;
  contactName: string | null;
  organizationName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  areasOfPractice: string[];
  sourceUrl: string;
  sourceIdentifier: string;
  quoteRequestsEnabled: boolean;
  lastSeenUtc: string;
}

export interface ConveyancerDirectorySearchParams {
  jurisdiction: JurisdictionCode;
  query?: string | null;
  regulatorType?: string | null;
  page: number;
  pageSize: number;
}

export interface ConveyancerDirectoryPage {
  items: ConveyancerDirectoryItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  regulatorTypes: string[];
}
