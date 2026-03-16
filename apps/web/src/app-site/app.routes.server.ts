import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'signin',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'signup',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'forgot-password',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'dashboard',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'reports',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'new-report',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'quotes',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'conveyancers',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'docs',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'admin',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'account',
    renderMode: RenderMode.Prerender
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
