import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ConveyancerDirectoryService } from '@shared-core/services/conveyancer-directory.service';
import { ConveyancersPageComponent } from './conveyancers-page.component';

class ConveyancerDirectoryServiceStub {
  readonly search = jasmine.createSpy('search').and.returnValue(
    of({
      items: [],
      page: 1,
      pageSize: 24,
      totalCount: 0,
      totalPages: 1,
      regulatorTypes: []
    })
  );
}

describe('ConveyancersPageComponent', () => {
  let fixture: ComponentFixture<ConveyancersPageComponent>;
  let service: ConveyancerDirectoryServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConveyancersPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ jurisdiction: 'NSW' })
            }
          }
        },
        {
          provide: ConveyancerDirectoryService,
          useClass: ConveyancerDirectoryServiceStub
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ConveyancersPageComponent);
    service = TestBed.inject(ConveyancerDirectoryService) as unknown as ConveyancerDirectoryServiceStub;
  });

  it('initializes the jurisdiction filter from the route query param', fakeAsync(() => {
    fixture.detectChanges();
    tick(250);
    fixture.detectChanges();

    expect(service.search).toHaveBeenCalledWith(
      jasmine.objectContaining({
        jurisdiction: 'NSW',
        page: 1,
        pageSize: 24
      })
    );
  }));
});
