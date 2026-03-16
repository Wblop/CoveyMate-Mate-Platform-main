export interface ReviewUploadFileLike {
  name: string;
  size: number;
  type?: string;
}

export const REVIEW_UPLOAD_LIMITS = {
  maxFiles: 5,
  maxFileSizeBytes: 30 * 1024 * 1024,
  maxFileSizeLabel: '30 MB',
  pdfMimeType: 'application/pdf'
} as const;

export function isPdfReviewUpload(file: Pick<ReviewUploadFileLike, 'name' | 'type'>): boolean {
  return file.type?.toLowerCase() === REVIEW_UPLOAD_LIMITS.pdfMimeType ||
    file.name.toLowerCase().endsWith('.pdf');
}

export function validateReviewUploadBatch(files: readonly ReviewUploadFileLike[]): string | null {
  if (files.length === 0) {
    return 'Choose at least one file.';
  }

  const fileError = validateReviewUploadFiles(files);
  if (fileError) {
    return fileError;
  }

  if (files.length > REVIEW_UPLOAD_LIMITS.maxFiles) {
    return `You can upload up to ${REVIEW_UPLOAD_LIMITS.maxFiles} PDF files per report. Remove some files and try again.`;
  }

  return null;
}

export function validateReviewUploadAddition(files: readonly ReviewUploadFileLike[], existingCount: number): string | null {
  if (files.length === 0) {
    return 'Choose at least one file.';
  }

  const fileError = validateReviewUploadFiles(files);
  if (fileError) {
    return fileError;
  }

  if (existingCount + files.length >= REVIEW_UPLOAD_LIMITS.maxFiles) {
    const remainingSlots = Math.max(REVIEW_UPLOAD_LIMITS.maxFiles - existingCount, 0);
    if (remainingSlots === 0) {
      return `You can upload up to ${REVIEW_UPLOAD_LIMITS.maxFiles} PDF files per report. Remove a file before adding another.`;
    }

    return `You can upload up to ${REVIEW_UPLOAD_LIMITS.maxFiles} PDF files per report. Add no more than ${remainingSlots} more ${remainingSlots === 1 ? 'file' : 'files'}.`;
  }

  return null;
}

function validateReviewUploadFiles(files: readonly ReviewUploadFileLike[]): string | null {
  const invalidFiles = files.filter((file) => !isPdfReviewUpload(file));
  if (invalidFiles.length > 0) {
    return `Only PDF files are supported right now. Remove: ${invalidFiles.map((file) => file.name).join(', ')}.`;
  }

  const oversizedFiles = files.filter((file) => file.size > REVIEW_UPLOAD_LIMITS.maxFileSizeBytes);
  if (oversizedFiles.length > 0) {
    return `Each PDF must be ${REVIEW_UPLOAD_LIMITS.maxFileSizeLabel} or smaller. Remove: ${oversizedFiles.map((file) => file.name).join(', ')}.`;
  }

  return null;
}
