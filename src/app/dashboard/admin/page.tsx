"use client";

import React, { useRef, useState } from "react";
import { useQuery, useMutation } from "@apollo/client";
import { gql } from "@apollo/client";
import styles from "./page.module.css";
import { useAuth } from "@/components/AuthContext";
// Story 2.18: gerbang Admin Panel dari modul bersama.
import { canOpenAdminPanel, hasPermission, isSuperAdmin } from "@/lib/permissions";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
// Story 3.18: lapisan bersama — `dialog`/`confirm-sheet`, `notice-bar`,
// `button-danger`, dan util format Indonesia. TIDAK dibangun ulang di sini.
import { ConfirmDialog } from "@/components/overlay/Dialog";
import { NoticeBar } from "@/components/form/FormAlert";
import { ButtonDanger, PillButton } from "@/components/form/buttons";
import { StatusChip } from "@/components/form/StatusChip";
// Story 3.20: `dialog` + isian bakunya (`radio-card`, `info-note`,
// `one-time-secret`) dan `form-alert` — semuanya dari lapisan bersama.
import { Dialog } from "@/components/overlay/Dialog";
import { RadioCardGroup, InfoNote, OneTimeSecret } from "@/components/overlay/fields";
import { FormAlert } from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import fieldStyles from "@/components/form/TextField.module.css";
import { useTranslations } from "next-intl";
import { useHumanizeError } from "@/components/feedback/ToastProvider";
import { useFormat } from "@/i18n/useFormat";
import { errorCodeOf } from "@/lib/errorCodes";

/** Chevron `select-pill` — elemen SVG supaya warnanya ikut tema. */
const CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const GET_USERS = gql`
  query GetUsers {
    users {
      id
      name
      email
      role
      active
      hasPassword
      createdAt
    }
  }
`;

const ADMIN_SET_PASSWORD = gql`
  mutation AdminSetPassword($userId: ID!, $newPassword: String) {
    adminSetPassword(userId: $userId, newPassword: $newPassword) {
      success
      message
      password
      errorCode
    }
  }
`;

const DELETE_USER = gql`
  mutation DeleteUser($id: ID!) {
    deleteUser(id: $id) {
      success
      errorCode
      uploads
      shareLinks
      chats
    }
  }
`;

const PENDING_USERS = gql`
  query PendingUsers {
    pendingUsers { id name email requestedRole signupAnswers createdAt }
  }
`;

const APPROVE_USER = gql`
  mutation ApproveUser($userId: ID!, $role: Role!) {
    approveUser(userId: $userId, role: $role) { id role accountStatus }
  }
`;

const REJECT_USER = gql`
  mutation RejectUser($userId: ID!) {
    rejectUser(userId: $userId) { id accountStatus }
  }
`;

const REGISTER = gql`
  mutation Register($input: CreateUserInput!) {
    register(input: $input) {
      success
      user { id name email role active }
      message
      errorCode
    }
  }
`;

const UPDATE_USER_ROLE = gql`
  mutation UpdateUserRole($userId: ID!, $role: Role!) {
    updateUserRole(userId: $userId, role: $role) {
      id
      role
    }
  }
`;

const DEACTIVATE_USER = gql`
  mutation DeactivateUser($id: ID!) {
    deactivateUser(id: $id) {
      id
      active
    }
  }
`;

const REACTIVATE_USER = gql`
  mutation ReactivateUser($id: ID!) {
    reactivateUser(id: $id) {
      id
      active
    }
  }
`;

const STORAGE_STATS = gql`
  query StorageStats {
    storageStats {
      totalSpace
      usedSpace
      freeSpace
      totalFiles
      totalProjects
    }
  }
`;

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  hasPassword: boolean;
  createdAt: string;
};

type Notice = { type: "success" | "error"; text: string };
type ResetResult = { password: string | null; googleOnly: boolean };

import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/passwordRule";

/** Server codes that mean "another admin already handled this sign-up". */
const ALREADY_HANDLED_CODES = ["USER_NOT_FOUND", "ALREADY_HANDLED"];

