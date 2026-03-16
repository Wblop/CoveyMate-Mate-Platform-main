import { BehaviorSubject, Observable, of } from 'rxjs';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';

import { AppSiteComponent } from '@app-site/app-site.component';
import { AccountPageComponent } from '@app-site/features/app/pages/account-page/account-page.component';
import { ConveyancersPageComponent } from '@app-site/features/app/pages/conveyancers-page/conveyancers-page.component';
import { DashboardPageComponent } from '@app-site/features/app/pages/dashboard-page/dashboard-page.component';
import { DocsPageComponent } from '@app-site/features/app/pages/docs-page/docs-page.component';
import { ReportDetailPageComponent } from '@app-site/features/app/pages/report-detail-page/report-detail-page.component';
import { ReportsListPageComponent } from '@app-site/features/app/pages/reports-list-page/reports-list-page.component';
import { AppShellComponent } from '@app-site/layout/app-shell/app-shell.component';
import { AuthService } from '@shared-core/auth/auth.service';
import { MetadataConfiguration } from '@shared-core/config/metadata-configuration.models';
import { MetadataConfigurationService } from '@shared-core/config/metadata-configuration.service';
import { RetiredFeaturePageComponent } from '@shared-core/routing/retired-feature-page.component';
import { ConveyancerDirectoryService } from '@shared-core/services/conveyancer-directory.service';
import { EnabledStatesConfiguration, ReportService } from '@shared-core/services/report.service';
import { SiteNotificationService } from '@shared-core/services/site-notification.service';
import { UploadService } from '@shared-core/services/upload.service';
import { UserService } from '@shared-core/services/user.service';

class AuthServiceStub {
  readonly isAuthenticated$ = of(true);

  isAuthenticatedSnapshot() {
    return true;
  }

  signOut() {
    return;
  }
}

class UserServiceStub {
  private readonly userSubject = new BehaviorSubject({
    id: 'user-1',
    fullName: 'Casey Buyer',
    email: 'buyer@conveymate.test',
    createdAt: '2026-01-01T00:00:00Z'
  });

  readonly user$ = this.userSubject.asObservable();

  loadUserInfo() {
    return of(this.userSubject.value);
  }

  clearCache() {
    return;
  }
}

class ReportServiceStub {
  getReports() {
    return of([]);
  }

  getPipelineModel() {
    return of({
      steps: [],
      typicalDurationMinutes: 7,
      disclaimerVersion: 'test-disclaimer-v1'
    });
  }

  getEnabledStatesConfiguration(): Observable<EnabledStatesConfiguration> {
    return of({
      defaultState: 'ACT',
      supportedStates: ['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT'],
      enabledStates: ['ACT']
    });
  }
}

class UploadServiceStub {
  getUploads() {
    return of([]);
  }

  getQueuedFilesSnapshot() {
    return [];
  }

  clearAll() {
    return;
  }
}

class MetadataConfigurationServiceStub {
  private readonly value: MetadataConfiguration = {
    environment: 'local',
    apiBaseUrl: 'http://localhost:5141',
    cacheTtlSeconds: 300,
    cognito: {
      region: 'ap-southeast-2',
      userPoolId: 'pool',
      appClientId: 'client',
      issuer: 'issuer',
      scopes: ['openid']
    },
    payments: {
      stripePublishableKey: 'pk_test_stub',
      priceAudCents: 1999,
      currency: 'aud'
    }
  };

  tryGetValue() {
    return this.value;
  }

  getValueAsync() {
    return Promise.resolve(this.value);
  }
}

class ConveyancerDirectoryServiceStub {
  search() {
    return of({
      items: [],
      page: 1,
      pageSize: 24,
      totalCount: 0,
      totalPages: 1,
      regulatorTypes: []
    });
  }

  listByJurisdiction() {
    return of([]);
  }
}

class SiteNotificationServiceStub {
  watchActiveNotifications() {
    return of([]);
  }
}

