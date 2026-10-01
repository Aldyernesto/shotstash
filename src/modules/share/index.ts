// Public surface of the share module.
import type { ShareSigner } from '@/lib/shareLink';
import { signShareUrl } from '@/modules/media';

export {
  ACCESS_CODE_LENGTH,
  SHARE_ACCESS_TTL_SECONDS,
  generateAccessCode,
  hashAccessCode,
  mintShareAccess,
  normalizeAccessCode,
  shareCookieName,
  shareCookiePath,
  verifyAccessCode,
  verifyShareAccess,
} from './access';

/** Signs share media URLs through the media module. */
export const shareSigner: ShareSigner = (shareId, target) => signShareUrl(shareId, target);

export { revokeLinksForTargets } from './revoke';
export { shareUnlocked } from './unlock';
export type { CookieReader } from './unlock';
