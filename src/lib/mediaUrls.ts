/**
 * Relative media URLs (Story 2.2). Pure: safe for client components.
 * Bytes are authorised by the `shotstash_session` cookie (Path=/media), so
 * no URL ever carries a session token.
 */

export const mediaUrl = {
  /** `v` is the file's thumbnail version: a new thumbnail gets a new URL (cache buster). */
  thumbnail: (fileId: string, v?: number | null) => (v ? `/media/t/${fileId}?v=${v}` : `/media/t/${fileId}`),
  inline: (fileId: string) => `/media/i/${fileId}`,
  download: (fileId: string) => `/media/d/${fileId}`,
  cover: (kind: 'project' | 'user', id: string) => `/media/c/${kind}/${id}`,
  zip: (params: { projectId: string; folderId?: string | null; fileIds?: string[] }) => {
    const q = new URLSearchParams({ projectId: params.projectId });
    if (params.folderId) q.set('folderId', params.folderId);
    else if (params.fileIds?.length) q.set('fileIds', params.fileIds.join(','));
    return `/media/z?${q.toString()}`;
  },
};

const COVER_PATH_RE = /^\/media\/c\/(project|user)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\?v=\d{1,20})?$/;

/**
 * True only for our own cover paths (`/media/c/(project|user)/<uuid>`, with an
 * optional `?v=<n>` cache buster), the
 * values stored for project covers and avatars. External URLs are refused
 * (tracking pixels, mixed content).
 */
export function isRenderableImageUrl(value: string | null | undefined): value is string {
  return !!value && COVER_PATH_RE.test(value);
}