const routes: Routes = [
  {
    path: '',
    component: AppShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: DashboardPageComponent },
      { path: 'reports', component: ReportsListPageComponent },
      { path: 'reports/:id', component: ReportDetailPageComponent },
      { path: 'new-report', component: RetiredFeaturePageComponent },
      { path: 'conveyancers', component: ConveyancersPageComponent },
      { path: 'docs', component: DocsPageComponent },
      { path: 'account', component: AccountPageComponent }
    ]
  },
  { path: '**', redirectTo: '/dashboard' }
];

describe('AppShellComponent integration', () => {
  let fixture: ComponentFixture<AppSiteComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppSiteComponent],
      providers: [
        provideRouter(routes),
        { provide: AuthService, useClass: AuthServiceStub },
        { provide: UserService, useClass: UserServiceStub },
        { provide: ReportService, useClass: ReportServiceStub },
        { provide: ConveyancerDirectoryService, useClass: ConveyancerDirectoryServiceStub },
        { provide: SiteNotificationService, useClass: SiteNotificationServiceStub },
        { provide: UploadService, useClass: UploadServiceStub },
        { provide: MetadataConfigurationService, useClass: MetadataConfigurationServiceStub }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(AppSiteComponent);
  });

  it('renders authenticated shell with header, sidebar and footer', async () => {
    await navigateTo('/new-report', fixture, router);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="dashboard-shell-header"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="dashboard-shell-sidebar"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="dashboard-shell-footer"]')).toBeTruthy();
  });

  it('navigates via sidebar and renders retired workflow messaging within shell', async () => {
    await navigateTo('/new-report', fixture, router);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('This workflow is no longer available');
    expect(linkByLabel(host, 'Reports')).toBeTruthy();
    expect(linkByLabel(host, 'Calculators')).toBeTruthy();
    expect(linkByLabel(host, 'Conveyancers')).toBeTruthy();
    expect(linkByLabel(host, 'Guides')).toBeTruthy();
    expect(linkByLabel(host, 'Dashboard')).toBeTruthy();
    expect(linkByLabel(host, 'Create new report')).toBeNull();
    expect(linkByLabel(host, 'Quotes')).toBeNull();

    await navigateTo('/reports', fixture, router);
    expect(host.textContent).toContain('No reports available');
    expect(linkByLabel(host, 'Reports')?.classList.contains('is-active')).toBeTrue();

    await navigateTo('/conveyancers', fixture, router);
    expect(host.textContent).toContain('Conveyancers');
    expect(linkByLabel(host, 'Conveyancers')?.classList.contains('is-active')).toBeTrue();

    await navigateTo('/docs', fixture, router);
    expect(host.textContent).toContain('Quickstart');
    expect(host.textContent).toContain('FAQ');
  });

  it('opens mobile drawer from header toggle', async () => {
    await navigateTo('/dashboard', fixture, router);
    const host = fixture.nativeElement as HTMLElement;
    const drawerToggle = host.querySelector('.app-header__drawer-toggle') as HTMLButtonElement;
    const sidebar = host.querySelector('app-app-sidebar aside') as HTMLElement;

    expect(sidebar.classList.contains('is-mobile-open')).toBeFalse();
    drawerToggle.click();
    fixture.detectChanges();
    expect(sidebar.classList.contains('is-mobile-open')).toBeTrue();
  });
});

function linkByLabel(host: HTMLElement, label: string): HTMLAnchorElement | null {
  return (
    (Array.from(host.querySelectorAll('app-app-sidebar a')).find((anchor) =>
      anchor.textContent?.trim().includes(label)
    ) as HTMLAnchorElement | undefined) ?? null
  );
}

async function navigateTo(url: string, fixture: ComponentFixture<AppSiteComponent>, router: Router): Promise<void> {
  await router.navigateByUrl(url);
  await navigateTick(fixture);
}

async function navigateTick(fixture: ComponentFixture<AppSiteComponent>): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();
}
