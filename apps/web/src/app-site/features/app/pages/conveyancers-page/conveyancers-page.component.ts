import { AsyncPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap
} from 'rxjs';

import {
  ConveyancerDirectoryItem,
  ConveyancerDirectoryPage,
  JurisdictionCode
} from '@shared-core/models/conveyancer.models';
import { ConveyancerDirectoryService } from '@shared-core/services/conveyancer-directory.service';
import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { UISkeletonBlockComponent } from '@shared-ui/ui/skeleton-block/skeleton-block.component';

interface ConveyancersViewModel {
  jurisdiction: JurisdictionCode;
  query: string;
  selectedRegulatorType: string;
  loading: boolean;
  error: string | null;
  rows: ConveyancerDirectoryItem[];
  regulatorTypes: string[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
}

@Component({
  selector: 'app-conveyancers-page',
  standalone: true,
  imports: [AsyncPipe, DatePipe, RouterLink, UIPageHeaderComponent, UISkeletonBlockComponent],
  templateUrl: './conveyancers-page.component.html',
  styleUrl: './conveyancers-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConveyancersPageComponent {
  readonly jurisdictions: JurisdictionCode[] = ['ACT', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT'];
  readonly allRegulatorsValue = '__all__';
  readonly pageSize = 24;
  readonly loadingCardPlaceholders = Array.from({ length: 6 }, (_, index) => index);

  private readonly conveyancerDirectory = inject(ConveyancerDirectoryService);
  private readonly route = inject(ActivatedRoute);

  private readonly selectedJurisdictionSubject = new BehaviorSubject<JurisdictionCode>(
    this.normalizeJurisdiction(this.route.snapshot.queryParamMap.get('jurisdiction') ?? 'ACT')
  );
  private readonly queryInputSubject = new BehaviorSubject<string>('');
  private readonly selectedRegulatorTypeSubject = new BehaviorSubject<string>(this.allRegulatorsValue);
  private readonly selectedPageSubject = new BehaviorSubject<number>(1);

  readonly viewModel$: Observable<ConveyancersViewModel> = combineLatest([
    this.selectedJurisdictionSubject.pipe(distinctUntilChanged()),
    this.queryInputSubject.pipe(
      map((value) => value.trim()),
      debounceTime(250),
      distinctUntilChanged()
    ),
    this.selectedRegulatorTypeSubject.pipe(distinctUntilChanged()),
    this.selectedPageSubject.pipe(distinctUntilChanged())
  ]).pipe(
    switchMap(([jurisdiction, query, selectedRegulatorType, page]) =>
      this.conveyancerDirectory
        .search({
          jurisdiction,
          query,
          regulatorType: selectedRegulatorType === this.allRegulatorsValue ? null : selectedRegulatorType,
          page,
          pageSize: this.pageSize
        })
        .pipe(
          map((result) =>
            this.toReadyViewModel(jurisdiction, query, selectedRegulatorType, result)
          ),
          startWith(this.toLoadingViewModel(jurisdiction, query, selectedRegulatorType)),
          catchError((error: unknown) =>
            of({
              jurisdiction,
              query,
              selectedRegulatorType,
              loading: false,
              error: error instanceof Error ? error.message : 'Directory request failed.',
              rows: [],
              regulatorTypes: [],
              page,
              pageSize: this.pageSize,
              totalCount: 0,
              totalPages: 1,
              rangeStart: 0,
              rangeEnd: 0
            } satisfies ConveyancersViewModel)
          )
        )
    )
  );

  get emptyStatePrimaryLink(): string {
    return '/reports';
  }

  get emptyStatePrimaryLabel(): string {
    return 'Open reports';
  }

  get emptyStateSecondaryLink(): string {
    return '/docs';
  }

  get emptyStateSecondaryLabel(): string {
    return 'Open guides';
  }

  onJurisdictionChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const normalized = this.normalizeJurisdiction(target?.value ?? 'ACT');
    this.selectedJurisdictionSubject.next(normalized);
    this.selectedRegulatorTypeSubject.next(this.allRegulatorsValue);
    this.selectedPageSubject.next(1);
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.queryInputSubject.next((target?.value ?? '').trimStart());
    this.selectedPageSubject.next(1);
  }

  onRegulatorTypeChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const selected = (target?.value ?? this.allRegulatorsValue).trim();
    this.selectedRegulatorTypeSubject.next(selected.length > 0 ? selected : this.allRegulatorsValue);
    this.selectedPageSubject.next(1);
  }

  goToPage(page: number): void {
    if (!Number.isFinite(page)) {
      return;
    }

    this.selectedPageSubject.next(Math.max(1, Math.floor(page)));
  }

  pageNumbers(currentPage: number, totalPages: number): number[] {
    if (totalPages <= 1) {
      return [1];
    }

    const radius = 1;
    const start = Math.max(1, currentPage - radius);
    const end = Math.min(totalPages, currentPage + radius);
    const output: number[] = [];
    for (let index = start; index <= end; index += 1) {
      output.push(index);
    }
    return output;
  }

  formatRegulator(value: string): string {
    return value
      .replace(/[_\-]+/g, ' ')
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(2))
      .join(' ');
  }

  websiteLabel(url: string): string {
    const parsed = this.tryParseUrl(url);
    if (!parsed) {
      return 'Visit website';
    }

    return parsed.hostname.replace(/^www\./i, '');
  }

  displayPrimaryName(item: ConveyancerDirectoryItem): string {
    const organizationName = item.organizationName?.trim() ?? '';
    if (organizationName.length > 0) {
      return organizationName;
    }

    return item.name;
  }

  hasDistinctContact(item: ConveyancerDirectoryItem): boolean {
    const contactName = item.contactName?.trim() ?? '';
    if (contactName.length === 0) {
      return false;
    }

    const organizationName = item.organizationName?.trim().toLowerCase() ?? '';
    return contactName.toLowerCase() !== organizationName;
  }

  private toLoadingViewModel(
    jurisdiction: JurisdictionCode,
    query: string,
    selectedRegulatorType: string
  ): ConveyancersViewModel {
    return {
      jurisdiction,
      query,
      selectedRegulatorType,
      loading: true,
      error: null,
      rows: [],
      regulatorTypes: [],
      page: 1,
      pageSize: this.pageSize,
      totalCount: 0,
      totalPages: 1,
      rangeStart: 0,
      rangeEnd: 0
    };
  }

  private toReadyViewModel(
    jurisdiction: JurisdictionCode,
    query: string,
    selectedRegulatorType: string,
    result: ConveyancerDirectoryPage
  ): ConveyancersViewModel {
    const page = Math.max(1, result.page);
    const totalPages = Math.max(1, result.totalPages);
    const rows = result.items;
    const hasRows = rows.length > 0;
    const rangeStart = hasRows ? (page - 1) * result.pageSize + 1 : 0;
    const rangeEnd = hasRows ? rangeStart + rows.length - 1 : 0;

    return {
      jurisdiction,
      query,
      selectedRegulatorType,
      loading: false,
      error: null,
      rows,
      regulatorTypes: result.regulatorTypes,
      page,
      pageSize: result.pageSize,
      totalCount: result.totalCount,
      totalPages,
      rangeStart,
      rangeEnd
    };
  }

  private normalizeJurisdiction(value: string): JurisdictionCode {
    const normalized = value.trim().toUpperCase();
    return this.jurisdictions.includes(normalized as JurisdictionCode)
      ? (normalized as JurisdictionCode)
      : 'ACT';
  }

  private tryParseUrl(value: string): URL | null {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }
}
