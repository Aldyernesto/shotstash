"use client";

/**
 * Stories 3.14 and 4.3: the ONE upload queue.
 *
 * Contract
 * 1. One queue. `upload-panel`, `upload-row`, `batch-progress` and
 *    `upload-dock` read and write the same state, so numbers always agree.
 * 2. The provider lives in `src/app/dashboard/layout.tsx`: navigating keeps
 *    uploads running and rows in place, failed rows included.
 * 3. Progress comes from bytes the server really received.
 * 4. Failed rows stay in the queue with Retry (and "Re-upload (n)").
 * 5. Announcements are polite and per stage (start, each file done or
 *    failed, batch done), never per percent, and never move focus.
 *
 * Story 4.3 transfer
 * - The server decides the part size; each file sends up to 3 parts at a
 *   time; a part is retried 5 times with exponential backoff and jitter;
 *   every part carries its MD5 (Content-MD5) and the whole-file MD5
 *   (hash-wasm, computed while the parts are read in order) is checked by
 *   the server at completion.
 * - Duplicates: before bytes are sent the server is asked for files of the
 *   project with the same name and size; only those files are hashed and
 *   asked about again by MD5. An exact match asks "Skip" (default) or
 *   "Upload anyway", optionally for all of them.
 * - Resume: every running upload is remembered in localStorage; after a
 *   reload the dock lists unfinished uploads and the user picks or drops the
 *   same file again (name, size and last-modified must match). Only the
 *   parts the server does not have yet are sent.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { gql, useApolloClient, useMutation } from "@apollo/client";
import { readDropAsTrees, type DropNode } from "@/lib/dropTree";
import { errorCodeOf, errorDetailsOf } from "@/lib/errorCodes";
import { useToast } from "@/components/feedback/ToastProvider";
import { useAuth } from "@/components/AuthContext";
import {
  PART_RETRIES,
  classifyUploadError,
  isRetryablePartError,
  matchesResume,
  retryDelayMs,
  type ResumeEntry,
  type UploadRejectCode,
  type UploadTask,
} from "@/components/upload/uploadTypes";
import {
  forgetUpload,
  hashFile,
  md5Of,
  putPart,
  readResumeEntries,
  rememberUpload,
  sleep,
  wholeFileHasher,
} from "@/components/upload/transfer";
import { useUploadFailureText } from "@/components/upload/useUploadFailureText";

const INITIATE_UPLOAD = gql`
  mutation InitiateUpload($input: InitiateUploadInput!) {
    initiateUpload(input: $input) {
      id
      fileId
      partSize
      partCount
      confirmedParts
    }
  }
`;

const UPLOAD_SESSION = gql`
  query UploadSession($id: ID!) {
    uploadSession(id: $id) {
      id
      status
      partSize
      partCount
      confirmedParts
      filename
      totalSize
      projectId
      folderId
    }
  }
`;

const CHECK_DUPLICATES = gql`
  query CheckDuplicates($projectId: ID!, $candidates: [DuplicateCandidateInput!]!) {
    checkDuplicates(projectId: $projectId, candidates: $candidates) {
      name
      size
      md5
      match
      existingFileId
      existingName
    }
  }
`;

const COMPLETE_UPLOAD = gql`
  mutation CompleteUpload($sessionId: ID!, $md5Checksum: String) {
    completeUpload(sessionId: $sessionId, md5Checksum: $md5Checksum) {
      id
      filename
    }
  }
`;

const CANCEL_UPLOAD = gql`
  mutation CancelUpload($sessionId: ID!) {
    cancelUpload(sessionId: $sessionId)
  }
`;

const CREATE_FOLDER = gql`
  mutation CreateFolder($projectId: ID!, $name: String!, $parentId: ID) {
    createFolder(projectId: $projectId, name: $name, parentId: $parentId) {
      id
      name
    }
  }
`;

/** Parts of one file in flight at once. */
const PARTS_PER_FILE = 3;
/** Files uploading at once. */
const FILES_AT_ONCE = 3;

