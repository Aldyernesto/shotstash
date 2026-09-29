// Public surface of the upload module (Story 4.3): row-first uploads on the
// storage interface, dedup per Project, resume and expiry.
export {
  MAX_FILE_BYTES,
  SESSION_TTL_MS,
  UploadFailure,
  asGraphQLError,
  cancelUpload,
  completeUpload,
  expireSessions,
  initiateUpload,
  putPart,
  uploadSessionInfo,
} from './service';
export type { CompleteInput, InitiateInput, PartInput } from './service';
export {
  checkDuplicates,
  detachDuplicates,
  detachDuplicatesOfProject,
  detachForMove,
  findOriginal,
  isDedupViolation,
  markConflictsAsDuplicates,
  resettle,
} from './dedup';
export type { DuplicateCandidate, DuplicateMatch } from './dedup';
