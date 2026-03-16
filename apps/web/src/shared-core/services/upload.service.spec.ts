import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { UploadService } from './upload.service';

describe('UploadService', () => {
  let service: UploadService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(UploadService);
  });

  it('queues files in queued state', fakeAsync(() => {
    const file = new File(['content'], 'contract.pdf', { type: 'application/pdf' });
    let statuses: string[] = [];

    service.queueFiles([file]).subscribe((items) => {
      statuses = items.map((item) => item.status);
    });

    tick();
    expect(statuses).toEqual(['queued']);
  }));

  it('rejects non-pdf uploads', fakeAsync(() => {
    const file = new File(['content'], 'contract.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    let errorMessage = '';

    service.queueFiles([file]).subscribe({
      error: (error: Error) => {
        errorMessage = error.message;
      }
    });

    tick();
    expect(errorMessage).toContain('Only PDF files are supported right now');
  }));

  it('rejects files larger than 30 MB', fakeAsync(() => {
    const file = new File([new Uint8Array(30 * 1024 * 1024 + 1)], 'oversized.pdf', { type: 'application/pdf' });
    let errorMessage = '';

    service.queueFiles([file]).subscribe({
      error: (error: Error) => {
        errorMessage = error.message;
      }
    });

    tick();
    expect(errorMessage).toContain('30 MB or smaller');
  }));

  it('rejects selections that exceed five queued PDFs', fakeAsync(() => {
    const initialFiles = Array.from({ length: 5 }, (_, index) => new File(['content'], `contract-${index + 1}.pdf`, { type: 'application/pdf' }));
    let errorMessage = '';

    service.queueFiles(initialFiles).subscribe();
    tick();

    service.queueFiles([new File(['content'], 'contract-6.pdf', { type: 'application/pdf' })]).subscribe({
      error: (error: Error) => {
        errorMessage = error.message;
      }
    });

    tick();
    expect(errorMessage).toContain('up to 5 PDF files');
  }));

  it('rejects duplicate documents that are already queued', fakeAsync(() => {
    const lastModified = 1700000000000;
    const file = new File(['content'], 'contract.pdf', { type: 'application/pdf', lastModified });
    const duplicateFile = new File(['content'], 'contract.pdf', { type: 'application/pdf', lastModified });
    let errorMessage = '';

    service.queueFiles([file]).subscribe();
    tick();

    service.queueFiles([duplicateFile]).subscribe({
      error: (error: Error) => {
        errorMessage = error.message;
      }
    });

    tick();
    expect(errorMessage).toContain('Duplicate document detected');
    expect(errorMessage).toContain('contract.pdf');
  }));

  it('rejects duplicate documents within the same selection batch', fakeAsync(() => {
    const lastModified = 1700000000000;
    const firstFile = new File(['content'], 'contract.pdf', { type: 'application/pdf', lastModified });
    const duplicateFile = new File(['content'], 'contract.pdf', { type: 'application/pdf', lastModified });
    let errorMessage = '';

    service.queueFiles([firstFile, duplicateFile]).subscribe({
      error: (error: Error) => {
        errorMessage = error.message;
      }
    });

    tick();
    expect(errorMessage).toContain('Duplicate document detected');
    expect(errorMessage).toContain('contract.pdf');
  }));

  it('removes an uploaded item', fakeAsync(() => {
    const file = new File(['content'], 'annexure.pdf', { type: 'application/pdf' });
    let uploadId = '';
    let remainingCount = -1;

    service.queueFiles([file]).subscribe((items) => {
      uploadId = items[0].id;
    });
    tick();

    service.removeUpload(uploadId).subscribe();
    tick();

    service.getUploads().subscribe((items) => {
      remainingCount = items.length;
    });
    tick();

    expect(remainingCount).toBe(0);
  }));
});
