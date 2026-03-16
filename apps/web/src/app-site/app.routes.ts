import { Route, Routes } from '@angular/router';

import { authGuard } from '@shared-core/auth/auth.guard';

function retiredFeatureRoute(path: string, title: string, description: string, primaryLink = '/reports'): Route {
  return {
    path,
    loadComponent: () =>
      import('@shared-core/routing/retired-feature-page.component').then((module) => module.RetiredFeaturePageComponent),
    data: {
      eyebrow: 'Feature retired',
      title,
      description,
      detail: 'Existing reports and the conveyancer directory are still available.',
      primaryLabel: primaryLink === '/conveyancers' ? 'Browse conveyancers' : 'Open reports',
      primaryLink,
      secondaryLabel: primaryLink === '/conveyancers' ? 'Open dashboard' : 'Browse conveyancers',
      secondaryLink: primaryLink === '/conveyancers' ? '/dashboard' : '/conveyancers'
    }
  };
}

function redirectToMarketing(path: string): Route {
  return {
    path,
    loadComponent: () =>
      import('@shared-core/routing/host-redirect-page.component').then((module) => module.HostRedirectPageComponent),
    data: { redirectHost: 'marketing' }
  };
}

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('@shared-core/routing/host-redirect-page.component').then((module) => module.HostRedirectPageComponent),
    data: { redirectHost: 'marketing' }
  },
  {
    path: 'create-report',
    pathMatch: 'full',
    redirectTo: 'new-report'
  },
  redirectToMarketing('guides'),
  redirectToMarketing('guides/:page'),
  redirectToMarketing('calculators'),
  redirectToMarketing('calculators/:calculator'),
  redirectToMarketing('insights'),
  redirectToMarketing('insights/:slug'),
  redirectToMarketing('legal/privacy'),
  redirectToMarketing('legal/terms'),
  redirectToMarketing('legal/disclaimer'),
  redirectToMarketing('legal/accessibility'),
  {
    path: 'signin',
    loadComponent: () => import('@app-site/layout/auth-shell/auth-shell.component').then((module) => module.AuthShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@app-site/features/auth/pages/sign-in-page/sign-in-page.component').then((module) => module.SignInPageComponent)
      }
    ]
  },
  {
    path: 'signup',
    loadComponent: () => import('@app-site/layout/auth-shell/auth-shell.component').then((module) => module.AuthShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@app-site/features/auth/pages/sign-up-page/sign-up-page.component').then((module) => module.SignUpPageComponent)
      }
    ]
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('@app-site/layout/auth-shell/auth-shell.component').then((module) => module.AuthShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@app-site/features/auth/pages/forgot-password-page/forgot-password-page.component').then(
            (module) => module.ForgotPasswordPageComponent
          )
      }
    ]
  },
  {
    path: 'saml/login',
    loadComponent: () => import('@app-site/layout/auth-shell/auth-shell.component').then((module) => module.AuthShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@app-site/features/auth/pages/saml-stub-sign-in-page/saml-stub-sign-in-page.component').then(
            (module) => module.SamlStubSignInPageComponent
          )
      }
    ]
  },
  {
    path: 'saml/callback',
    loadComponent: () => import('@app-site/layout/auth-shell/auth-shell.component').then((module) => module.AuthShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@app-site/features/auth/pages/saml-auth-callback-page/saml-auth-callback-page.component').then(
            (module) => module.SamlAuthCallbackPageComponent
          )
      }
    ]
  },
  {
    path: 'google/callback',
    loadComponent: () => import('@app-site/layout/auth-shell/auth-shell.component').then((module) => module.AuthShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@app-site/features/auth/pages/google-auth-callback-page/google-auth-callback-page.component').then(
            (module) => module.GoogleAuthCallbackPageComponent
          )
      }
    ]
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('@app-site/layout/app-shell/app-shell.component').then((module) => module.AppShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('@app-site/features/app/pages/dashboard-page/dashboard-page.component').then(
            (module) => module.DashboardPageComponent
          )
      },
      {
        path: 'report',
        loadComponent: () =>
          import('@app-site/features/app/pages/reports-list-page/reports-list-page.component').then(
            (module) => module.ReportsListPageComponent
          )
      },
      {
        path: 'reports/:id',
        loadComponent: () =>
          import('@app-site/features/app/pages/report-detail-page/report-detail-page.component').then(
            (module) => module.ReportDetailPageComponent
          )
      },
      retiredFeatureRoute(
        'reports/:id/request-quotes',
        'Quote requests have been retired',
        'ConveyMate no longer sends or manages conveyancer quote workflows from reports.',
        '/conveyancers'
      ),
      retiredFeatureRoute(
        'new-report',
        'New report creation has been retired',
        'The report generation workflow is no longer accepting new submissions.'
      ),
      retiredFeatureRoute(
        'quotes',
        'Quote workflows have been retired',
        'Quote tracking is no longer available in the workspace.',
        '/conveyancers'
      ),
      retiredFeatureRoute(
        'quotes/:id',
        'Quote workflows have been retired',
        'This quote workflow is no longer available.',
        '/conveyancers'
      ),
      {
        path: 'conveyancers',
        loadComponent: () =>
          import('@app-site/features/app/pages/conveyancers-page/conveyancers-page.component').then(
            (module) => module.ConveyancersPageComponent
          )
      },
      {
        path: 'docs',
        loadComponent: () =>
          import('@app-site/features/app/pages/docs-page/docs-page.component').then((module) => module.DocsPageComponent)
      },
      {
        path: 'docs/:page',
        loadComponent: () =>
          import('@app-site/features/app/pages/docs-page/docs-page.component').then((module) => module.DocsPageComponent)
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('@app-site/features/app/pages/admin-console-page/admin-console-page.component').then(
            (module) => module.AdminConsolePageComponent
          )
      },
      {
        path: 'admin/seo-engine',
        loadComponent: () =>
          import('@app-site/features/app/pages/admin-seo-engine-page/admin-seo-engine-page.component').then(
            (module) => module.AdminSeoEnginePageComponent
          )
      },
      {
        path: 'account',
        loadComponent: () =>
          import('@app-site/features/app/pages/account-page/account-page.component').then((module) => module.AccountPageComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: '/reports'
  }
];
