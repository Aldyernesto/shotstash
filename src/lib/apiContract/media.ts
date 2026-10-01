/**
 * Story 7.3: parameters of the `/media/*` routes. The answers are bytes
 * (`MediaBytes`, `JpegImage`, `ZipArchive` in `common.ts`).
 * Type-only and alias-free (see `common.ts`).
 */

/** Path parameters naming a library file. */
export type FilePathParams = {
  /** File id (UUID). */
  fileId: string;
};

/** Path parameters naming a processed version. */
export type VersionPathParams = {
  /** Processed version id (UUID). */
  versionId: string;
};

/** Path parameters of a cover or avatar. */
export type CoverPathParams = {
  /** `project` or `user`. */
  kind: 'project' | 'user';
  /** Cover id (UUID). */
  id: string;
};

/** Path parameters of signed share media. */
export type SignedMediaPathParams = {
  /** HMAC-signed token minted by the share page; it names the link and the target and expires. */
  token: string;
};

/** Query of signed share media. */
export type SignedMediaQuery = {
  /** `1` serves the file as an attachment instead of inline. */
  dl?: '1';
};

/** Query of a thumbnail. */
export type ThumbnailQuery = {
  /** Thumbnail version; equal to the current one, the answer is cached for a year. */
  v?: string;
};

/** Query of a cover. */
export type CoverQuery = {
  /** Cache-busting version from the cover URL. */
  v?: string;
};

/** Query of a dashboard ZIP: a project plus a folder or a list of files. */
export type ZipQuery = {
  /** Project id (UUID). */
  projectId: string;
  /** Folder (Section) id to download whole. */
  folderId?: string;
  /** Comma-separated file ids to download. */
  fileIds?: string;
};
