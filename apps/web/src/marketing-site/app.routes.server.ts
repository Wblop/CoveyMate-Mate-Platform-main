import { RenderMode, ServerRoute } from '@angular/ssr';

const staticGuideParams = [
  { page: 'account-access' },
  { page: 'ai-review-pipeline' },
  { page: 'getting-started' },
  { page: 'payments' },
  { page: 'report-results' },
  { page: 'troubleshooting' }
] as const;

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'create-report',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'guides',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'guides/:page',
    renderMode: RenderMode.Prerender,
    async getPrerenderParams() {
      return dedupeGuideParams(staticGuideParams);
    }
  },
  {
    path: 'calculators',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'insights',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'legal/privacy',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'legal/terms',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'legal/disclaimer',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'legal/accessibility',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'insights/:slug',
    renderMode: RenderMode.Client
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];

function dedupeGuideParams(values: ReadonlyArray<{ page: string }>): { page: string }[] {
  return Array.from(new Map(values.map((value) => [value.page, value])).values());
}
