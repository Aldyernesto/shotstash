"use client";

/**
 * Story 3.14 — SATU sumber kebenaran antrean upload.
 *
 * ============================================================
 * APA YANG DIHAPUS DI SINI
 * ============================================================
 * Berkas ini dulu membuat progres SIMULASI: `setInterval` 500 ms yang
 * menambah `Math.floor(Math.random() * 10) + 5` persen sampai 100, sama
 * sekali tidak terhubung ke antrean nyata di `UploadModal`. Angka yang
 * dilihat pengguna di panel kecil BUKAN kemajuan upload yang sebenarnya.
 *
 * Seluruh blok itu beserta angka acaknya dihapus. Gerbangnya terukur:
 *   grep -rn "setInterval" src/components/UploadContext.tsx
 * tidak menghasilkan satu pun baris kode aktif.
 *
 * ============================================================
 * KONTRAK
 * ============================================================
 * 1. SATU antrean. `upload-panel` (Story 3.12), `upload-row` +
 *    `batch-progress` (Story 3.13), dan `upload-dock` (Story 3.15)
 *    membaca dan menulis antrean YANG SAMA — jadi persentase dan jumlah
 *    file di semuanya selalu identik pada saat yang sama. Tidak ada
 *    state antrean kedua di komponen mana pun.
 * 2. Provider hidup di `src/app/dashboard/layout.tsx`, jadi navigasi
 *    client-side antar Section/Project/halaman TIDAK melepas state:
 *    upload tetap berjalan dan daftar barisnya tetap sama persis,
 *    termasuk baris yang sudah selesai dan baris yang gagal.
 * 3. `progress` datang dari potongan yang BENAR-BENAR terkirim.
 * 4. Baris gagal TETAP TERSIMPAN di antrean, tidak dibuang. Epic 4
 *    (FR30 / Story 4.9) cukup menyalakan tombolnya tanpa membongkar
 *    ulang state ini.
 * 5. Pengumuman POLITE dan per tahap (mulai, tiap file selesai, tiap
 *    file gagal, batch selesai) — bukan tiap persen — dan tidak pernah
 *    memindahkan fokus. Satu peristiwa diumumkan SEKALI walaupun tampil
 *    di dua permukaan (panel terbuka sekaligus dock tampil), karena
 *    live region-nya milik provider ini, bukan milik masing-masing
 *    permukaan.
 *
 * Story ini murni klien: `src/graphql/schema.ts`, `resolvers.ts`, dan
 * `prisma/schema.prisma` tidak disentuh; mutasi yang dipakai tetap
 * `initiateUpload` / `uploadChunk` / `completeUpload` yang sudah ada,
 * dan tiap mutasi itu tetap bergantung sesi valid di tabel `Session`.
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
import { gql, useMutation } from "@apollo/client";
import { readDropAsTrees, type DropNode } from "@/lib/dropTree";
import { useToast } from "@/components/feedback/ToastProvider";
import {
  classifyUploadError,
  humanizeTaskError,
  UPLOAD_REJECT,
  type UploadRejectCode,
  type UploadTask,
} from "@/components/upload/uploadTypes";

const INITIATE_UPLOAD = gql`
  mutation InitiateUpload($input: InitiateUploadInput!) {
    initiateUpload(input: $input) {
      id
      chunkSize
      totalChunks
      uploadMode
      presignedUrl
      r2Key
    }
  }
`;

const COMPLETE_UPLOAD = gql`
  mutation CompleteUpload($sessionId: ID!, $r2Key: String, $convertHeic: Boolean) {
    completeUpload(sessionId: $sessionId, r2Key: $r2Key, convertHeic: $convertHeic) {
      id
      filename
    }
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

export type UploadContextType = {
  tasks: UploadTask[];
  running: boolean;
  aborted: boolean;
  rejection: UploadRejectCode | null;
  setRejection: React.Dispatch<React.SetStateAction<UploadRejectCode | null>>;
  convertHeic: boolean | null;
  setConvertHeic: (v: boolean | null) => void;
  hasHeic: boolean;
  target: UploadTarget | null;
  panelOpen: boolean;
  minimized: boolean;
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
  start: () => Promise<UploadRejectCode | null>;
};

const UploadContext = createContext<UploadContextType | undefined>(undefined);

let taskSeq = 0;
const nextId = () => `t${++taskSeq}`;

export function UploadProvider({ children }: { children: ReactNode }) {
  const { pushToast } = useToast();
  // Portal live region baru dipasang SETELAH mount. `typeof document !==
  // "undefined"` adalah cabang server/klien: render pertama di klien sudah
  // berbeda dari HTML server dan seluruh pohon dashboard gagal hidrasi.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [running, setRunning] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [rejection, setRejection] = useState<UploadRejectCode | null>(null);
  const [convertHeic, setConvertHeic] = useState<boolean | null>(null);
  const [target, setTarget] = useState<UploadTarget | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // SATU live region untuk seluruh app: peristiwa yang sama tidak pernah
  // diumumkan dua kali walau tampil di panel DAN dock sekaligus.
  const [live, setLive] = useState("");

  const abortRef = useRef(false);
  const tasksRef = useRef<UploadTask[]>([]);
  tasksRef.current = tasks;
  const targetRef = useRef<UploadTarget | null>(null);
  targetRef.current = target;
  const convertRef = useRef<boolean | null>(null);
  convertRef.current = convertHeic;

  const [initiateUpload] = useMutation(INITIATE_UPLOAD);
  const [completeUpload] = useMutation(COMPLETE_UPLOAD);
  const [createFolder] = useMutation(CREATE_FOLDER);

  const patch = useCallback((id: string, d: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...d } : t)));
  }, []);

  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    setTasks((prev) => [
      ...prev,
      ...files.map((file) => ({ id: nextId(), file, progress: 0, status: "pending" as const })),
    ]);
  }, []);

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

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Seret folder → sub-Section baru, lalu file-filenya masuk antrean. */
  const addDrop = useCallback(
    async (dt: DataTransfer) => {
      const t = targetRef.current;
      if (!t) return;
      const trees = await readDropAsTrees(dt);
      const queued: UploadTask[] = [];

      const walk = async (node: DropNode, parentId: string | null, subName?: string) => {
        if (node.type === "file") {
          if (parentId) {
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
            variables: { projectId: t.projectId, name: node.name, parentId },
          });
          if (res.data?.createFolder?.id) newId = res.data.createFolder.id;
        } catch (err) {
          console.error(`Gagal membuat sub-Section "${node.name}":`, err);
        }
        for (const child of node.children) await walk(child, newId, node.name);
      };

      for (const tree of trees) await walk(tree, t.folderId);
      if (queued.length) setTasks((prev) => [...prev, ...queued]);
    },
    [createFolder],
  );

  const uploadOne = useCallback(
    async (task: UploadTask) => {
      const t = targetRef.current;
      if (!t) return;
      try {
        patch(task.id, { status: "uploading", progress: 0, error: undefined });

        const pingStart = Date.now();
        try {
          await fetch("/api/ping", { method: "GET" });
        } catch {
          /* latensi tidak diketahui — server memakai bawaan */
        }
        const latencyMs = Date.now() - pingStart;

        const { data } = await initiateUpload({
          variables: {
            input: {
              filename: task.file.name,
              totalSize: task.file.size,
              projectId: t.projectId,
              folderId: task.targetFolderId || t.folderId,
              clientLatencyMs: latencyMs,
            },
          },
        });

        const { id: sessionId, chunkSize, totalChunks, uploadMode, presignedUrl, r2Key } =
          data.initiateUpload;
        const token = localStorage.getItem("shotstash_token");
        const convert = convertRef.current !== false;

        // ---------- R2: unggah langsung ke edge ----------
        if (uploadMode === "r2" && presignedUrl) {
          patch(task.id, { progress: 50, status: "merging" });
          let lastErr: Error | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const putRes = await fetch(presignedUrl, {
                method: "PUT",
                body: task.file,
                headers: { "Content-Type": "application/octet-stream" },
              });
              if (!putRes.ok) throw new Error(`R2 upload failed: ${putRes.status}`);
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err as Error;
              if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            }
          }
          if (lastErr) throw lastErr;
          await completeUpload({ variables: { sessionId, r2Key, convertHeic: convert } });
          patch(task.id, { status: "success", progress: 100 });
          setLive(`${task.file.name} selesai.`);
          return;
        }

        // ---------- potongan 10 MB + 3x coba ulang otomatis ----------
        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, task.file.size);
          const chunk = task.file.slice(start, end);

          let lastErr: Error | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const formData = new FormData();
              formData.append("sessionId", sessionId);
              formData.append("chunkIndex", i.toString());
              formData.append("file", chunk);

              const res = await fetch("/api/upload/chunk", {
                method: "POST",
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: formData,
              });
              if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                throw new Error(errData.message || errData.error || `Chunk ${i} failed`);
              }
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err as Error;
              if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            }
          }
          if (lastErr) throw lastErr;

          // Persen dari potongan yang BENAR-BENAR terkirim.
          patch(task.id, { progress: Math.round(((i + 1) / totalChunks) * 100) });
        }

        patch(task.id, { status: "merging" });
        await completeUpload({ variables: { sessionId, convertHeic: convert } });
        patch(task.id, { status: "success", progress: 100 });
        setLive(`${task.file.name} selesai.`);
      } catch (err) {
        const code = classifyUploadError(err);
        // Baris gagal TETAP tersimpan di antrean.
        patch(task.id, { status: "error", error: humanizeTaskError(err) });
        setLive(`${task.file.name} gagal.`);
        if (code === "session") {
          // Sesi dicabut di tengah batch: file berikutnya berhenti
          // dijalankan dan aplikasi TIDAK crash.
          abortRef.current = true;
          setAborted(true);
          pushToast({ tone: "error", message: "Upload berhenti.", cause: UPLOAD_REJECT.session });
        } else {
          pushToast({ tone: "error", message: `${task.file.name} gagal diupload.`, cause: humanizeTaskError(err) });
        }
      }
    },
    [completeUpload, initiateUpload, patch, pushToast],
  );

  const start = useCallback(async (): Promise<UploadRejectCode | null> => {
    if (running) return null;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setRejection("offline");
      return "offline";
    }

    const pending = tasksRef.current.filter((t) => t.status === "pending");
    if (!pending.length) return null;

    // Batch yang tidak bisa dimulai SAMA SEKALI tidak menandai satu baris
    // pun gagal.
    try {
      await fetch("/api/ping", { method: "GET" });
    } catch {
      setRejection("offline");
      return "offline";
    }

    setRejection(null);
    setAborted(false);
    abortRef.current = false;
    setRunning(true);
    setLive(`Upload ${pending.length} file dimulai.`);

    const queue = [...pending];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) {
        if (abortRef.current) break;
        const next = queue.shift();
        if (next) await uploadOne(next);
      }
    });
    await Promise.all(workers);
    setRunning(false);
    setLive("Batch upload selesai.");
    return null;
  }, [running, uploadOne]);

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
    setConvertHeic(null);
    setAborted(false);
    abortRef.current = false;
    // Halaman yang sedang tampil memuat ulang Section tujuannya.
    window.dispatchEvent(new CustomEvent("mam:upload-done"));
  }, []);

  const hasHeic = useMemo(
    () => tasks.some((t) => /\.(heic|heif)$/i.test(t.file.name)),
    [tasks],
  );

  const value: UploadContextType = {
    tasks,
    running,
    aborted,
    rejection,
    setRejection,
    convertHeic,
    setConvertHeic,
    hasHeic,
    target,
    panelOpen,
    minimized,
    open,
    closePanel,
    finish,
    setMinimized,
    addFiles,
    addSeed,
    addDrop,
    removeTask,
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
