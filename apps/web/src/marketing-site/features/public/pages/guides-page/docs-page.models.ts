export interface DocsSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface DocsGuidePage {
  slug: string;
  navLabel: string;
  title: string;
  description: string;
  lastUpdated: string;
  sections: DocsSection[];
  isIndexPage?: boolean;
}
