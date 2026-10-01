"use client";

/**
 * Story 3.17 — panel Diskusi project (`chat-panel`).
 *
 * MENGGANTIKAN wujud `src/components/ProjectChat.tsx`, bukan
 * perilakunya: riwayat tetap per **Project**, pengiriman tetap realtime
 * lewat langganan yang sama, feed tetap tergulir ke pesan terbaru, dan
 * Enter tetap mengirim.
 *
 * Story 4.1 (FR28): `sender { id name role avatarUrl }` diminta di ketiga
 * dokumen GraphQL dan `role-chip` berlabel utuh mengisi slot `.msgWho`
 * di samping nama — role tidak pernah disampaikan lewat warna nama saja.
 * Pengirim tanpa `role` (terhapus) tampil nama saja, tanpa chip kosong.
 *
 * Story 4.3 (FR27): mention "@" + lampiran file.
 *   - `mention-dropdown` menempel di atas komposer, maks 6 baris, urutan
 *     PROJECT → SECTION → FILE; hasil dari query yang SUDAH ADA
 *     (`searchFolders` / `searchFiles` dengan `projectId` project ini) +
 *     Project itu sendiri bila namanya cocok. Pola SAMA dengan Chat
 *     Monitor: dropdown tertutup begitu kata setelah "@" mengandung spasi.
 *   - PROJECT/SECTION/FILE → teks "@…" diganti tag `@[type:id:parentId:Nama]`
 *     (util `encodeMentionTag`) yang tampil sebagai `mention-chip`; FILE
 *     juga memasang `attachment-chip` di tray dan mengisi `referencedFileId`
 *     (satu lampiran per pesan — memilih file kedua menggantikan chip).
 *   - Gagal kirim: teks TETAP di kolom tulis, chip lampiran TETAP terpasang.
 *   - Esc saat dropdown terbuka menutup dropdown saja (lapisan non-modal
 *     di atas lapisan panel — `modalStack` menangkap Esc di fase capture,
 *     jadi `stopPropagation` di komposer saja tidak cukup).
 *   Langganan realtime dinyalakan di server (`server.ts`, Story 4.1):
 *   pesan pengguna lain masuk tanpa muat ulang (Story 5.5: lewat `projectEvents`).
 *
 * Story 5.5: messages arrive through the shared `projectEvents` stream
 * (permission-checked per event on the server, deduplicated by seq here)
 * and the list is kept in (createdAt, id) order, the order the history
 * query uses, so every reader sees the same order live and after a reload.
 * The mention dropdown also lists people who may view the Project
 * (`mentionPeople`); picking one inserts "@handle", which notifies them.
 *
 * CATATAN perbaikan: `ProjectChat.tsx` lama meminta `referencedFile.category`,
 * padahal `MediaFile` di `src/graphql/schema.ts` TIDAK punya field itu —
 * seluruh query gagal validasi, jadi riwayat diskusi tidak pernah termuat.
 * Field itu dibuang di sini; komponen memang tidak pernah memakainya.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useApolloClient, gql } from "@apollo/client";
import styles from "./chatPanel.module.css";
import { ChatComposer } from "./ChatComposer";
import { ProjectTag, RoleChip, AttachmentChip, MentionText } from "./chips";
import { MENTION_LIMIT, type MentionOption } from "./MentionDropdown";
import { PillButton } from "@/components/form/buttons";
import { useFocusTrap, useModalLayer } from "@/components/overlay/modalStack";
import { useTranslations } from "next-intl";
import { useToast, useHumanizeError } from "@/components/feedback/ToastProvider";
import { useFormat } from "@/i18n/useFormat";
import { encodeMentionTag, type MentionTagType } from "@/lib/mentions";
import { compareChat, insertOrdered } from "@/lib/realtimeSeq";
import { useProjectEvents, useRealtimeReconnect } from "@/components/realtime/useProjectEvents";
import { CHAT_FIELDS } from "@/components/realtime/fields";
import type { MentionTargetType } from "./chips";

const GET_PROJECT_CHATS = gql`
  query GetProjectChats($projectId: ID!) {
    project(id: $projectId) {
      id
      chats {
        ${CHAT_FIELDS}
      }
    }
  }
`;

const SEND_MESSAGE = gql`
  mutation SendMessage($projectId: ID!, $message: String!, $referencedFileId: ID) {
    sendMessage(projectId: $projectId, message: $message, referencedFileId: $referencedFileId) {
      ${CHAT_FIELDS}
    }
  }
`;

/* Story 4.3: pencarian mention — HANYA query yang sudah ada di skema,
   dibatasi ke project yang sedang dibuka. Satu dokumen = satu permintaan. */
