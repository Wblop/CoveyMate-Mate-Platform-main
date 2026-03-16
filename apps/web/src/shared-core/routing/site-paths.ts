export const MARKETING_HOSTNAME = 'conveymate.com.au';
export const APP_HOSTNAME = 'app.conveymate.com.au';

export const AUTH_ROUTE_PATHS = ['/signin', '/signup', '/forgot-password', '/saml/login', '/saml/callback', '/google/callback'] as const;

export const APP_ONLY_ROUTE_PREFIXES = ['/dashboard', '/reports', '/new-report', '/quotes', '/conveyancers', '/docs', '/admin', '/account'] as const;

export function normalizePath(path: string | null | undefined): string {
  const candidate = (path ?? '').trim();
  if (!candidate) {
    return '/';
  }

  const [withoutQueryOrHash] = candidate.split(/[?#]/);
  if (!withoutQueryOrHash) {
    return '/';
  }

  const withLeadingSlash = withoutQueryOrHash.startsWith('/') ? withoutQueryOrHash : `/${withoutQueryOrHash}`;
  if (withLeadingSlash === '/') {
    return withLeadingSlash;
  }

  return withLeadingSlash.replace(/\/+$/, '');
}

export function isAuthRoutePath(path: string | null | undefined): boolean {
  const normalized = normalizePath(path);
  return AUTH_ROUTE_PATHS.includes(normalized as (typeof AUTH_ROUTE_PATHS)[number]);
}

export function isAppOnlyRoutePath(path: string | null | undefined): boolean {
  const normalized = normalizePath(path);
  return APP_ONLY_ROUTE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function isAllowedAppRedirectPath(path: string | null | undefined): boolean {
  const normalized = normalizePath(path);
  return isAppOnlyRoutePath(normalized);
}
