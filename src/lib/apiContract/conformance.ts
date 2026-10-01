/**
 * Story 7.3: compile-time checks that the documented shapes match the ones
 * the routes really send. `npm run typecheck` fails when they drift.
 */
import type { ShareFile, SharePayload, ShareResolution, ShareSection } from '../shareTypes';
import type { PublicConfig } from '../config';
import type { PublicConfigResponse } from './system';
import type { ShareFileBody, SharePayloadBody, ShareSectionBody, ShareUnlockResponse } from './share';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assignable<A, B> = [A] extends [B] ? true : false;

export type ContractChecks = [
  Same<ShareFile, ShareFileBody>,
  Same<ShareSection, ShareSectionBody>,
  Same<SharePayload, SharePayloadBody>,
  Assignable<ShareResolution, ShareUnlockResponse>,
  Same<PublicConfig, PublicConfigResponse>,
];

/** Every entry must be `true`; a drift turns one into `false` and this line fails to compile. */
export const contractChecks: ContractChecks = [true, true, true, true, true];

/**
 * What a handler may pass to `NextResponse.json` for a documented body `T`:
 * the same shape, where a `string` field may still be a `Date` (JSON writes
 * it as an ISO-8601 string). Routes check their answers with
 * `satisfies Wire<T>` (login, health, status, ping, cookie, cover, upload part),
 * so a drift between a handler and its documented body fails the typecheck.
 */
export type Wire<T> = T extends string
  ? T | Date
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