/** Filter tipe otomatis Section foto / video (perilaku lama, dipertahankan). */
export function acceptForFolder(folderName: string): string {
  const name = (folderName || "").toLowerCase();
  if (name === "video") return "video/*";
  if (name === "photo") return "image/*,.heic,.heif,.raw,.cr2,.nef";
  return "";
}

export type UploadTarget = {
  projectId: string;
  folderId: string;
  folderName?: string | null;
  folderType?: string | null;
};

export type UploadSeed = { file: File; targetFolderId?: string; subSectionName?: string };

/** A duplicate waiting for the user's answer (the panel shows it instead of the queue). */
export type DuplicatePrompt = {
  taskId: string;
  name: string;
  existingName: string;
  /** Other duplicates still waiting after this one. */
  remaining: number;
};

export type UploadContextType = {
  tasks: UploadTask[];
  running: boolean;
  aborted: boolean;
  rejection: UploadRejectCode | null;
  setRejection: React.Dispatch<React.SetStateAction<UploadRejectCode | null>>;
  target: UploadTarget | null;
  panelOpen: boolean;
  minimized: boolean;
  duplicatePrompt: DuplicatePrompt | null;
  /** Answers the duplicate prompt; `all` applies the answer to every remaining duplicate. */
  answerDuplicate: (choice: "skip" | "upload", all: boolean) => void;
  /** Membuka panel dengan Section tujuan (dan isi awal, bila ada). */
  open: (target: UploadTarget, seed?: { files?: File[]; tasks?: UploadSeed[] }) => void;
  /** Menutup panel TANPA membatalkan batch dan tanpa menghapus riwayat. */
  closePanel: () => void;
  /** "Done": panel tertutup, antrean dikosongkan, Section dimuat ulang. */
  finish: () => void;
  setMinimized: (v: boolean) => void;
  addFiles: (files: File[]) => void;
  addSeed: (seed: UploadSeed[]) => void;
  addDrop: (dt: DataTransfer) => Promise<void>;
  removeTask: (id: string) => void;
  /** Failed row: send it again (a paused upload resumes where it stopped). */
  retryTask: (id: string) => void;
  /** Every failed row again ("Re-upload (n)"). */
  retryFailed: () => void;
  /** Duplicate row: upload it anyway. */
  uploadAnyway: (id: string) => void;
  /** Resume row: the file the user picked again. */
  pickResumeFile: (id: string, file: File) => void;
  start: () => Promise<UploadRejectCode | null>;
};

const UploadContext = createContext<UploadContextType | undefined>(undefined);

let taskSeq = 0;
const nextId = () => `t${++taskSeq}`;

function isAbort(err: unknown): boolean {
  return (err as { name?: string })?.name === "AbortError";
}

function bearer(): string | null {
  try {
    return localStorage.getItem("shotstash_token");
  } catch {
    return null;
  }
}

type Session = { id: string; partSize: number; partCount: number; confirmed: Set<number> };

