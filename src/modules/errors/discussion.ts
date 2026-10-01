/**
 * Story 5.5: `SHOTSTASH_FEATURE_DISCUSSION=false` switches project discussion
 * off. Every discussion query, mutation and subscription asks this gate,
 * which answers FEATURE_DISABLED; the schema stays the same either way.
 *
 * Pure and alias-free: `node --test` imports it directly.
 */
import { GraphQLError } from 'graphql';

export function discussionDisabledError(): GraphQLError {
  return new GraphQLError('Project discussion is turned off on this instance', { extensions: { code: 'FEATURE_DISABLED' } });
}

/** Throws FEATURE_DISABLED when discussion is off. */
export function assertDiscussionEnabled(features: { discussion: boolean }): void {
  if (!features.discussion) throw discussionDisabledError();
}
