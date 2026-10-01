/**
 * Story 5.4-5.5: GraphQL selections shared by queries and the project event
 * stream, so a job or a chat message has the same shape wherever it comes
 * from.
 */

/** Fields of a `PipelineJob` the UI reads. */
export const JOB_FIELDS = `
  id
  kind
  kindLabel
  fileId
  status
  state
  progress
  attempts
  maxAttempts
  error
  seq
  createdAt
  updatedAt
  finishedAt
`;

/** Fields of a `ProjectChat` the discussion panel reads. */
export const CHAT_FIELDS = `
  id
  seq
  message
  kind
  createdAt
  sender {
    id
    name
    role
    avatarUrl
  }
  referencedFile {
    id
    originalName
  }
`;

export type UiJob = {
  id: string;
  kind: string;
  kindLabel?: string | null;
  fileId: string;
  status: string;
  state: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error?: string | null;
  seq: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  finishedAt?: string | null;
};
