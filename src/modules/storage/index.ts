// Public surface of the storage module (AD-3): every byte stored for media
// goes through `storage()`, addressed by the keys built in keys.ts.
export { objectMd5, readHead, setStorageForTests, storage, storageHealth } from './backend.ts';
export { StorageError, isStorageError } from './errors.ts';
export type { StorageFaultCode } from './errors.ts';
export { COVER_KINDS, assertSafeKey, isSafeKey, storageKeys } from './keys.ts';
export type { CoverKind } from './keys.ts';
export { DEFAULT_PART_SIZE, MAX_PARTS, expectedPartSize, partPlan } from './partSize.ts';
export type { PartPlan } from './partSize.ts';
export { MIME_EXT, SNIFF_BYTES, extensionFor, mimeFromName, nameExtension, sniffMime, sniffType } from './mime.ts';
export { md5Hex } from './meter.ts';
export type { BackendName, ByteRange, Capacity, ObjectStat, ProbeResult, StorageBackend, StoredPart } from './types.ts';
