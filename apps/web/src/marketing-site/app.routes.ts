import { Route, Routes } from '@angular/router';

function retiredFeatureRoute(path: string, title: string, description: string): Route {
  return {
    path,
    loadComponent: () =>
      import('@shared-core/routing/retired-feature-page.component').then((module) => module.RetiredFeaturePageComponent),
    data: {
      eyebrow: 'Feature retired',
      title,
      description,
      detail: 'ConveyMate no longer runs this workflow. You can still browse guides and the conveyancer directory.',
      primaryLabel: 'Browse conveyancers',
      primaryLink: '/conveyancers',
      secondaryLabel: 'Read guides',
      secondaryLink: '/guides'
    }
  };
}

function redirectToApp(path: string, redirectPath?: string): Route {
  return {
    path,
    loadComponent: () =>
      import('@shared-core/routing/host-redirect-page.component').then((module) => module.HostRedirectPageComponent),
    data: { redirectHost: 'app', redirectPath }
  };
}

function legalRoute(path: string, title: string, subtitle: string, paragraphs: string[]): Route {
  return {
    path,
    loadComponent: () =>
      import('@marketing-site/features/legal/pages/legal-page/legal-page.component').then((module) => module.LegalPageComponent),
    data: {
      title,
      subtitle,
      paragraphs
    }
  };
}

export const routes: Routes = [
  redirectToApp('signin'),
  redirectToApp('signup'),
  redirectToApp('forgot-password'),
  redirectToApp('google/callback'),
  redirectToApp('dashboard'),
  redirectToApp('reports'),
  redirectToApp('reports/:id'),
  redirectToApp('reports/:id/request-quotes'),
  redirectToApp('new-report'),
  redirectToApp('quotes'),
  redirectToApp('quotes/:id'),
  redirectToApp('conveyancers'),
  redirectToApp('docs'),
  redirectToApp('docs/:page'),
  redirectToApp('admin/seo-engine'),
  redirectToApp('admin'),
  redirectToApp('account'),
  {
    path: '',
    loadComponent: () =>
      import('@marketing-site/layout/public-shell/public-shell.component').then((module) => module.PublicShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@marketing-site/features/public/pages/landing-page/landing-page.component').then(
            (module) => module.LandingPageComponent
          )
      },
      {
        path: 'landing',
        pathMatch: 'full',
        redirectTo: ''
      },
      redirectToApp('create-report', '/new-report'),
      {
        path: 'guides',
        loadComponent: () =>
          import('@marketing-site/features/public/pages/guides-page/docs-page.component').then((module) => module.DocsPageComponent)
      },
      {
        path: 'guides/:page',
        loadComponent: () =>
          import('@marketing-site/features/public/pages/guides-page/docs-page.component').then((module) => module.DocsPageComponent)
      },
      {
        path: 'calculators',
        loadComponent: () =>
          import('@marketing-site/features/public/pages/calculators-page/calculators-page.component').then(
            (module) => module.CalculatorsPageComponent
          )
      },
      {
        path: 'calculators/:calculator',
        loadComponent: () =>
          import('@marketing-site/features/public/pages/calculators-page/calculators-page.component').then(
            (module) => module.CalculatorsPageComponent
          )
      },
      {
        path: 'insights',
        loadComponent: () =>
          import('@marketing-site/features/public/pages/insights-index-page/insights-index-page.component').then(
            (module) => module.InsightsIndexPageComponent
          )
      },
      {
        path: 'insights/:slug',
        loadComponent: () =>
          import('@marketing-site/features/public/pages/insight-article-page/insight-article-page.component').then(
            (module) => module.InsightArticlePageComponent
          )
      },
      retiredFeatureRoute(
        'quote/respond/:token',
        'Quote response links have been retired',
        'This quote response link is no longer active.'
      ),
      retiredFeatureRoute(
        'quote/unsubscribe/:token',
        'Quote email management has been retired',
        'ConveyMate no longer sends quote workflow emails.'
      ),
      legalRoute('legal/privacy', 'Privacy', 'How ConveyMate handles personal information.', [
        'ConveyMate stores account and report data only for service operation and user access.',
        'Uploaded documents and report metadata are handled according to platform retention settings.',
        'Contact support if you need assistance with privacy-related requests.'
      ]),
      legalRoute('legal/terms', 'Terms of use', 'Service terms, refund policy, and Australian Consumer Law notices.', [
        'These terms apply when you access ConveyMate, create an account, upload documents, purchase a report, or otherwise use the website and related services.',
        'ConveyMate provides structured contract information to support legal review preparation. It is not a legal practice and does not provide legal advice.',
        'Before exchange, settlement, waiver, rescission, contractual variation, or any other binding step, obtain independent advice from a qualified Australian solicitor or conveyancer.'
      ]),
      legalRoute('legal/disclaimer', 'Disclaimer', 'Important limitations of the ConveyMate service.', [
        'ConveyMate provides structured contract information to help you prepare for professional legal advice. It does not provide legal advice and is not a substitute for a solicitor or conveyancer.',
        'Always verify report findings, clause references, and any transaction decisions with a qualified Australian legal professional before exchange or settlement.',
        'Platform outputs depend on the documents provided, extraction quality, and current workflow behaviour. Review all findings carefully.'
      ]),
      legalRoute('legal/accessibility', 'Accessibility', 'Accessibility standards and support contact details.', [
        'ConveyMate aims to provide an accessible experience across the public website and authenticated workspace.',
        'If you encounter an accessibility barrier, contact support with the page URL, browser, and device details so we can investigate promptly.'
      ])
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
