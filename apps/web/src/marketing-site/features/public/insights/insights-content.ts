import {
  GENERATED_INSIGHTS_MANIFEST,
  type GeneratedInsightArticle,
  type GeneratedInsightsManifest,
  type GeneratedInsightSection,
  type GeneratedInsightSource,
  type GeneratedTrendingKeywordMetric
} from '@marketing-site/generated/insights.generated';

export interface MarketingInsightArticle extends GeneratedInsightArticle {
  sources: MarketingInsightSource[];
  canonicalPath: string;
  publishedLabel: string;
  updatedLabel: string;
  readingMinutes: number;
}

export interface MarketingInsightSource extends GeneratedInsightSource {
  publishedLabel: string | null;
}

export interface MarketingTrendingKeyword extends GeneratedTrendingKeywordMetric {
  slug: string;
}

export interface MarketingInsightsCatalog {
  articles: ReadonlyArray<MarketingInsightArticle>;
  trendingKeywords: ReadonlyArray<MarketingTrendingKeyword>;
}

const initialCatalog = buildMarketingInsightsCatalog(GENERATED_INSIGHTS_MANIFEST);

export const INITIAL_PUBLISHED_INSIGHTS: ReadonlyArray<MarketingInsightArticle> = initialCatalog.articles;

export const INITIAL_TRENDING_INSIGHT_KEYWORDS: ReadonlyArray<MarketingTrendingKeyword> = initialCatalog.trendingKeywords;

export function buildMarketingInsightsCatalog(manifest: GeneratedInsightsManifest | null | undefined): MarketingInsightsCatalog {
  const articles = Array.isArray(manifest?.articles)
    ? [...manifest.articles]
        .map((article) => normalizeArticle(article))
        .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    : [];
  const trendingKeywords = Array.isArray(manifest?.trendingKeywords)
    ? manifest.trendingKeywords.map((item) => ({
        ...item,
        slug: slugify(item.keyword)
      }))
    : [];

  return {
    articles,
    trendingKeywords
  };
}

export function getPublishedInsightBySlug(
  slug: string | null | undefined,
  articles: ReadonlyArray<MarketingInsightArticle> = INITIAL_PUBLISHED_INSIGHTS): MarketingInsightArticle | null {
  const normalizedSlug = (slug ?? '').trim().toLowerCase();
  return articles.find((article) => article.slug === normalizedSlug) ?? null;
}

export function matchesInsightQuery(article: MarketingInsightArticle, query: string, keyword: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (normalizedKeyword) {
    const keywords = [...article.keywords, ...article.tags].map((value) => value.toLowerCase());
    if (!keywords.includes(normalizedKeyword)) {
      return false;
    }
  }

  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    article.title,
    article.excerpt,
    article.metaDescription,
    ...article.tags,
    ...article.keywords,
    ...article.sections.flatMap((section) => [section.heading, ...section.paragraphs, ...section.bullets])
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function normalizeArticle(article: GeneratedInsightArticle): MarketingInsightArticle {
  const canonicalPath = `/insights/${article.slug}`;
  const readingMinutes = Math.max(1, Math.round(stripHtml(article.bodyHtml).split(/\s+/).filter(Boolean).length / 190));

  return {
    ...article,
    sections: normalizeSections(article.sections),
    sources: normalizeSources(article.sources),
    canonicalPath,
    publishedLabel: formatDate(article.publishedAt),
    updatedLabel: formatDate(article.updatedAt),
    readingMinutes
  };
}

function normalizeSections(sections: GeneratedInsightSection[]): GeneratedInsightSection[] {
  return [...sections].sort((left, right) => left.position - right.position);
}

function normalizeSources(sources: GeneratedInsightSource[]): MarketingInsightSource[] {
  return [...sources]
    .sort((left, right) => left.position - right.position)
    .map((source) => ({
      ...source,
      publishedLabel: source.publishedAt ? formatDate(source.publishedAt) : null
    }));
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '11 Mar 2026';
  }

  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsed);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