export function UploadProvider({ children }: { children: ReactNode }) {
  const { pushToast } = useToast();
  const t = useTranslations("upload");
  const failureText = useUploadFailureText();
  const client = useApolloClient();
  const userId = useAuth().user?.id ?? null;
  const userRef = useRef<string | null>(null);
  useEffect(() => {
    userRef.current = userId;
  }, [userId]);
  /** Resume entries of the signed-in account (no account: nothing is remembered). */
  const remember = useCallback((entry: ResumeEntry) => {
    if (userRef.current) rememberUpload(userRef.current, entry);
  }, []);
  const forget = useCallback((sessionId: string) => {
    if (userRef.current) forgetUpload(userRef.current, sessionId);
  }, []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [running, setRunning] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [rejection, setRejection] = useState<UploadRejectCode | null>(null);
  const [target, setTarget] = useState<UploadTarget | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt | null>(null);
  // ONE live region for the whole app.
  const [live, setLive] = useState("");

  const abortRef = useRef(false);
  const tasksRef = useRef<UploadTask[]>([]);
  tasksRef.current = tasks;
  const targetRef = useRef<UploadTarget | null>(null);
  targetRef.current = target;
  const runningRef = useRef(false);
  const duplicateAnswer = useRef<((a: { choice: "skip" | "upload"; all: boolean }) => void) | null>(null);

  const [initiateUpload] = useMutation(INITIATE_UPLOAD);
  const [completeUpload] = useMutation(COMPLETE_UPLOAD);
  const [cancelUpload] = useMutation(CANCEL_UPLOAD);
  const [createFolder] = useMutation(CREATE_FOLDER);

  const patch = useCallback((id: string, d: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...d } : t)));
  }, []);

  /* ---------------- resume after a reload ---------------- */

  useEffect(() => {
    if (!userId) return;
    const entries = readResumeEntries(userId);
    if (!entries.length) return;
    let cancelled = false;
    (async () => {
      const rows: UploadTask[] = [];
      for (const e of entries) {
        try {
          const { data } = await client.query({ query: UPLOAD_SESSION, variables: { id: e.sessionId }, fetchPolicy: "no-cache" });
          const s = data?.uploadSession;
          // Still completing on the server: keep the entry, decide on a later visit.
          if (s?.status === "COMPLETING") continue;
          if (!s || s.status !== "IN_PROGRESS") {
            forgetUpload(userId, e.sessionId);
            continue;
          }
          rows.push({
            id: nextId(),
            file: null,
            progress: Math.round(((s.confirmedParts?.length ?? 0) / Math.max(1, s.partCount)) * 100),
            status: "paused",
            sessionId: e.sessionId,
            projectId: e.projectId,
            targetFolderId: e.folderId,
            resume: { ...e, confirmed: s.confirmedParts?.length ?? 0, partCount: s.partCount },
          });
        } catch (err) {
          // Another account's upload or one that is gone: drop it. Signed
          // out or offline: keep the entry for the next visit.
          const code = errorCodeOf(err);
          if (code === "FORBIDDEN" || code === "NOT_FOUND" || code === "UPLOAD_SESSION_NOT_FOUND") forgetUpload(userId, e.sessionId);
        }
      }
      if (cancelled || !rows.length) return;
      setTasks((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.sessionId === r.sessionId))]);
      setTarget((prev) =>
        prev ?? { projectId: rows[0].resume!.projectId, folderId: rows[0].resume!.folderId, folderName: rows[0].resume!.folderName },
      );
      setPanelOpen(true);
      setMinimized(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, userId]);

  /** Attaches files to paused rows they belong to; answers the files that matched none. */
  const attachToPaused = useCallback((files: File[]): File[] => {
    const rest: File[] = [];
    const paused = tasksRef.current.filter((t) => t.status === "paused" && t.resume);
    const used = new Set<string>();
    const updates: Record<string, File> = {};
    for (const file of files) {
      const row = paused.find((p) => !used.has(p.id) && matchesResume(file, p.resume!));
      if (row) {
        used.add(row.id);
        updates[row.id] = file;
      } else rest.push(file);
    }
    if (used.size) {
      setTasks((prev) => prev.map((t) => (updates[t.id] ? { ...t, file: updates[t.id], status: "pending" as const } : t)));
    }
    return rest;
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const rest = attachToPaused(files);
      if (!rest.length) return;
      setTasks((prev) => [...prev, ...rest.map((file) => ({ id: nextId(), file, progress: 0, status: "pending" as const }))]);
    },
    [attachToPaused],
  );

  const addSeed = useCallback((seed: UploadSeed[]) => {
    if (!seed.length) return;
    setTasks((prev) => [
      ...prev,
      ...seed.map((s) => ({
        id: nextId(),
        file: s.file,
        progress: 0,
        status: "pending" as const,
        targetFolderId: s.targetFolderId,
        subSectionName: s.subSectionName,
      })),
    ]);
  }, []);

  const removeTask = useCallback(
    (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (task?.sessionId && (task.status === "paused" || task.status === "error")) {
        forget(task.sessionId);
        cancelUpload({ variables: { sessionId: task.sessionId } }).catch(() => {});
      }
      setTasks((prev) => prev.filter((t) => t.id !== id));
    },
    [cancelUpload, forget],
  );

  const pickResumeFile = useCallback(
    (id: string, file: File) => {
      const row = tasksRef.current.find((t) => t.id === id);
      if (!row?.resume) return;
      if (matchesResume(file, row.resume)) {
        patch(id, { file, status: "pending", error: undefined });
        return;
      }
      // A different file: refused for this upload, offered as a new one.
      pushToast({ tone: "error", message: t("resume.mismatch", { name: row.resume.name }) });
      setTasks((prev) => [...prev, { id: nextId(), file, progress: 0, status: "pending" }]);
    },
    [patch, pushToast, t],
  );

  /** Seret folder → sub-Section baru, lalu file-filenya masuk antrean. */
  const addDrop = useCallback(
    async (dt: DataTransfer) => {
      const dest = targetRef.current;
      if (!dest) return;
      const trees = await readDropAsTrees(dt);
      const queued: UploadTask[] = [];
      const loose: File[] = [];

      const walk = async (node: DropNode, parentId: string | null, subName?: string) => {
        if (node.type === "file") {
          if (parentId === dest.folderId && !subName) loose.push(node.file);
          else if (parentId) {
            queued.push({
              id: nextId(),
              file: node.file,
              progress: 0,
              status: "pending",
              targetFolderId: parentId,
              subSectionName: subName,
            });
          }
          return;
        }
        let newId = parentId;
        try {
          const res = await createFolder({
            variables: { projectId: dest.projectId, name: node.name, parentId },
          });
          if (res.data?.createFolder?.id) newId = res.data.createFolder.id;
        } catch (err) {
          console.error(`Could not create sub-Section "${node.name}":`, err);
        }
        for (const child of node.children) await walk(child, newId, node.name);
      };

      for (const tree of trees) await walk(tree, dest.folderId);
      if (loose.length) addFiles(loose);
      if (queued.length) setTasks((prev) => [...prev, ...queued]);
    },
    [addFiles, createFolder],
  );

  /* ---------------- duplicates ---------------- */

  const askDuplicate = useCallback(
    (prompt: DuplicatePrompt) =>
      new Promise<{ choice: "skip" | "upload"; all: boolean }>((resolve) => {
        duplicateAnswer.current = resolve;
        setDuplicatePrompt(prompt);
        // The question needs the panel, even when it was minimised.
        setPanelOpen(true);
        setMinimized(false);
      }),
    [],
  );

  const answerDuplicate = useCallback((choice: "skip" | "upload", all: boolean) => {
    const resolve = duplicateAnswer.current;
    duplicateAnswer.current = null;
    setDuplicatePrompt(null);
    resolve?.({ choice, all });
  }, []);

  /**
   * Advisory pre-check: same name and size first, then MD5 for those files
   * only. Marks skipped rows and remembers the MD5 of hashed files.
   */
  const checkForDuplicates = useCallback(
    async (batch: UploadTask[]): Promise<Map<string, Partial<UploadTask>>> => {
      // What changed per row: the caller applies it to its own copy (state
      // updates land only with the next render).
      const changes = new Map<string, Partial<UploadTask>>();
      const change = (id: string, d: Partial<UploadTask>) => {
        changes.set(id, { ...changes.get(id), ...d });
        patch(id, d);
      };
      const dest = targetRef.current;
      if (!dest) return changes;
      const fresh = batch.filter((b) => b.file && !b.sessionId && !b.allowDuplicate);
      if (!fresh.length) return changes;
      const byName = new Map<string, UploadTask[]>();
      for (const task of fresh) {
        const key = `${task.file!.name}\u0000${task.file!.size}`;
        byName.set(key, [...(byName.get(key) ?? []), task]);
      }
      let nameHits: { name: string; size: number }[] = [];
      try {
        const { data } = await client.query({
          query: CHECK_DUPLICATES,
          variables: {
            projectId: dest.projectId,
            candidates: [...byName.values()].map((list) => ({ name: list[0].file!.name, size: list[0].file!.size })),
          },
          fetchPolicy: "no-cache",
        });
        nameHits = (data?.checkDuplicates ?? []).map((m: { name: string; size: number | string }) => ({ name: m.name, size: Number(m.size) }));
      } catch {
        return changes; // advisory: the server's index still decides at completion
      }
      const toHash = nameHits.flatMap((h) => byName.get(`${h.name}\u0000${h.size}`) ?? []);
      if (!toHash.length) return changes;

      const hashed: { task: UploadTask; md5: string }[] = [];
      for (const task of toHash) {
        patch(task.id, { status: "checking", progress: 0 });
        try {
          const md5 = await hashFile(task.file!, (f) => patch(task.id, { progress: Math.round(f * 100) }));
          change(task.id, { md5, status: "pending", progress: 0 });
          hashed.push({ task, md5 });
        } catch {
          patch(task.id, { status: "pending", progress: 0 });
        }
      }
      if (!hashed.length) return changes;
      let exact: { md5: string; existingName: string }[] = [];
      try {
        const { data } = await client.query({
          query: CHECK_DUPLICATES,
          variables: {
            projectId: dest.projectId,
            candidates: hashed.map((h) => ({ name: h.task.file!.name, size: h.task.file!.size, md5: h.md5 })),
          },
          fetchPolicy: "no-cache",
        });
        exact = (data?.checkDuplicates ?? []).filter((m: { match: string }) => m.match === "exact");
      } catch {
        return changes;
      }
      const dupes = hashed
        .map((h) => ({ ...h, existing: exact.find((e) => e.md5 === h.md5) }))
        .filter((h) => h.existing);
      let applyAll: "skip" | "upload" | null = null;
      for (let i = 0; i < dupes.length; i++) {
        const d = dupes[i];
        let choice = applyAll;
        if (!choice) {
          const answer = await askDuplicate({
            taskId: d.task.id,
            name: d.task.file!.name,
            existingName: d.existing!.existingName,
            remaining: dupes.length - i - 1,
          });
          choice = answer.choice;
          if (answer.all) applyAll = answer.choice;
        }
        if (choice === "skip") change(d.task.id, { status: "skipped", duplicateOf: d.existing!.existingName, progress: 0 });
        else change(d.task.id, { allowDuplicate: true, duplicateOf: d.existing!.existingName });
      }
      return changes;
    },
    [askDuplicate, client, patch],
  );

  /* ---------------- one file ---------------- */

  const openSession = useCallback(
    async (task: UploadTask, projectId: string, folderId: string): Promise<Session> => {
      if (task.sessionId) {
        try {
          const { data } = await client.query({ query: UPLOAD_SESSION, variables: { id: task.sessionId }, fetchPolicy: "no-cache" });
          const s = data?.uploadSession;
          if (s && s.status === "IN_PROGRESS") {
            return { id: s.id, partSize: s.partSize, partCount: s.partCount, confirmed: new Set<number>(s.confirmedParts ?? []) };
          }
        } catch {
          /* fall through to a new upload */
        }
        forget(task.sessionId);
      }
      const file = task.file!;
      const variables = {
        input: {
          filename: file.name,
          totalSize: file.size,
          projectId,
          folderId,
          ...(task.md5 ? { md5Checksum: task.md5 } : {}),
          ...(task.allowDuplicate ? { allowDuplicate: true } : {}),
        },
      };
      let data;
      for (let attempt = 0; ; attempt++) {
        try {
          ({ data } = await initiateUpload({ variables }));
          break;
        } catch (err) {
          // Too many uploads started at once: wait as long as the server says, then again.
          if (errorCodeOf(err) !== "RATE_LIMITED" || attempt >= 5) throw err;
          const after = Number(errorDetailsOf(err).retryAfter);
          await sleep((Number.isFinite(after) && after > 0 ? after : 5) * 1000);
        }
      }
      const s = data.initiateUpload;
      const entry: ResumeEntry = {
        sessionId: s.id,
        projectId,
        folderId,
        folderName: targetRef.current?.folderId === folderId ? targetRef.current?.folderName ?? null : task.subSectionName ?? null,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      };
      remember(entry);
      return { id: s.id, partSize: s.partSize, partCount: s.partCount, confirmed: new Set<number>() };
    },
    [client, initiateUpload, remember, forget],
  );

  const sendParts = useCallback(
    async (task: UploadTask, session: Session, signal: AbortSignal): Promise<string> => {
      const file = task.file!;
      const token = bearer();
      const hasher = task.md5 ? null : await wholeFileHasher();
      const loaded = new Map<number, number>();
      let confirmedBytes = 0;
      for (const n of session.confirmed) {
        confirmedBytes += Math.min(session.partSize, file.size - (n - 1) * session.partSize);
      }
      const report = () => {
        let bytes = confirmedBytes;
        for (const v of loaded.values()) bytes += v;
        const pct = file.size ? Math.min(99, Math.floor((bytes / file.size) * 100)) : 99;
        patch(task.id, { progress: pct });
      };
      report();

      const inFlight = new Set<Promise<void>>();
      let failure: unknown = null;

      const send = async (n: number, bytes: Uint8Array) => {
        const md5 = await md5Of(bytes);
        for (let attempt = 0; ; attempt++) {
          try {
            await putPart({
              sessionId: session.id,
              partNumber: n,
              bytes,
              md5Hex: md5,
              token,
              signal,
              onProgress: (b) => {
                loaded.set(n, b);
                report();
              },
            });
            loaded.delete(n);
            confirmedBytes += bytes.length;
            report();
            patch(task.id, { retryIn: undefined });
            return;
          } catch (err) {
            loaded.delete(n);
            if (isAbort(err) || !isRetryablePartError(err) || attempt >= PART_RETRIES) throw err;
            const after = Number((err as { retryAfter?: number }).retryAfter);
            const delay = Number.isFinite(after) && after > 0 ? after * 1000 : retryDelayMs(attempt);
            patch(task.id, { retryIn: Math.ceil(delay / 1000) });
            await sleep(delay, signal);
          }
        }
      };

      for (let n = 1; n <= session.partCount; n++) {
        if (failure) break;
        const start = (n - 1) * session.partSize;
        const have = session.confirmed.has(n);
        if (have && !hasher) continue;
        const bytes = new Uint8Array(await file.slice(start, Math.min(start + session.partSize, file.size)).arrayBuffer());
        hasher?.update(bytes);
        if (have) continue;
        while (inFlight.size >= PARTS_PER_FILE && !failure) await Promise.race(inFlight);
        if (failure) break;
        const p: Promise<void> = send(n, bytes)
          .catch((err) => {
            failure = failure ?? err;
          })
          .finally(() => inFlight.delete(p));
        inFlight.add(p);
      }
      await Promise.all(inFlight);
      if (failure) throw failure;
      return task.md5 ?? hasher!.hex();
    },
    [patch],
  );

  /**
   * After a lost or refused completion answer: polls the session (backoff
   * 2 s to 30 s, at most 30 min) until the server settles it. UNKNOWN when
   * it never answered within that time.
   */
  const waitForCompletion = useCallback(
    async (sessionId: string, signal: AbortSignal): Promise<"COMPLETED" | "FAILED" | "IN_PROGRESS" | "UNKNOWN"> => {
      const deadline = Date.now() + 30 * 60 * 1000;
      for (let attempt = 0; Date.now() < deadline; attempt++) {
        try {
          const { data } = await client.query({ query: UPLOAD_SESSION, variables: { id: sessionId }, fetchPolicy: "no-cache" });
          const status = data?.uploadSession?.status;
          if (status === "COMPLETED") return "COMPLETED";
          if (status === "IN_PROGRESS") return "IN_PROGRESS";
          if (!status || status === "FAILED" || status === "EXPIRED") return "FAILED";
        } catch (err) {
          if (errorCodeOf(err) === "FORBIDDEN") return "FAILED";
        }
        await sleep(Math.min(30_000, 2000 * 2 ** Math.min(attempt, 4)), signal);
      }
      return "UNKNOWN";
    },
    [client],
  );

  const uploadOne = useCallback(
    async (task: UploadTask) => {
      const dest = targetRef.current;
      if (!dest || !task.file) return;
      const controller = new AbortController();
      let sessionId = task.sessionId;
      // Once completion started, the server may still finish it: the resume
      // entry stays unless the server said how the session ended.
      let completing = false;
      let keepResume = false;
      try {
        patch(task.id, { status: "uploading", progress: 0, error: undefined, retryIn: undefined });
        const projectId = task.projectId ?? dest.projectId;
        const folderId = task.targetFolderId || dest.folderId;
        const session = await openSession(task, projectId, folderId);
        sessionId = session.id;
        patch(task.id, { sessionId: session.id });

        let md5 = await sendParts(task, session, controller.signal);
        completing = true;
        patch(task.id, { md5, status: "merging", progress: 100 });

        for (let attempt = 0; ; attempt++) {
          try {
            await completeUpload({ variables: { sessionId: session.id, md5Checksum: md5 } });
            break;
          } catch (err) {
            const code = errorCodeOf(err);
            if (code === "MISSING_PARTS" && attempt === 0) {
              // Parts the server lost (or never stored): send only those again.
              const again = await openSession({ ...task, sessionId: session.id }, projectId, folderId);
              patch(task.id, { status: "uploading" });
              md5 = await sendParts({ ...task, md5 }, again, controller.signal);
              patch(task.id, { status: "merging", progress: 100 });
              continue;
            }
            if (!code || code === "UPLOAD_SESSION_CLOSED" || code === "STORAGE_UNAVAILABLE" || code === "INTERNAL") {
              // The answer was lost, another attempt is completing, or the
              // server failed midway: ask the server how it ended before deciding.
              const outcome = await waitForCompletion(session.id, controller.signal);
              if (outcome === "COMPLETED") break;
              if (outcome === "IN_PROGRESS" && attempt < 5) {
                await sleep(retryDelayMs(attempt));
                continue; // completion is resumable: finish it
              }
              if (outcome === "UNKNOWN") keepResume = true;
            }
            throw err;
          }
        }
        forget(session.id);
        patch(task.id, { status: "success", progress: 100 });
        setLive(t("live.fileDone", { name: task.file.name }));
      } catch (err) {
        controller.abort();
        const failure = classifyUploadError(err);
        // A session that can still resume keeps its localStorage entry.
        const resumable =
          keepResume ||
          (completing && !["checksum", "duplicate", "missingFolder"].includes(failure.reason) && errorCodeOf(err) !== "UPLOAD_SESSION_CLOSED") ||
          failure.reason === "offline" || failure.reason === "generic" || failure.reason === "storage" || failure.reason === "rateLimited";
        if (sessionId && !resumable) forget(sessionId);
        patch(task.id, {
          status: "error",
          error: failure,
          retryIn: undefined,
          sessionId: resumable ? sessionId : undefined,
        });
        setLive(t("live.fileFailed", { name: task.file.name }));
        if (failure.reason === "session") {
          abortRef.current = true;
          setAborted(true);
          pushToast({ tone: "error", message: t("toast.stopped"), cause: failureText(failure) });
        } else if (failure.reason !== "duplicate") {
          pushToast({
            tone: "error",
            message: t("toast.fileFailed", { name: task.file.name }),
            cause: failureText(failure),
          });
        }
      }
    },
    [completeUpload, openSession, sendParts, patch, pushToast, t, failureText, forget, waitForCompletion],
  );

  const start = useCallback(async (): Promise<UploadRejectCode | null> => {
    if (runningRef.current) return null;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setRejection("offline");
      return "offline";
    }

    const pending = tasksRef.current.filter((t) => t.status === "pending" && t.file);
    if (!pending.length) return null;

    // A batch that cannot start at all marks no row as failed.
    try {
      await fetch("/api/ping", { method: "GET" });
    } catch {
      setRejection("offline");
      return "offline";
    }

    runningRef.current = true;
    setRejection(null);
    setAborted(false);
    abortRef.current = false;
    setRunning(true);
    setLive(t("live.batchStarted", { count: pending.length }));

    const changes = await checkForDuplicates(pending);

    const queue = pending.map((p) => ({ ...p, ...changes.get(p.id) })).filter((t) => t.status === "pending" && t.file);
    const workers = Array.from({ length: Math.min(FILES_AT_ONCE, queue.length) }, async () => {
      while (queue.length > 0) {
        if (abortRef.current) break;
        const next = queue.shift();
        if (next) await uploadOne(next);
      }
    });
    await Promise.all(workers);
    runningRef.current = false;
    setRunning(false);
    setLive(t("live.batchDone"));
    return null;
  }, [checkForDuplicates, uploadOne, t]);

  const retryTask = useCallback(
    (id: string) => {
      patch(id, { status: "pending", error: undefined, progress: 0 });
      // The state update lands before the next tick; start reads the ref.
      setTimeout(() => void start(), 0);
    },
    [patch, start],
  );

  const retryFailed = useCallback(() => {
    setTasks((prev) => prev.map((t) => (t.status === "error" && t.file ? { ...t, status: "pending" as const, error: undefined, progress: 0 } : t)));
    setTimeout(() => void start(), 0);
  }, [start]);

  const uploadAnyway = useCallback(
    (id: string) => {
      patch(id, { status: "pending", error: undefined, progress: 0, allowDuplicate: true, sessionId: undefined });
      setTimeout(() => void start(), 0);
    },
    [patch, start],
  );

  const open = useCallback(
    (next: UploadTarget, seed?: { files?: File[]; tasks?: UploadSeed[] }) => {
      setTarget(next);
      setPanelOpen(true);
      setMinimized(false);
      if (seed?.tasks?.length) addSeed(seed.tasks);
      else if (seed?.files?.length) addFiles(seed.files);
    },
    [addFiles, addSeed],
  );

  /** Menutup panel TIDAK membatalkan batch dan TIDAK menghapus riwayat. */
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const finish = useCallback(() => {
    setPanelOpen(false);
    setMinimized(false);
    setTasks([]);
    setRejection(null);
    setAborted(false);
    abortRef.current = false;
    // Halaman yang sedang tampil memuat ulang Section tujuannya.
    window.dispatchEvent(new CustomEvent("mam:upload-done"));
  }, []);

  const value: UploadContextType = {
    tasks,
    running,
    aborted,
    rejection,
    setRejection,
    target,
    panelOpen,
    minimized,
    duplicatePrompt,
    answerDuplicate,
    open,
    closePanel,
    finish,
    setMinimized,
    addFiles,
    addSeed,
    addDrop,
    removeTask,
    retryTask,
    retryFailed,
    uploadAnyway,
    pickResumeFile,
    start,
  };

  return (
    <UploadContext.Provider value={value}>
      {children}
      {/* Live region tunggal: pengumuman per tahap, polite, dan tidak
          pernah memindahkan fokus. */}
      {mounted
        ? createPortal(
            <p className="spine-visually-hidden" role="status">
              {live}
            </p>,
            document.body,
          )
        : null}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (context === undefined) {
    throw new Error("useUpload must be used within an UploadProvider");
  }
  return context;
}