export default function AdminPanel() {
  const { user, isLoading } = useAuth();
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const tPw = useTranslations("password");
  const f = useFormat();
  const humanize = useHumanizeError();
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("EDITOR");
  const [createError, setCreateError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  /** Story 3.19: nilai `select-pill` role selagi permintaan berjalan —
      supaya bisa dikembalikan PERSIS bila server menolak. */
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  /** `notice-bar` danger untuk kegagalan aksi baris tabel. */
  const [tableNotice, setTableNotice] = useState<string | null>(null);

  const { data, loading, refetch } = useQuery(GET_USERS, {
    skip: !canOpenAdminPanel(user),
  });

  // ==== Pending approvals ====
  const {
    data: pendingData,
    loading: pendingLoading,
    error: pendingError,
    refetch: refetchPending,
  } = useQuery(PENDING_USERS, { fetchPolicy: 'cache-and-network' });
  const pendingUsers: any[] = pendingData?.pendingUsers || [];
  const [approveRole, setApproveRole] = useState<Record<string, string>>({});
  // Story 3.18: kartu HANYA hilang setelah server benar-benar membalas
  // berhasil — jadi tidak ada `onCompleted` yang memindahkan daftar lebih
  // dulu, dan tidak ada pembaruan optimistik yang dibiarkan menempel.
  const [approveUser] = useMutation(APPROVE_USER);
  const [rejectUser] = useMutation(REJECT_USER);
  /** Tombol mana yang sedang memproses, per pendaftar. */
  const [approvalBusy, setApprovalBusy] = useState<Record<string, "approve" | "reject" | undefined>>({});
  /** `notice-bar` danger DI DALAM panel "Menunggu Persetujuan". */
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);
  /** Pendaftar yang sedang dikonfirmasi penolakannya (`dialog` Story 3.1). */
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);

  /** Server code meaning "another admin already handled this sign-up". */
  const isAlreadyHandled = (err: unknown) => ALREADY_HANDLED_CODES.includes(errorCodeOf(err) ?? "");

  const runApproval = async (
    u: any,
    kind: "approve" | "reject",
    run: () => Promise<unknown>,
  ) => {
    if (approvalBusy[u.id]) return;
    setApprovalBusy((b) => ({ ...b, [u.id]: kind }));
    setApprovalNotice(null);
    try {
      await run();
      // Berhasil: daftar dimuat ulang, kartunya hilang karena server
      // memang sudah tidak mengembalikannya.
      await Promise.all([refetchPending(), refetch()]);
    } catch (err) {
      if (isAlreadyHandled(err)) {
        setApprovalNotice(t("pending.alreadyHandled", { email: u.email }));
        refetchPending().catch(() => undefined);
      } else {
        setApprovalNotice(
          kind === "approve"
            ? t("pending.approveFailed", { email: u.email, cause: humanize(err) })
            : t("pending.rejectFailed", { email: u.email, cause: humanize(err) }),
        );
      }
    } finally {
      // Tombol kembali ke labelnya semula; `aria-busy`/`aria-disabled`
      // dilepas, jadi aksinya bisa langsung diulang. Pilihan role di
      // `select-pill` TIDAK disentuh — admin tidak perlu memilih ulang.
      setApprovalBusy((b) => ({ ...b, [u.id]: undefined }));
    }
  };

  const parseAnswers = (raw: any) => {
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // Format baru: { role, answers: [{question, answer}] }. Lama: { questions: [...] }.
      const arr = o?.answers || o?.questions || [];
      return Array.isArray(arr) ? arr.filter((qa: any) => qa && (qa.answer ?? '') !== '') : [];
    } catch { return []; }
  };
  const fmtDate = (raw: any) => f.dateTime(raw);


  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery(STORAGE_STATS, {
    // Storage stats are instance configuration (super admin only).
    skip: !hasPermission(user, "instance.configure"),
  });

  const stats = statsData?.storageStats;

  const [registerUser, { loading: registerLoading }] = useMutation(REGISTER, {
    onCompleted: (data) => {
      if (data.register.success) {
        setShowCreateModal(false);
        setNewUserName("");
        setNewUserEmail("");
        setNewUserPassword("");
        setNewUserRole("EDITOR");
        setCreateError("");
        refetch();
      } else {
        setCreateError(
          data.register.errorCode ? humanize({ errorCode: data.register.errorCode }) : t("create.failed"),
        );
      }
    },
    onError: (err) => setCreateError(humanize(err)),
  });

  const [updateRole] = useMutation(UPDATE_USER_ROLE, {
    onCompleted: () => refetch(),
  });

  const [deactivateUser] = useMutation(DEACTIVATE_USER, {
    onCompleted: () => refetch(),
  });

  const [reactivateUser] = useMutation(REACTIVATE_USER, {
    onCompleted: () => refetch(),
  });

  // ==== Reset password & hapus akun ====
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  // Id target modal saat ini — respons adminSetPassword hanya dipakai kalau target belum berganti.
  const resetTargetIdRef = useRef<string | null>(null);
  const [resetMode, setResetMode] = useState<"auto" | "manual">("auto");
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  /** Kegagalan PERMINTAAN (bukan kesalahan isian) — `form-alert` di atas tombol. */
  const [resetFormError, setResetFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  // no-cache: password hasil generate tidak disimpan di cache Apollo.
  const [adminSetPassword, { loading: resetLoading }] = useMutation(ADMIN_SET_PASSWORD, { fetchPolicy: "no-cache" });
  const [deleteUserMutation, { loading: deleteLoading }] = useMutation(DELETE_USER, { fetchPolicy: "no-cache" });

  if (isLoading) return null;

  if (!user || !canOpenAdminPanel(user)) {
    if (typeof window !== "undefined") router.replace("/dashboard");
    return null;
  }

  const users: User[] = data?.users || [];
  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchRole = roleFilter === "ALL" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const handleCreateUser = () => {
    if (registerLoading) return;
    setCreateError("");
    registerUser({
      variables: {
        input: {
          name: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        },
      },
    });
  };

  // Story 3.19: nilai baris TIDAK pernah dibiarkan berubah sendiri.
  // `select-pill` dikendalikan `roleDraft` supaya, saat server menolak,
  // nilainya bisa dikembalikan PERSIS ke nilai sebelumnya.
  const handleRoleChange = async (u: User, role: string) => {
    const previous = u.role;
    setRoleDraft((d) => ({ ...d, [u.id]: role }));
    setTableNotice(null);
    try {
      await updateRole({ variables: { userId: u.id, role } });
      await refetch();
      setRoleDraft((d) => {
        const next = { ...d };
        delete next[u.id];
        return next;
      });
    } catch (err) {
      // Kembali ke nilai sebelumnya; barisnya tetap ada.
      setRoleDraft((d) => ({ ...d, [u.id]: previous }));
      setTableNotice(t("users.roleFailed", { name: u.name, cause: humanize(err) }));
    }
  };

  const handleToggleActive = async (u: User) => {
    if (rowBusy[u.id]) return;
    setRowBusy((b) => ({ ...b, [u.id]: true }));
    setTableNotice(null);
    try {
      if (u.active) {
        await deactivateUser({ variables: { id: u.id } });
      } else {
        await reactivateUser({ variables: { id: u.id } });
      }
      await refetch();
    } catch (err) {
      // Tidak ada perubahan optimistik yang dibiarkan menempel: nilai
      // baris memang hanya berasal dari server, jadi cukup beri tahu.
      setTableNotice(
        u.active
          ? t("users.deactivateFailed", { name: u.name, cause: humanize(err) })
          : t("users.activateFailed", { name: u.name, cause: humanize(err) }),
      );
    } finally {
      setRowBusy((b) => ({ ...b, [u.id]: false }));
    }
  };

  // Reset password & hapus hanya untuk user lain yang bukan SUPER_ADMIN (server juga menolak).
  const canManageAccount = (u: User) => u.id !== user.id && !isSuperAdmin(u);

  const openResetModal = (u: User) => {
    resetTargetIdRef.current = u.id;
    setResetTarget(u);
    setResetMode("auto");
    setResetPassword("");
    setResetError("");
    setResetFormError(null);
    setResetResult(null);
  };

  const closeResetModal = () => {
    // Jangan tutup saat request berjalan: password di server sudah berubah & hasilnya harus tampil.
    if (resetLoading) return;
    resetTargetIdRef.current = null;
    setResetTarget(null);
    setResetPassword("");
    setResetError("");
    setResetFormError(null);
    setResetResult(null);
  };

  const handleResetSubmit = async () => {
    if (!resetTarget || resetLoading) return;
    setResetError("");
    setResetFormError(null);
    const pwProblem = resetMode === "manual" ? passwordProblem(resetPassword) : null;
    if (pwProblem === "PASSWORD_TOO_LONG") {
      setResetError(tPw("tooLong", { max: MAX_PASSWORD_BYTES }));
      return;
    }
    if (pwProblem) {
      setResetError(tPw("tooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    const target = resetTarget;
    const stillCurrent = () => resetTargetIdRef.current === target.id;
    try {
      const { data: res } = await adminSetPassword({
        variables: { userId: target.id, newPassword: resetMode === "manual" ? resetPassword : null },
      });
      const result = res?.adminSetPassword;
      if (result?.success) {
        setNotice({ type: "success", text: t("reset.doneNotice", { email: target.email }) });
        refetch();
        if (!stillCurrent()) return; // the modal moved to another user: never show this result there
        setResetPassword("");
        setResetResult({ password: result.password ?? null, googleOnly: !target.hasPassword });
      } else if (stillCurrent()) {
        // Dialog TETAP terbuka dengan pilihan & isian utuh; tidak ada
        // `one-time-secret` yang dirender karena tidak ada password yang
        // benar-benar dibuat.
        setResetFormError(t("reset.failed", { cause: humanize({ errorCode: result?.errorCode ?? "INTERNAL" }) }));
      }
    } catch (err) {
      if (stillCurrent()) {
        setResetFormError(t("reset.failed", { cause: humanize(err) }));
      }
    }
  };

  /** Failed delete: an account with activity gets the way out ("Deactivate"). By code only. */
  const deleteFailedText = (
    target: User,
    reason: unknown,
    activity?: { uploads?: number | null; shareLinks?: number | null; chats?: number | null },
  ) => {
    if (errorCodeOf(reason) !== "USER_HAS_ACTIVITY") {
      return t("delete.failed", { email: target.email, cause: humanize(reason) });
    }
    // Only the non-zero parts, joined the locale's way ("3 uploads and 1 share link").
    const parts = (["uploads", "shareLinks", "chats"] as const)
      .filter((k) => (activity?.[k] ?? 0) > 0)
      .map((k) => t(`delete.activity.${k}`, { count: activity?.[k] ?? 0 }));
    if (!parts.length) return t("delete.hasActivity", { email: target.email });
    const list = new Intl.ListFormat(f.locale, { style: "long", type: "conjunction" }).format(parts);
    return t("delete.hasActivityCounts", { email: target.email, activity: list });
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setNotice(null);
    try {
      const { data: res } = await deleteUserMutation({ variables: { id: target.id } });
      const result = res?.deleteUser;
      if (result?.success) {
        setNotice({ type: "success", text: t("delete.done", { email: target.email }) });
        refetch();
        refetchPending();
      } else {
        // Server menolak karena akun punya jejak (upload, share link, chat).
        // Kalimatnya menawarkan JALAN KELUAR, bukan sekadar menolak.
        setNotice({
          type: "error",
          text: deleteFailedText(target, { errorCode: result?.errorCode ?? "INTERNAL" }, result ?? undefined),
        });
      }
    } catch (err) {
      setNotice({ type: "error", text: deleteFailedText(target, err) });
    }
  };

  return (
    <div className={styles.adminContainer}>
      <div className={styles.pageHead}>
        <h1 className={`spine-display-page ${styles.pageTitle}`}>{t("title")}</h1>
        <p className={`spine-body-sub ${styles.pageSub}`}>
          {t("subtitle")}
        </p>
      </div>

      {/* Panel "Menunggu Persetujuan" HANYA tampil bila ada pendaftaran. */}
      {pendingUsers.length > 0 && (
        <section className={`${styles.panel} ${styles.panelWait}`} aria-labelledby="admin-pending-title">
          <div className={styles.panelHead}>
            <h2 id="admin-pending-title" className={`spine-display-panel ${styles.panelTitle}`}>
              {t("pending.title")}
              <span className={`spine-display-sticker ${styles.countSticker}`}>
                {f.number(pendingUsers.length)}
              </span>
            </h2>
          </div>

          {approvalNotice && (
            <NoticeBar tone="danger" onClose={() => setApprovalNotice(null)}>
              {approvalNotice}
            </NoticeBar>
          )}

          <div className={styles.approvalGrid}>
            {pendingUsers.map((u: any) => {
              const answers = parseAnswers(u.signupAnswers);
              const selRole = approveRole[u.id] || u.requestedRole || 'EDITOR';
              const initials = ((u.name || u.email || '?').slice(0, 2)).toUpperCase();
              const busy = approvalBusy[u.id];
              const name = u.name || t("pending.noName");
              return (
                <article key={u.id} className={styles.approvalCard} aria-label={name}>
                  <div className={styles.apHead}>
                    <div className={styles.apWho}>
                      <span className={`spine-display-card ${styles.apAvatar}`} aria-hidden="true">{initials}</span>
                      <div style={{ minWidth: 0 }}>
                        <b className={`spine-row-title ${styles.apName}`}>{name}</b>
                        <span className={`spine-body-sm ${styles.apEmail}`}>{u.email}</span>
                        {u.createdAt && (
                          <span className={`spine-footnote ${styles.apDate}`}>{t("pending.signedUp", { date: fmtDate(u.createdAt) })}</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.apReq}>
                      <span className={`spine-label ${styles.tagPill}`}>
                        {t("pending.requested", { role: u.requestedRole ? f.role(u.requestedRole) : t("pending.notSet") })}
                      </span>
                      <span className={`spine-footnote ${styles.apCount}`}>{t("pending.answers", { count: answers.length })}</span>
                    </div>
                  </div>

                  {answers.length > 0 ? (
                    <div className={styles.apAnswers}>
                      {answers.map((qa: any, i: number) => (
                        <div key={i}>
                          <span className={`spine-footnote ${styles.apQ}`}>{qa.question}</span>
                          <span className={`spine-body-sm ${styles.apA}`}>{qa.answer || t("pending.noAnswer")}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={`spine-body-sm ${styles.apNoAnswers}`}>
                      {t("pending.noAnswers")}
                    </p>
                  )}

                  <div className={styles.apDecision}>
                    <span className={`spine-body-sm ${styles.apDecisionLabel}`} id={`ap-role-${u.id}`}>
                      {t("pending.approveAs")}
                    </span>
                    <span className={styles.selectWrap}>
                      <select
                        className={`spine-focus-ring ${styles.selectPill}`}
                        aria-label={t("pending.approveAsFor", { name })}
                        value={selRole}
                        onChange={(e) => setApproveRole((v) => ({ ...v, [u.id]: e.target.value }))}
                      >
                        {["EDITOR", "FIELD_CREW", "VIEWER", "ADMIN"].map((r) => (
                          <option key={r} value={r}>{f.role(r)}</option>
                        ))}
                      </select>
                      {CHEVRON}
                    </span>
                    <span className={styles.apSpacer} />
                    <PillButton
                      variant="accent"
                      busy={busy === 'approve'}
                      busyLabel={t("working")}
                      aria-label={t("pending.approveFor", { name })}
                      onClick={() =>
                        runApproval(u, 'approve', () =>
                          approveUser({ variables: { userId: u.id, role: selRole } }),
                        )
                      }
                    >
                      {t("pending.approve")}
                    </PillButton>
                    <ButtonDanger
                      variant="outline"
                      aria-busy={busy === 'reject' || undefined}
                      aria-disabled={busy === 'reject' || undefined}
                      aria-label={t("pending.rejectFor", { name })}
                      onClick={() => setRejectTarget(u)}
                    >
                      {busy === 'reject' ? t("working") : t("pending.reject")}
                    </ButtonDanger>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className={styles.panel} aria-labelledby="admin-users-title">
        <div className={styles.panelHead}>
          <h2 id="admin-users-title" className={`spine-display-panel ${styles.panelTitle}`}>
            {t("users.title")}
            <span className={`spine-display-sticker ${styles.countSticker}`}>
              {f.number(users.length)}
            </span>
          </h2>
          <PillButton variant="accent" onClick={() => setShowCreateModal(true)}>
            {t("users.add")}
          </PillButton>
        </div>

        {/* Hasil hapus/tambah akun. Sukses `role="status"`, gagal
            `role="alert"` — keduanya bertahan sampai ditutup ×. */}
        {notice && (
          <NoticeBar
            tone={notice.type === "error" ? "danger" : "ok"}
            closeLabel={t("closeNotice")}
            onClose={() => setNotice(null)}
          >
            {notice.text}
          </NoticeBar>
        )}

        {tableNotice && (
          <NoticeBar tone="danger" onClose={() => setTableNotice(null)}>
            {tableNotice}
          </NoticeBar>
        )}

        {/* search-pill + pemilih role */}
        <div className={styles.tools}>
          <input
            type="search"
            className={`spine-focus-ring ${styles.searchPill}`}
            placeholder={t("users.search")}
            aria-label={t("users.searchLabel")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className={styles.selectWrap}>
            <select
              className={`spine-focus-ring ${styles.selectPill} ${styles.filterPill}`}
              aria-label={t("users.filterLabel")}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="ALL">{t("users.allRoles")}</option>
              {["SUPER_ADMIN", "ADMIN", "EDITOR", "FIELD_CREW", "VIEWER"].map((r) => (
                <option key={r} value={r}>{f.role(r)}</option>
              ))}
            </select>
            {CHEVRON}
          </span>
        </div>

        <table className={styles.userTable}>
          <thead>
            <tr>
              <th scope="col" className="spine-label">{t("column.name")}</th>
              <th scope="col" className="spine-label">{t("column.email")}</th>
              <th scope="col" className="spine-label">{t("column.role")}</th>
              <th scope="col" className="spine-label">{t("column.status")}</th>
              <th scope="col" className="spine-label">{t("column.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={5} className={`spine-body ${styles.tableEmpty}`}>{t("users.loading")}</td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className={`spine-body ${styles.tableEmpty}`}>
                  {searchQuery || roleFilter !== "ALL" ? t("users.noMatch") : t("users.none")}
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const manageable = canManageAccount(u);
                const roleValue = roleDraft[u.id] ?? u.role;
                return (
                  <tr key={u.id}>
                    <td data-label={t("column.name")}>
                      <span className={`spine-row-title ${styles.userName}`}>
                        {u.name}
                        {/* google-badge: akun yang dibuat lewat Google. */}
                        {!u.hasPassword && (
                          <span className={styles.googleBadge}>
                            <svg viewBox="0 0 48 48" aria-hidden="true">
                              <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.6-4.5 6.4l6.9 5.3c4.1-3.8 6.6-9.3 6.6-15z" />
                              <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 41.3 15.4 46 24 46z" />
                              <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10z" />
                              <path fill="#EA4335" d="M24 10.7c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.6 29.9 2 24 2 15.4 2 8 6.7 4.4 14l7.1 5.5c1.8-5.3 6.7-8.8 12.5-8.8z" />
                            </svg>
                            {t("users.google")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label={t("column.email")} className={`spine-body-sm ${styles.userEmail}`}>{u.email}</td>
                    <td data-label={t("column.role")}>
                      <span className={styles.selectWrap}>
                        <select
                          className={`spine-focus-ring ${styles.selectPill}`}
                          aria-label={t("users.roleFor", { name: u.name })}
                          value={roleValue}
                          onChange={(e) => handleRoleChange(u, e.target.value)}
                        >
                          {["SUPER_ADMIN", "ADMIN", "EDITOR", "FIELD_CREW", "VIEWER"].map((r) => (
                            <option key={r} value={r}>{f.role(r)}</option>
                          ))}
                        </select>
                        {CHEVRON}
                      </span>
                    </td>
                    <td data-label={t("column.status")}>
                      <StatusChip tone={u.active ? "ok" : "danger"}>
                        {u.active ? t("users.active") : t("users.inactive")}
                      </StatusChip>
                    </td>
                    <td data-label={t("column.actions")}>
                      <div className={styles.rowActions}>
                        {/* Label membawa KEADAANNYA sekaligus nama barisnya. */}
                        <PillButton
                          variant="surface"
                          busy={rowBusy[u.id]}
                          busyLabel={t("working")}
                          aria-label={u.active ? t("users.deactivateFor", { name: u.name }) : t("users.activateFor", { name: u.name })}
                          onClick={() => handleToggleActive(u)}
                        >
                          {u.active ? t("users.deactivate") : t("users.activate")}
                        </PillButton>
                        {/* Reset Password & Hapus TIDAK ditampilkan untuk akun
                            sendiri maupun akun SUPER_ADMIN — server menolaknya
                            juga, jadi gerbangnya ada di dua sisi. */}
                        {manageable ? (
                          <>
                            <PillButton
                              variant="surface"
                              aria-label={t("users.resetFor", { name: u.name })}
                              onClick={() => openResetModal(u)}
                            >
                              {t("users.reset")}
                            </PillButton>
                            <ButtonDanger
                              variant="outline"
                              aria-label={t("users.deleteFor", { name: u.name })}
                              onClick={() => setDeleteTarget(u)}
                            >
                              {t("users.delete")}
                            </ButtonDanger>
                          </>
                        ) : (
                          <span className={`spine-footnote ${styles.rowNote}`}>
                            {u.id === user.id ? t("users.yourAccount") : t("users.superAdminAccount")}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <section className={styles.panel} aria-labelledby="admin-storage-title">
        <div className={styles.panelHead}>
          <h2 id="admin-storage-title" className={`spine-display-panel ${styles.panelTitle}`}>
            {t("storage.title")}
          </h2>
        </div>
        <div aria-busy={statsLoading && !stats ? true : undefined}>
          {statsError && !stats ? (
            <div className={styles.errorBox} role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.5v.01" />
              </svg>
              <div>
                <b className={`spine-row-title ${styles.errorTitle}`}>{t("storage.loadFailed")}</b>
                <span className={`spine-footnote ${styles.errorCause}`}>{humanize(statsError)}</span>
                <PillButton
                  variant="surface"
                  className={styles.errorRetry}
                  onClick={() => { refetchStats().catch(() => undefined); }}
                >
                  {tc("retry")}
                </PillButton>
              </div>
            </div>
          ) : statsLoading && !stats ? (
            <>
              <div className={styles.skeletonRow} aria-hidden="true" />
              <div className={styles.skeletonRow} aria-hidden="true" />
            </>
          ) : !stats ? (
            <p className={`spine-body ${styles.emptyState}`}>{t("storage.empty")}</p>
          ) : (
            <div className={styles.stats}>
              {/* Label + angka berada dalam SATU elemen supaya pembaca layar
                  membacanya utuh ("Total Projects, 12"), bukan dua potongan. */}
              {[
                { label: t("storage.totalProjects"), value: f.number(Number(stats.totalProjects)) },
                { label: t("storage.totalFiles"), value: f.number(Number(stats.totalFiles)) },
                { label: t("storage.usedSpace"), value: f.fileSize(Number(stats.usedSpace)) },
                { label: t("storage.freeSpace"), value: f.fileSize(Number(stats.freeSpace)) },
              ].map((tile) => (
                <p key={tile.label} className={styles.statTile}>
                  <span className={`spine-label ${styles.statLabel}`}>{tile.label}</span>
                  <span className={`spine-display-stat ${styles.statValue}`}>{tile.value}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Tolak pendaftaran — `dialog` Story 3.1 menggantikan `confirm()`. */}
      {rejectTarget && (
        <ConfirmDialog
          title={t("pending.rejectTitle", { email: rejectTarget.email })}
          lead={t("pending.rejectLead")}
          tone="permanent"
          confirmLabel={t("pending.reject")}
          cancelLabel={tc("cancel")}
          busyLabel={t("working")}
          busy={approvalBusy[rejectTarget.id] === 'reject'}
          onConfirm={() => {
            const target = rejectTarget;
            setRejectTarget(null);
            runApproval(target, 'reject', () => rejectUser({ variables: { userId: target.id } }));
          }}
          onClose={() => setRejectTarget(null)}
        />
      )}

      {/* Add User — bentuk `dialog` yang SAMA dengan dialog lain di layar ini. */}
      {showCreateModal && (
        <Dialog
          title={t("create.title")}
          onClose={() => { if (!registerLoading) { setShowCreateModal(false); setCreateError(""); } }}
          closeDisabled={registerLoading}
          actions={
            <>
              <PillButton
                variant="surface"
                aria-disabled={registerLoading || undefined}
                onClick={() => { if (!registerLoading) { setShowCreateModal(false); setCreateError(""); } }}
              >
                {tc("cancel")}
              </PillButton>
              <PillButton
                variant="accent"
                busy={registerLoading}
                busyLabel={t("create.creating")}
                onClick={() => handleCreateUser()}
              >
                {t("create.submit")}
              </PillButton>
            </>
          }
        >
          <div className={styles.dlgStack}>
            <TextField
              label={t("create.name")}
              value={newUserName}
              onChange={(e) => { setNewUserName(e.target.value); setCreateError(""); }}
              required
              placeholder={t("create.namePlaceholder")}
              autoComplete="name"
            />
            <TextField
              label={t("create.email")}
              type="email"
              value={newUserEmail}
              onChange={(e) => { setNewUserEmail(e.target.value); setCreateError(""); }}
              required
              placeholder={t("create.emailPlaceholder")}
              autoComplete="email"
            />
            <div className={fieldStyles.field}>
              <label className={`spine-label ${fieldStyles.label}`} htmlFor="new-user-password">
                {t("create.password")}
              </label>
              <PasswordInput
                id="new-user-password"
                value={newUserPassword}
                onChange={(e) => { setNewUserPassword(e.target.value); setCreateError(""); }}
                required
                minLength={MIN_PASSWORD_LENGTH}
                placeholder="••••••••"
                autoComplete="new-password"
                aria-describedby="new-user-password-hint"
                className={`spine-focus-ring ${fieldStyles.input}`}
              />
              {/* Teks bantuan DI BAWAH kolomnya (sebelumnya tampil di atas label,
                  terbaca seolah milik kolom Email). */}
              <p id="new-user-password-hint" className={`spine-footnote ${styles.minHint}`}>
                {tPw("minHint", { min: MIN_PASSWORD_LENGTH })}
              </p>
            </div>
            <div className={fieldStyles.field}>
              <label className={`spine-label ${fieldStyles.label}`} htmlFor="new-user-role">
                {t("create.role")}
              </label>
              <span className={`${styles.selectWrap} ${styles.selectWrapBlock}`}>
                <select
                  id="new-user-role"
                  className={`spine-focus-ring ${styles.selectPill} ${styles.filterPill}`}
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value)}
                >
                  {["ADMIN", "EDITOR", "FIELD_CREW", "VIEWER"].map((r) => (
                    <option key={r} value={r}>{f.role(r)}</option>
                  ))}
                </select>
                {CHEVRON}
              </span>
            </div>
          </div>
          {/* Kegagalan permintaan tampil sebagai `form-alert` tepat di atas tombol. */}
          {createError && <FormAlert tone="danger">{createError}</FormAlert>}
        </Dialog>
      )}

      {/* Reset Password — `dialog` Story 3.1 + `radio-card` / `info-note` /
          `one-time-secret` Story 3.1. Tidak ada modal buatan sendiri. */}
      {resetTarget && !resetResult && (
        <Dialog
          title={t("reset.title")}
          lead={t("reset.lead", { name: resetTarget.name, email: resetTarget.email })}
          onClose={closeResetModal}
          closeDisabled={resetLoading}
          actions={
            <>
              <PillButton variant="surface" onClick={closeResetModal} aria-disabled={resetLoading || undefined}>
                {tc("cancel")}
              </PillButton>
              <PillButton
                variant="accent"
                busy={resetLoading}
                busyLabel={t("working")}
                onClick={() => handleResetSubmit()}
              >
                {t("reset.submit")}
              </PillButton>
            </>
          }
        >
          {/* Akun Google → catatan NETRAL; akun nonaktif → catatan PERINGATAN. */}
          {!resetTarget.hasPassword && (
            <InfoNote variant="neutral">
              {t("reset.googleNote")}
            </InfoNote>
          )}
          {!resetTarget.active && (
            <InfoNote variant="warn">
              {t("reset.inactiveNote")}
            </InfoNote>
          )}

          <RadioCardGroup
            label={t("reset.modeLabel")}
            value={resetMode}
            onChange={(v) => { setResetMode(v); setResetError(""); setResetFormError(null); }}
            options={[
              { value: "auto", title: t("reset.modeAuto") },
              { value: "manual", title: t("reset.modeManual") },
            ]}
          />

          {resetMode === "manual" && (
            <div className={fieldStyles.field}>
              {/* Kalimat panjang minimal di ATAS field (pola Story 1.13). */}
              <p className={`spine-footnote ${styles.minHint}`}>
                {tPw("minHint", { min: MIN_PASSWORD_LENGTH })}
              </p>
              <label className={`spine-label ${fieldStyles.label}`} htmlFor="reset-new-password">
                {t("reset.newPassword")}
              </label>
              <PasswordInput
                id="reset-new-password"
                value={resetPassword}
                onChange={(e) => { setResetPassword(e.target.value); setResetError(""); }}
                className={`spine-focus-ring ${fieldStyles.input}`}
                placeholder="••••••••"
                autoComplete="new-password"
                aria-invalid={resetError ? true : undefined}
                aria-describedby={resetError ? "reset-new-password-error" : undefined}
              />
              {/* Error isian tampil DI BAWAH kolomnya, bukan di atas tombol. */}
              {resetError && (
                <p className={`spine-footnote ${fieldStyles.errorText}`} id="reset-new-password-error">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{resetError}</span>
                </p>
              )}
            </div>
          )}

          <p className={`spine-footnote ${styles.resetHint}`}>
            {t("reset.signOutHint")}
          </p>

          {/* `form-alert` danger TEPAT di atas tombol — kegagalan permintaan,
              bukan kesalahan isian. */}
          {resetFormError && <FormAlert tone="danger">{resetFormError}</FormAlert>}
        </Dialog>
      )}

      {/* Hasil reset — rahasia sekali tampil: TIDAK tertutup oleh klik di luar. */}
      {resetTarget && resetResult && (
        <Dialog
          title={t("reset.doneTitle")}
          /* `locked`: rahasia yang hanya tampil SEKALI tidak boleh hilang
             karena klik di luar ATAU Esc yang tak sengaja — AC 3.20
             menulis "hanya tombol Selesai yang menutupnya". Tanpa
             `closeLabel` tidak ada tombol × sama sekali, jadi "Selesai"
             benar-benar satu-satunya jalan keluar; ia tetap bisa dicapai
             keyboard karena fokus terkunci di dalam dialog. */
          locked
          dismissOnBackdrop={false}
          onClose={closeResetModal}
          actions={<PillButton variant="accent" onClick={closeResetModal}>{t("reset.done")}</PillButton>}
        >
          {resetResult.password ? (
            <>
              <p className={`spine-body ${styles.resetLead}`}>
                {t.rich("reset.newFor", {
                  name: resetTarget.name,
                  email: resetTarget.email,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
              <OneTimeSecret secret={resetResult.password} />
              <p className={`spine-footnote ${styles.resetWarn}`}>
                {t("reset.onceWarning")}
              </p>
            </>
          ) : (
            /* Mode manual TIDAK menampilkan kotak password. */
            <FormAlert tone="ok">
              {t("reset.manualSaved", { name: resetTarget.name, email: resetTarget.email })}
            </FormAlert>
          )}
          <p className={`spine-body ${styles.resetLead}`}>
            {t("reset.signedOut", { google: resetResult.googleOnly ? "yes" : "no" })}
          </p>
          {!resetTarget.active && (
            <InfoNote variant="warn">
              {t("reset.stillInactive")}
            </InfoNote>
          )}
        </Dialog>
      )}

      {/* Hapus akun */}
      {deleteTarget && (
        <ConfirmDialog
          title={t("delete.title", { email: deleteTarget.email })}
          lead={t("delete.lead", { name: deleteTarget.name })}
          tone="permanent"
          confirmLabel={t("users.delete")}
          cancelLabel={tc("cancel")}
          busy={deleteLoading}
          onConfirm={handleConfirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
