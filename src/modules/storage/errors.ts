/**
 * Typed storage failures. Callers branch on `code`, never on the message.
 *
 *   NOT_FOUND           the key (or the staged upload) does not exist
 *   INVALID_KEY         the key is not a safe relative key (see keys.ts)
 *   INVALID_UPLOAD      the upload id is malformed or unknown
 *   INVALID_RANGE       a byte range outside the object
 *   PART_SIZE_MISMATCH  a part's body is shorter or longer than declared
 *   INVALID_PART        the backend refused the part list at completion (send the parts again)
 *   CHECKSUM_MISMATCH   a part's body does not match its MD5
 *   UNAVAILABLE         the backend cannot be reached or refused the request
 *
 * Alias-free: `node --test` imports it directly.
 */
/** Internal codes: never sent to clients (the upload and media modules map them). */
export type StorageFaultCode =
  | 'NOT_FOUND'
  | 'INVALID_KEY'
  | 'INVALID_UPLOAD'
  | 'INVALID_RANGE'
  | 'PART_SIZE_MISMATCH'
  | 'INVALID_PART'
  | 'CHECKSUM_MISMATCH'
  | 'UNAVAILABLE';

export class StorageError extends Error {
  readonly code: StorageFaultCode;
  constructor(code: StorageFaultCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

export function isStorageError(err: unknown, code?: StorageFaultCode): err is StorageError {
  return err instanceof StorageError && (code === undefined || err.code === code);
}
