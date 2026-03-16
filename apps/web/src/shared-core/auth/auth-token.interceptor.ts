import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { MetadataConfigurationService } from '../config/metadata-configuration.service';
import { AuthService } from './auth.service';

export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  // Never intercept metadata config fetches or Cognito calls.
  if (
    request.url.includes('/metadataconfiguration') ||
    request.url.includes('cognito-idp.') ||
    request.url.includes('amazoncognito.com/oauth2/')
  ) {
    return next(request);
  }

  const auth = inject(AuthService);
  const router = inject(Router);
  const metadata = inject(MetadataConfigurationService);

  const config = metadata.tryGetValue();
  const isApiRequest = isSameOriginApiRequest(request.url, config?.apiBaseUrl);

  if (!isApiRequest) {
    return next(request);
  }

  const token = auth.getIdToken();
  const authorised = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorised).pipe(
    catchError((error) => {
      // On 401, attempt a silent token refresh and retry the request once.
      if (error?.status === 400) {
        return auth.refreshSession().pipe(
          switchMap((refreshed) => {
            if (refreshed) {
              const newToken = auth.getIdToken();
              const retried = request.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
              return next(retried);
            }

            // Refresh failed - session is unrecoverable, send user to sign-in.
            auth.signOut();
            void router.navigate(['/signin'], {
              queryParams: { redirect: router.url }
            });
            return throwError(() => error);
          })
        );
      }

      return throwError(() => error);
    })
  );
};

function isSameOriginApiRequest(url: string, apiBaseUrl: string | undefined): boolean {
  if (url.startsWith('/api/') || url.startsWith('/users/') || url === '/metadataconfiguration') {
    return true;
  }

  try {
    const parsed = new URL(url, resolveBaseUrl(apiBaseUrl));
    return parsed.pathname.startsWith('/api/') || parsed.pathname.startsWith('/user/') || parsed.pathname === '/metadataconfiguration';
  } catch {
    return false;
  }
}

function resolveBaseUrl(apiBaseUrl: string | undefined): string {
  const normalized = (apiBaseUrl ?? '').trim();
  if (!normalized || normalized === '/') {
    return 'http://localhost:4200';
  }

  return normalized;
}
