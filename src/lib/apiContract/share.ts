/**
 * Story 7.3: shapes of the share page routes under `/s/:slug`. They mirror
 * `src/lib/shareTypes.ts` (checked at compile time by `conformance.ts`).
 * Type-only and alias-free (see `common.ts`).
 */

/** Path parameters naming a share link. */
export type SharePathParams = {
  /** Share link slug. */
  slug: string;
};

/** A file on a share page. Media URLs are signed and valid for 5 minutes. */
export type ShareFileBody = {
  /** File id. */
  id: string;
  /** File name. */
  name: string;
  /** File kind derived from the media type. */
  kind: 'image' | 'video' | 'audio' | 'document';
  /** Size in bytes. */
  sizeBytes: number;
  /** Size for people, such as `12.4 MB`. */
  sizeText: string;
  /** Signed thumbnail URL, or null when the file has no thumbnail. */
  thumbnailUrl: string | null;
  /** Signed URL to show the file inline. */
  inlineUrl: string | null;
  /** Signed URL to download the file. */
  downloadUrl: string | null;
  /** Duration text; not recorded yet, always null. */
  duration: string | null;
};

/** A Section card on a project share page. */
export type ShareSectionBody = {
  /** Folder (Section) id. */
  id: string;
  /** Leading number of the Section name, such as `25`, or null. */
  number: string | null;
  /** Section title without the number. */
  title: string;
  /** Files in the Section. */
  fileCount: number;
  /** Up to 3 signed representative thumbnail URLs. */
  repThumbs: Array<string | null>;
};

/** One more page of a share grid. */
export type ShareItemsResponse = {
  /** Files of the page (empty when the page lists Sections). */
  files: ShareFileBody[];
  /** Sections of the page (project links without a drill-in only). */
  sections: ShareSectionBody[];
  /** Items in the whole list. */
  total: number;
};

/** Query of a share grid page. */
export type ShareItemsQuery = {
  /** Items to skip. */
  offset?: number;
  /** Page size, 1 to 60 (default 12). */
  limit?: number;
  /** Section id to page inside (project links). */
  section?: string;
  /** Sort id: `name`, `date`, `size`, `type` for files; `number`, `name`, `count` for Sections. */
  sort?: string;
};

/** Why a share link cannot be shown. */
export type ShareStateBody = {
  /** `NOT_FOUND`, `UNAUTHENTICATED` or `GONE`. */
  code: string;
  /** `not-found`, `private`, `expired`, `revoked` or `gone`. */
  state: 'not-found' | 'private' | 'expired' | 'revoked' | 'gone';
  /** For `gone`: what was removed. */
  target?: 'project' | 'section' | 'file' | 'unknown';
};

/** Which signed URLs to mint again. */
export type ShareSignRequest = {
  /** Files to sign (at most 200). */
  fileIds?: string[];
  /** Also sign the ZIP of the link or of `section`. */
  zip?: boolean;
  /** Section id for the ZIP and the thumbnails. */
  section?: string;
  /** Also sign the stage and Section card thumbnails. */
  thumbs?: boolean;
};

/** Signed URLs of one file. */
export type SignedFileUrls = {
  /** Signed thumbnail URL, or null when the file has no thumbnail. */
  thumbnailUrl: string | null;
  /** Signed URL to show the file inline. */
  inlineUrl: string;
  /** Signed URL to download the file. */
  downloadUrl: string;
};

/** Freshly signed URLs. */
export type ShareSignResponse = {
  /** Signed URLs by file id. */
  files: Record<string, SignedFileUrls>;
  /** Signed ZIP URL, or null when not asked or not possible. */
  zipUrl: string | null;
  /** Why the ZIP could not be signed. */
  cause: 'EMPTY' | 'UNREADABLE' | 'NOT_FOUND' | null;
  /** Signed stage thumbnails, when asked. */
  stageThumbs: Array<string | null> | null;
  /** Signed Section card thumbnails by Section id, when asked. */
  sectionThumbs: Record<string, Array<string | null>> | null;
};

/** The access code of a PRIVATE link. */
export type ShareUnlockRequest = {
  /** Access code (ignored for PUBLIC links). */
  code?: string;
  /** Section id to open inside a project link. */
  section?: string;
};

/** A Section label for the kicker of a file link. */
export type ShareSectionLabel = {
  /** Leading number, or null. */
  number: string | null;
  /** Title without the number. */
  title: string;
};

/** Counts per kind. */
export type ShareBreakdown = {
  /** Images. */
  photos: number;
  /** Videos. */
  videos: number;
  /** Everything else. */
  documents: number;
};

/** The opened Section of a project link. */
export type ShareOpenSection = {
  /** Folder (Section) id. */
  id: string;
  /** Leading number, or null. */
  number: string | null;
  /** Title without the number. */
  title: string;
  /** Files in the Section. */
  fileCount: number;
};

/** Everything a share page shows. */
export type SharePayloadBody = {
  /** Share link slug. */
  slug: string;
  /** What the link shares. */
  kind: 'project' | 'section' | 'file';
  /** Headline without the number prefix. */
  title: string;
  /** Leading number of the title, or null. */
  number: string | null;
  /** Project id. */
  projectId: string;
  /** Section links: the shared folder id. */
  folderId: string | null;
  /** Signed ZIP URL of the whole payload (valid 24 h), or null. */
  zipUrl: string | null;
  /** Project name, or null. */
  projectName: string | null;
  /** File links: the parent Section, or null. */
  sectionLabel: ShareSectionLabel | null;
  /** Files shared. */
  fileCount: number;
  /** Sections shared (project links), or null. */
  sectionCount: number | null;
  /** Total size for people. */
  totalSizeText: string;
  /** Date for people. */
  dateText: string;
  /** Counts per kind, or null when empty. */
  breakdown: ShareBreakdown | null;
  /** When the link expires (ISO-8601 UTC), or null. */
  expiresAt: string | null;
  /** 1 to 3 signed stage thumbnails. */
  stageThumbs: Array<string | null>;
  /** First page of files. */
  files: ShareFileBody[];
  /** Shared Sections (project links). */
  sections: ShareSectionBody[];
  /** File links: the file. */
  single: ShareFileBody | null;
  /** The opened Section of a project link, or null. */
  section: ShareOpenSection | null;
};

/** The share page after unlocking, or why it cannot be shown. */
export type ShareUnlockResponse = {
  /** `ok`, or why the link cannot be shown. */
  state: 'ok' | 'expired' | 'revoked' | 'gone' | 'not-found' | 'private';
  /** What was removed (`gone` only). */
  target?: 'project' | 'section' | 'file' | 'unknown';
  /** The page (`ok` only). */
  payload?: SharePayloadBody;
};
