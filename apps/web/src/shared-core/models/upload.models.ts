export type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';

export interface UploadItem {
  id: string;
  documentId?: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  uploadedAt: string;
  status: UploadStatus;
  progressPercent: number;
  s3KeyRaw?: string;
  errorMessage?: string;
  localFile?: File;
}