const MENTION_SEARCH = gql`
  query ProjectMentionSearch($q: String!, $projectId: ID!) {
    mentionPeople(projectId: $projectId, query: $q) {
      id
      name
      handle
      role
    }
    searchFolders(query: $q, projectId: $projectId) {
      id
      name
      totalFiles
    }
    searchFiles(query: $q, projectId: $projectId) {
      id
      originalName
      mimeType
    }
  }
`;

type ChatMessage = {
  id: string;
  seq?: number;
  message: string;
  /** Null for a person's message; "upload" for the system line of a finished upload. */
  kind?: string | null;
  createdAt: string;
  sender?: { id?: string; name: string; role?: string | null; avatarUrl?: string | null } | null;
  referencedFile?: { id?: string; originalName: string } | null;
};

type Attachment = { id: string; name: string };

/** Jeda ketik sebelum mencari — database dev PGlite berkolam satu koneksi. */
const MENTION_DEBOUNCE_MS = 180;

const CHAT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

/** File kind for the dropdown meta (a message key), never the raw mime type. */
function fileKind(mimeType?: string | null): "video" | "photo" | "audio" | "document" {
  const m = String(mimeType || "");
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "photo";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

const CHIP_TO_TAG: Record<MentionTargetType, MentionTagType> = {
  PROJECT: "project",
  SECTION: "folder",
  FILE: "file",
};

export type ChatPanelProps = {
  projectId: string;
  projectTitle?: string | null;
  isOpen: boolean;
  onClose: () => void;
};

export default function ChatPanel({ projectId, projectTitle, isOpen, onClose }: ChatPanelProps) {
  const t = useTranslations("chat");
  const f = useFormat();
  const humanizeError = useHumanizeError();
  const [message, setMessage] = useState("");
  /** Pesan yang sedang menunggu balasan server (kartu redup "mengirim…"). */
  const [pending, setPending] = useState<{ text: string; attachment: string | null } | null>(null);
  /** Satu lampiran per pesan (mutasi hanya punya satu `referencedFileId`). */
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  /** Kata setelah "@" yang sedang dicari; null = dropdown tertutup. */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  /** Nomor urut pencarian — balasan yang sudah basi dibuang. */
  const lookupSeq = useRef(0);
  const { pushToast } = useToast();
  const client = useApolloClient();

  const { data, loading, error, refetch } = useQuery(GET_PROJECT_CHATS, {
    variables: { projectId },
    skip: !isOpen,
  });

  const [sendMessage] = useMutation(SEND_MESSAGE);

  const mentionOpen = mentionQuery !== null && mentionOptions.length > 0;

  // Esc menutup panel — satu tingkat per tekan, lewat tumpukan bersama.
  useModalLayer(onClose, { modal: true, enabled: isOpen });
  // Dropdown mention terbuka = lapisan NON-modal di atas panel: Esc menutup
  // dropdown dulu (teks tetap), tekan lagi baru menutup panel.
  useModalLayer(
    () => {
      setMentionQuery(null);
      setMentionOptions([]);
    },
    { modal: false, enabled: isOpen && mentionOpen },
  );
  // Fokus terkunci di panel; saat tutup fokus kembali PERSIS ke tombol
  // "Diskusi project" yang membukanya.
  useFocusTrap(panelRef, { active: isOpen });

  // Story 5.5: live messages from the Project's event stream, merged in
  // (createdAt, id) order; a message already in the list is replaced, never doubled.
  useProjectEvents(
    projectId,
    (event) => {
      if (event.type !== "chat.created" || !event.chat) return;
      const fresh = event.chat as ChatMessage;
      client.cache.updateQuery({ query: GET_PROJECT_CHATS, variables: { projectId } }, (prev: any) => {
        if (!prev?.project) return prev;
        return { ...prev, project: { ...prev.project, chats: insertOrdered(prev.project.chats ?? [], fresh) } };
      });
    },
    isOpen,
  );
  // After a reconnect the stream may have missed messages: reload the history.
  useRealtimeReconnect(() => {
    if (isOpen) refetch().catch(() => undefined);
  });

  // Feed tergulir otomatis ke pesan terbaru.
  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [isOpen, data, pending]);

  // HP: `bottom-bar` tertutup selama panel terbuka (AC 3.17) — atribut yang
  // sama pola dengan `bulk-bar` Story 2.13, satu tempat saja.
  useEffect(() => {
    if (!isOpen) return;
    document.documentElement.dataset.mamChatsheet = "1";
    return () => {
      delete document.documentElement.dataset.mamChatsheet;
    };
  }, [isOpen]);

  // HP: tinggi sheet mengikuti visualViewport supaya kolom tulis menempel
  // di ATAS keyboard alih-alih tertutup olehnya.
  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    const sync = () => {
      document.documentElement.style.setProperty(
        "--mam-chat-vh",
        `${Math.round(vv?.height ?? window.innerHeight)}px`,
      );
    };
    sync();
    vv?.addEventListener("resize", sync);
    window.addEventListener("resize", sync);
    return () => {
      vv?.removeEventListener("resize", sync);
      window.removeEventListener("resize", sync);
      document.documentElement.style.removeProperty("--mam-chat-vh");
    };
  }, [isOpen]);

  // Tombol back Android menutup panel, bukan meninggalkan halaman.
  useEffect(() => {
    if (!isOpen) return;
    window.history.pushState({ mamChat: 1 }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Entri sendiri dibersihkan hanya bila memang masih milik panel.
      if (window.history.state?.mamChat) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Panel ditutup → dropdown & pencarian tertunda ikut dibersihkan.
  useEffect(() => {
    if (isOpen) return;
    setMentionQuery(null);
    setMentionOptions([]);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, [isOpen]);

  /* ---------------- mention "@" ---------------- */

  const lookupMentions = useCallback(
    async (term: string) => {
      const seq = ++lookupSeq.current;
      try {
        const { data: res } = await client.query({
          query: MENTION_SEARCH,
          variables: { q: term, projectId },
          fetchPolicy: "network-only",
        });
        if (seq !== lookupSeq.current) return; // balasan basi
        const needle = term.toLowerCase();
        const options: MentionOption[] = [];
        for (const person of (res?.mentionPeople ?? []) as { id: string; name: string; handle: string }[]) {
          // The meta shows what will be written: "@handle".
          options.push({ id: person.id, type: "PERSON", name: person.name, handle: person.handle, meta: `@${person.handle}` });
        }
        if (projectTitle && projectTitle.toLowerCase().includes(needle)) {
          options.push({ id: projectId, type: "PROJECT", name: projectTitle });
        }
        for (const s of (res?.searchFolders ?? []) as { id: string; name: string; totalFiles?: number }[]) {
          options.push({
            id: s.id,
            type: "SECTION",
            name: s.name,
            meta: typeof s.totalFiles === "number" ? t("files", { count: s.totalFiles }) : undefined,
          });
        }
        for (const file of (res?.searchFiles ?? []) as { id: string; originalName: string; mimeType?: string }[]) {
          options.push({ id: file.id, type: "FILE", name: file.originalName, meta: t(`fileKind.${fileKind(file.mimeType)}`) });
        }
        setMentionOptions(options.slice(0, MENTION_LIMIT));
      } catch {
        // Sesi dicabut / jaringan gagal: dropdown hanya tertutup, tanpa
        // menyisipkan apa pun dan tanpa teks error mentah (pola global
        // "Sesi dicabut" ditangani errorLink Apollo).
        if (seq !== lookupSeq.current) return;
        setMentionQuery(null);
        setMentionOptions([]);
      }
    },
    [client, projectId, projectTitle, t],
  );

  const closeMentions = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    lookupSeq.current++;
    setMentionQuery(null);
    setMentionOptions([]);
  };

  const handleChange = (value: string) => {
    setMessage(value);
    const at = value.lastIndexOf("@");
    const term = at >= 0 ? value.slice(at + 1) : "";
    if (at >= 0 && !term.includes(" ")) {
      setMentionQuery(term);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => void lookupMentions(term), MENTION_DEBOUNCE_MS);
    } else {
      closeMentions();
    }
  };

  const pickMention = (option: MentionOption) => {
    // Story 5.5: a person is mentioned by "@handle" (plain text the server
    // matches); Projects, Sections and files by a tag, as Chat Monitor writes it.
    const encoded =
      option.type === "PERSON"
        ? `@${option.handle ?? option.name}`
        : encodeMentionTag(CHIP_TO_TAG[option.type], option.id, projectId, option.name);
    const at = message.lastIndexOf("@");
    setMessage((at >= 0 ? message.slice(0, at) : message) + encoded + " ");
    if (option.type === "FILE") setAttachment({ id: option.id, name: option.name });
    closeMentions();
    inputRef.current?.focus();
  };

  if (!isOpen) return null;

  // Story 5.5: always in (createdAt, id) order, whatever arrived when.
  const chats: ChatMessage[] = [...((data?.project?.chats ?? []) as ChatMessage[])].sort(compareChat);
  const count = chats.length + (pending ? 1 : 0);
  const failedToLoad = Boolean(error) && !data;

  const handleSend = async () => {
    const text = message.trim();
    // Kiriman kedua diabaikan selama yang pertama belum dijawab.
    if (!text || pending) return;
    const att = attachment;
    setPending({ text, attachment: att?.name ?? null });
    setMessage("");
    closeMentions();
    try {
      await sendMessage({
        variables: { projectId, message: text, ...(att ? { referencedFileId: att.id } : {}) },
        // Balasan server ditulis ke cache supaya kartu tampil seketika;
        // langganan yang sama tetap membuang duplikat lewat id.
        update: (cache, { data: sent }) => {
          const fresh = sent?.sendMessage;
          if (!fresh) return;
          const prev: any = cache.readQuery({
            query: GET_PROJECT_CHATS,
            variables: { projectId },
          });
          if (!prev?.project) return;
          const list = prev.project.chats ?? [];
          if (list.some((c: ChatMessage) => c.id === fresh.id)) return;
          cache.writeQuery({
            query: GET_PROJECT_CHATS,
            variables: { projectId },
            data: { ...prev, project: { ...prev.project, chats: insertOrdered(list, fresh) } },
          });
        },
      });
      setPending(null);
      // Chip lampiran hilang HANYA setelah pesan terkirim.
      setAttachment(null);
    } catch (err) {
      setPending(null);
      // Teks TETAP di kolom tulis dan lampiran TETAP terpasang supaya bisa
      // dikirim ulang.
      setMessage(text);
      pushToast({
        tone: "error",
        message: t("sendFailed"),
        cause: humanizeError(err),
      });
    }
  };

  const feedState = failedToLoad || (!loading && chats.length === 0 && !pending)
    ? styles.feedCentered
    : loading && chats.length === 0
      ? styles.feedTop
      : "";

  return (
    <>
      <div className={styles.scrim} aria-hidden="true" onMouseDown={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className={styles.panel}
      >
        <div className={styles.head}>
          <div className={styles.headMain}>
            <div style={{ minWidth: 0 }}>
              <h2 className={`spine-display-button ${styles.title}`}>{t("title")}</h2>
              <div className={styles.sub}>
                {projectTitle ? (
                  <ProjectTag name={projectTitle} href={`/dashboard?p=${projectId}`} />
                ) : null}
                <span className={`spine-footnote ${styles.count}`}>{t("messageCount", { count })}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            className={`spine-focus-ring spine-hit-area ${styles.iconBtn}`}
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className={`${styles.feed} ${feedState}`}
          role="log"
          aria-live="polite"
          aria-label={t("feed")}
          aria-busy={loading || undefined}
        >
          {failedToLoad ? (
            <div className={styles.errorBox} role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.5v.01" />
              </svg>
              <div>
                <b className={`spine-row-title ${styles.errorTitle}`}>{t("loadFailed")}</b>
                <span className={`spine-footnote ${styles.errorCause}`}>{humanizeError(error)}</span>
                <PillButton
                  variant="surface"
                  className={styles.errorRetry}
                  onClick={() => {
                    refetch().catch(() => undefined);
                  }}
                >
                  {t("retry")}
                </PillButton>
              </div>
            </div>
          ) : loading && chats.length === 0 ? (
            <>
              <p className={`spine-body-sm ${styles.loadingText}`}>{t("loading")}</p>
              {[0, 1, 2].map((i) => (
                <div key={i} className={styles.skeleton} aria-hidden="true">
                  <i style={{ width: "40%" }} />
                  <i style={{ width: "90%" }} />
                  <i style={{ width: "70%" }} />
                </div>
              ))}
            </>
          ) : chats.length === 0 && !pending ? (
            <div className={styles.empty}>
              <div className={styles.emptyTile} aria-hidden="true">
                {CHAT_ICON}
              </div>
              <h3 className={`spine-display-panel-mobile ${styles.emptyTitle}`}>{t("emptyTitle")}</h3>
              <p className={`spine-body ${styles.emptyText}`}>{t("emptyText")}</p>
            </div>
          ) : (
            <>
              {chats.map((chat) =>
                chat.kind === "upload" ? (
                  <article key={chat.id} className={`${styles.msg} ${styles.msgSystem}`}>
                    <p className={`spine-footnote ${styles.msgSystemText}`}>
                      {chat.referencedFile?.originalName
                        ? t("system.upload", {
                            name: chat.sender?.name || t("system.someone"),
                            fileName: chat.referencedFile.originalName,
                          })
                        : chat.message}
                    </p>
                    <span className={`spine-footnote ${styles.msgTime}`}>{f.relative(chat.createdAt)}</span>
                  </article>
                ) : (
                <article key={chat.id} className={styles.msg}>
                  <div className={styles.msgHead}>
                    <span className={`spine-row-title ${styles.msgWho}`}>
                      <span className={styles.msgName}>{chat.sender?.name}</span>
                      {/* Label role UTUH di samping nama (Story 4.1). Tanpa
                          `role` (pengirim terhapus) tidak ada chip sama sekali —
                          bukan chip kosong atau "undefined". */}
                      {chat.sender?.role ? <RoleChip role={chat.sender.role} /> : null}
                    </span>
                    {/* Waktu RELATIF ("baru saja", "5 mnt", "2 jam", lalu tanggal) —
                        util Story 1.9 yang sama dengan Chat Monitor, bukan jam
                        absolut "14.55" (AC 4.1 + mock `.tm`). */}
                    <span className={`spine-footnote ${styles.msgTime}`}>{f.relative(chat.createdAt)}</span>
                  </div>
                  <p className={`spine-body ${styles.msgBody}`}>
                    <MentionText message={chat.message} />
                  </p>
                  {chat.referencedFile ? (
                    <div className={styles.msgFoot}>
                      <AttachmentChip name={chat.referencedFile.originalName} />
                    </div>
                  ) : null}
                </article>
                ),
              )}
              {pending ? (
                <article className={`${styles.msg} ${styles.msgSending}`}>
                  <div className={styles.msgHead}>
                    <span className={`spine-row-title ${styles.msgWho}`}>
                      <span className={styles.msgName}>{t("you")}</span>
                    </span>
                    <span className={`spine-footnote ${styles.msgTime}`}>{t("sending")}</span>
                  </div>
                  <p className={`spine-body ${styles.msgBody}`}>
                    <MentionText message={pending.text} />
                  </p>
                  {pending.attachment ? (
                    <div className={styles.msgFoot}>
                      <AttachmentChip name={pending.attachment} />
                    </div>
                  ) : null}
                </article>
              ) : null}
            </>
          )}
          <div ref={endRef} />
        </div>

        <ChatComposer
          className={styles.composer}
          value={message}
          onChange={handleChange}
          onSend={() => void handleSend()}
          placeholder={t("placeholder")}
          busy={Boolean(pending)}
          disabled={failedToLoad}
          inputRef={inputRef}
          attachments={
            attachment ? (
              <AttachmentChip name={attachment.name} onRemove={() => setAttachment(null)} />
            ) : undefined
          }
          mentions={
            mentionQuery !== null
              ? {
                  query: mentionQuery,
                  options: mentionOptions,
                  onPick: pickMention,
                  onDismiss: closeMentions,
                }
              : null
          }
        />
      </aside>
    </>
  );
}
