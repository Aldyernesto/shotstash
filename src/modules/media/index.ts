// Public surface of the media module: the only way bytes leave the app.
export {
  COVER_EXTENSIONS,
  COVER_KINDS,
  coverResponse,
  coverUrl,
  coversDir,
  mediaGuard,
  projectZipResponse,
  serveFile,
  signedMediaResponse,
} from './guard';
export type { CoverKind, GuardResult, GuardedFile } from './guard';
export {
  SIGNED_FILE_TTL_SECONDS,
  SIGNED_ZIP_TTL_SECONDS,
  isZipTarget,
  signShareToken,
  signShareUrl,
  verifyShareToken,
} from './signing';
export { parseRange } from './range';
export type { RangeResult } from './range';
export { CACHE_COOKIE, CACHE_SIGNED, contentDisposition, notFoundResponse } from './stream';

