import { HttpClient, HttpErrorResponse, HttpEventType, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, catchError, concatMap, from, map, of, throwError, toArray } from 'rxjs';

import { CreateReviewResult, FinalizeReviewDocumentRequest } from './report.service';
import { UploadItem } from '../models/upload.models';
import { REVIEW_UPLOAD_LIMITS, validateReviewUploadAddition } from './review-upload-limits';

@Injectable({
  providedIn: 'root'
})
export class UploadService {
  private readonly http = inject(HttpClient);
  private readonly uploadsSubject = new BehaviorSubject<UploadItem[]>([]);

  getUploads(): Observable<UploadItem[]> {
    return this.uploadsSubject.asObservable();
  }

  getUploadsSnapshot(): UploadItem[] {
    return [...this.uploadsSubject.value];
  }

  queueFiles(files: File[]): Observable<UploadItem[]> {
    const duplicateError = this.findDuplicateFileError(files, this.uploadsSubject.value);
    if (duplicateError) {
      return throwError(() => new Error(duplicateError));
    }

    const validationError = validateReviewUploadAddition(files, this.uploadsSubject.value.length);
    if (validationError) {
      return throwError(() => new Error(validationError));
    }

    const nowIso = new Date().toISOString();
    const createdItems = files.map<UploadItem>((file) => ({
      id: `upl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      fileName: file.name,
      contentType: REVIEW_UPLOAD_LIMITS.pdfMimeType,
      fileSizeBytes: file.size,
      uploadedAt: nowIso,
      status: 'queued',
      progressPercent: 0,
      localFile: file
    }));

    this.uploadsSubject.next([...this.uploadsSubject.value, ...createdItems]);
    return of(createdItems);
  }

  getQueuedFilesSnapshot(): File[] {
    return this.uploadsSubject.value.map((item) => item.localFile).filter((file): file is File => file instanceof File);
  }

  uploadQueuedFiles(createReviewResult: CreateReviewResult): Observable<UploadItem[]> {
    const currentItems = this.uploadsSubject.value;
    if (currentItems.length === 0) {
      return throwError(() => new Error('No files are queued for upload.'));
    }

    if (createReviewResult.uploads.length !== currentItems.length) {
      return throwError(() => new Error('Upload URL count did not match queued files.'));
    }

    const uploadPairs = createReviewResult.uploads.map((target, index) => ({
      target,
      item: currentItems[index]
    }));

    return from(uploadPairs).pipe(
      concatMap((pair) => this.uploadSingleFile(pair.item, pair.target)),
      toArray(),
      map(() => this.uploadsSubject.value)
    );
  }

  getFinalizeDocuments(): FinalizeReviewDocumentRequest[] {
    return this.uploadsSubject.value
      .filter((item) => item.status === 'uploading' && item.documentId && item.s3KeyRaw)
      .map((item) => ({
        documentId: item.documentId as string,
        fileName: item.fileName,
        contentType: item.contentType,
        s3KeyRaw: item.s3KeyRaw as string
      }));
  }

  removeUpload(uploadId: string): Observable<void> {
    this.uploadsSubject.next(this.uploadsSubject.value.filter((item) => item.id !== uploadId));
    return of(void 0);
  }

  clearAll(): void {
    this.uploadsSubject.next([]);
  }

  private uploadSingleFile(item: UploadItem, target: CreateReviewResult['uploads'][number]): Observable<void> {
    if (!item.localFile) {
      return throwError(() => new Error(`File content for ${item.fileName} is unavailable.`));
    }

    this.patchUpload(item.id, {
      documentId: target.documentId,
      s3KeyRaw: target.s3KeyRaw,
      status: 'uploading',
      progressPercent: 0,
      errorMessage: undefined
    });

    const headers = new HttpHeaders({
      'Content-Type': target.contentType || item.contentType || 'application/octet-stream'
    });

    return this.http.post(target.uploadUrl, item.localFile, { observe: 'events', reportProgress: true, headers }).pipe(
      map((event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total ?? item.fileSizeBytes ?? 0;
          const percent = Math.max(0, Math.min(100, Math.round((event.loaded / Math.max(total, 1)) * 100)));
          this.patchUpload(item.id, { progressPercent: percent, status: 'uploading' });
          return;
        }

        if (event.type === HttpEventType.Response) {
          this.patchUpload(item.id, {
            status: 'uploaded',
            progressPercent: 100,
            uploadedAt: new Date().toISOString()
          });
        }
      }),
      catchError((error) => {
        const message = this.resolveUploadErrorMessage(error, item.fileName);
        this.patchUpload(item.id, {
          status: 'failed',
          errorMessage: message,
          progressPercent: 0
        });
        return throwError(() => new Error(message));
      })
    );
  }

  private patchUpload(uploadId: string, patch: Partial<UploadItem>): void {
    const next = this.uploadsSubject.value.map((item) => (item.id === uploadId ? { ...item, ...patch } : item));
    this.uploadsSubject.next(next);
  }

  private resolveUploadErrorMessage(error: unknown, fileName: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return `Upload failed for ${fileName}. The browser could not reach the storage upload URL. Check bucket CORS, network access, and service availability.`;
      }

      const statusText = error.statusText?.trim() || 'Request failed';
      return `Upload failed for ${fileName}. ${statusText} (${error.status}).`;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return `Upload failed for ${fileName}.`;
  }

  private findDuplicateFileError(files: readonly File[], existingUploads: readonly UploadItem[]): string | null {
    const duplicateFileNames = new Set<string>();
    const knownFingerprints = new Map<string, string>();

    for (const upload of existingUploads) {
      if (!(upload.localFile instanceof File)) {
        continue;
      }

      knownFingerprints.set(this.buildFileFingerprint(upload.localFile), upload.fileName);
    }

    for (const file of files) {
      const fingerprint = this.buildFileFingerprint(file);
      if (knownFingerprints.has(fingerprint)) {
        duplicateFileNames.add(file.name);
        continue;
      }

      knownFingerprints.set(fingerprint, file.name);
    }

    if (duplicateFileNames.size === 0) {
      return null;
    }

    return `Duplicate document detected. Remove the repeated PDF and try again: ${Array.from(duplicateFileNames).join(', ')}.`;
  }

  private buildFileFingerprint(file: Pick<File, 'name' | 'size' | 'lastModified'>): string {
    return `${file.name.trim().toLowerCase()}::${file.size}::${file.lastModified}`;
  }
}
