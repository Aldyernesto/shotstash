"use client";

/**
 * Story 5.5: one `projectEvents` subscription per Project, shared by every
 * component that listens (the library grid, the viewer, the discussion
 * panel). Each event passed the server's per-event `can()` check; here the
 * client drops anything older than what it has seen for that entity
 * (`createSeqGate`, also fed from query results through `noteProjectSeq`),
 * so a late or repeated event never rolls the UI back.
 *
 * A stream the server ends (complete) or that fails is reopened with a
 * growing delay while listeners remain; a `resync` event (the server skipped
 * an event on a transient error) reaches listeners, which refetch.
 */
import { useEffect, useRef } from "react";
import { gql, useApolloClient, type ApolloClient, type DocumentNode } from "@apollo/client";
import { createSeqGate, type SeqGate } from "@/lib/realtimeSeq";
import { CHAT_FIELDS, JOB_FIELDS, type UiJob } from "./fields";

const PROJECT_EVENTS = gql`
  subscription ProjectEvents($projectId: ID!) {
    projectEvents(projectId: $projectId) {
      type
      id
      seq
      chat {
        ${CHAT_FIELDS}
      }
      job {
        ${JOB_FIELDS}
      }
    }
  }
`;

export type ProjectEvent = {
  type: "chat.created" | "job.updated" | "resync" | string;
  id: string;
  seq: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chat?: any;
  job?: UiJob | null;
};

type Listener = (event: ProjectEvent) => void;

/** Reopen delays after a stream ended: 1 s, doubling up to 30 s. */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

/* ------------------------------------------------------------------ */
/* A subscription that reopens itself                                  */
/* ------------------------------------------------------------------ */

/** Refusals a retry cannot fix: signed out, not allowed, feature off. */
const FINAL_CODES = new Set(["UNAUTHENTICATED", "FORBIDDEN", "FEATURE_DISABLED", "NOT_FOUND"]);

function isFinalRefusal(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { graphQLErrors?: { extensions?: { code?: string } }[]; extensions?: { code?: string } };
  const list = Array.isArray(err) ? (err as { extensions?: { code?: string } }[]) : e.graphQLErrors ?? (e.extensions ? [e] : []);
  return list.some((g) => FINAL_CODES.has(String(g?.extensions?.code ?? "")));
}

/**
 * Subscribes and, when the server completes or fails the stream, opens a
 * fresh one after a growing delay until `stop()` is called. A message resets
 * the delay.
 */
function resilientSubscribe<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: ApolloClient<any>,
  query: DocumentNode,
  variables: Record<string, unknown>,
  onData: (data: T) => void,
): () => void {
  let stopped = false;
  let delay = RETRY_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sub: { unsubscribe: () => void } | null = null;
  const reopen = (err?: unknown) => {
    sub = null;
    if (stopped || isFinalRefusal(err)) return;
    timer = setTimeout(start, delay);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  };
  function start() {
    timer = null;
    if (stopped) return;
    sub = client.subscribe<T>({ query, variables }).subscribe({
      next: ({ data }) => {
        delay = RETRY_MIN_MS;
        if (data) onData(data);
      },
      error: (err) => reopen(err),
      complete: () => reopen(),
    });
  }
  start();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    sub?.unsubscribe();
  };
}

/** `resilientSubscribe` as a hook: subscribed while `enabled`, with the latest `onData`. */
export function useResilientSubscription<T>(query: DocumentNode, variables: Record<string, unknown>, onData: (data: T) => void, enabled = true) {
  const client = useApolloClient();
  const handler = useRef(onData);
  useEffect(() => {
    handler.current = onData;
  }, [onData]);
  const key = JSON.stringify(variables);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    return resilientSubscribe<T>(client, query, JSON.parse(key), (d) => handler.current(d));
  }, [client, query, key, enabled]);
}

/* ------------------------------------------------------------------ */
/* Project streams                                                     */
/* ------------------------------------------------------------------ */

type Entry = { listeners: Set<Listener>; stop: () => void };

const streams = new Map<string, Entry>();
const gates = new Map<string, SeqGate>();

function gateOf(projectId: string): SeqGate {
  let gate = gates.get(projectId);
  if (!gate) {
    gate = createSeqGate();
    gates.set(projectId, gate);
  }
  return gate;
}

/** Records a seq a query returned, so an older event for that entity is dropped later. */
export function noteProjectSeq(projectId: string | null | undefined, type: "chat.created" | "job.updated", id: string, seq: number | null | undefined) {
  if (!projectId || seq == null) return;
  gateOf(projectId).note(`${type}:${id}`, Number(seq));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function open(client: ApolloClient<any>, projectId: string): Entry {
  const listeners = new Set<Listener>();
  const gate = gateOf(projectId);
  const stop = resilientSubscribe<{ projectEvents: ProjectEvent }>(client, PROJECT_EVENTS, { projectId }, (data) => {
    const event = data.projectEvents;
    if (!event) return;
    if (event.type !== "resync") {
      const seq = event.job ? Number(event.job.seq) : Number(event.seq);
      if (!gate.accept(`${event.type}:${event.id}`, seq)) return;
    }
    for (const l of [...listeners]) l(event);
  });
  return { listeners, stop };
}

/** Calls `onEvent` for every new event of the Project while mounted (and `resync` events). */
export function useProjectEvents(projectId: string | null | undefined, onEvent: Listener, enabled = true) {
  const client = useApolloClient();
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!projectId || !enabled || typeof window === "undefined") return;
    let entry = streams.get(projectId);
    if (!entry) {
      entry = open(client, projectId);
      streams.set(projectId, entry);
    }
    const listener: Listener = (e) => handler.current(e);
    entry.listeners.add(listener);
    const mine = entry;
    return () => {
      mine.listeners.delete(listener);
      if (!mine.listeners.size) {
        mine.stop();
        if (streams.get(projectId) === mine) streams.delete(projectId);
      }
    };
  }, [client, projectId, enabled]);
}

/** Fired by the Apollo client when a dropped WebSocket connection was replaced (events may have been missed). */
export const REALTIME_RECONNECTED = "shotstash:realtime-reconnected";

/** Calls `onReconnect` after the realtime connection came back (refetch what may be stale). */
export function useRealtimeReconnect(onReconnect: () => void) {
  const handler = useRef(onReconnect);
  useEffect(() => {
    handler.current = onReconnect;
  }, [onReconnect]);
  useEffect(() => {
    const on = () => handler.current();
    window.addEventListener(REALTIME_RECONNECTED, on);
    return () => window.removeEventListener(REALTIME_RECONNECTED, on);
  }, []);
}
