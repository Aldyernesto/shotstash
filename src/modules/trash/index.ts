// Public surface of the trash module (Story 2.8).
export {
  purgeExpired,
  purgeProject,
  purgeRoots,
  restoreFile,
  restoreFolder,
  trashError,
  trashFile,
  trashFolder,
  trashedFileRoots,
  trashedFolderRoots,
} from './service';
export { PURGE_BATCH_SIZE } from './service';
export type { PurgeResult, TrashErrorCode } from './service';
export {
  batches,
  expiredRootWhere,
  isExpiredRoot,
  planFolderTrash,
  retentionCutoff,
  subtreeFolderIds,
} from './plan';
