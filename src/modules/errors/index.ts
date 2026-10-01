// Public surface of the errors module (Story 3.5).
// Story 3.5: a refused request with a stable code. `message` is an English
// developer string that is never shown; the client renders
// `errors.codes.<code>` from messages with `details` as ICU arguments.
import { GraphQLError } from 'graphql';

export function codedError(code: string, message: string, details: Record<string, string | number> = {}) {
  return new GraphQLError(message, { extensions: { ...details, code } });
}

// Story 5.5: the discussion toggle (FEATURE_DISABLED).
export { assertDiscussionEnabled, discussionDisabledError } from './discussion.ts';
