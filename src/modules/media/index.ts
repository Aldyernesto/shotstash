// Public surface of the media module: the only way bytes leave the app,
// plus thumbnails, covers, HEIC previews and processed versions through the
// storage backend.
export {
  COVER_KINDS,
  coverIdFromUrl,
  coverResponse,
  coverUrl,
  mediaGuard,
  processedVersionResponse,
  projectZipResponse,
  serveFile,
  signedMediaResponse,
  thumbnailCache,
  thumbnailGuard,
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
export { CACHE_COOKIE, CACHE_IMMUTABLE, CACHE_NO_STORE, CACHE_SIGNED, contentDisposition, fileResponse, notFoundResponse } from './stream';
export type { CachePolicy, FileResponseInput } from './stream';
export { THUMB_LONG_EDGE, generateThumbnail, needsThumbnail, renderThumbnail } from './thumbnail';
export { HEIC_PREVIEW_LONG_EDGE, MAX_HEIC_BYTES, createHeicPreview, isHeicMime } from './heic';
export { PROCESSED_KIND_PREVIEW, previewOf, processedFileName } from './processed';
export type { ProcessedVersionRow } from './processed';
export { MAX_COVER_BYTES, deleteCover, saveCover } from './covers';
