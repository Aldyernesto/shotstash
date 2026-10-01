"use client";

/**
 * Story 5.5: one `projectEvents` subscription per Project, shared by every
 * component that listens (the library grid, the viewer, the discussion
 * panel). Each event passed the server's per-event `can()` check; here the
 * client drops anything older than what it has seen for that entity
 * (`createSeqGate`), so a late or repeated event never rolls the UI back.
 */
import { useEffect, useRef } from "react";
import { gql, useApolloClient, type ApolloClient } from "@apollo/client";
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
  type: "chat.created" | "job.updated" | string;
  id: string;
  seq: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chat?: any;
  job?: UiJob | null;
};

type Listener = (event: ProjectEvent) => void;

type Entry = { listeners: Set<Listener>; gate: SeqGate; stop: () => void };

const streams = new Map<string, Entry>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function open(client: ApolloClient<any>, projectId: string): Entry {
  const listeners = new Set<Listener>();
  const gate = createSeqGate();
  const sub = client.subscribe<{ projectEvents: ProjectEvent }>({ query: PROJECT_EVENTS, variables: { projectId } }).subscribe({
    next: ({ data }) => {
      const event = data?.projectEvents;
      if (!event) return;
      const seq = event.job ? Number(event.job.seq) : Number(event.seq);
      if (!gate.accept(`${event.type}:${event.id}`, seq)) return;
      for (const l of [...listeners]) l(event);
    },
    error: () => {
      // The stream ended (session revoked, network): forget it so the next
      // listener opens a fresh one.
      if (streams.get(projectId)?.listeners === listeners) streams.delete(projectId);
    },
  });
  return { listeners, gate, stop: () => sub.unsubscribe() };
}

/** Calls `onEvent` for every new event of the Project while mounted. */
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

/** Fired by the Apollo client when the WebSocket reconnected (events may have been missed). */
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
