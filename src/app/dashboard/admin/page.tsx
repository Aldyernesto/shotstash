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
import { humanizeError } from "@/components/feedback/ToastProvider";
import { formatNumber, formatFileSize, formatCount } from "@/lib/format";

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
    }
  }
`;

const DELETE_USER = gql`
  mutation DeleteUser($id: ID!) {
    deleteUser(id: $id) {
      success
      message
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
type ResetResult = { message: string; password: string | null; googleOnly: boolean };

const MIN_PASSWORD_LENGTH = 8;

const ROLE_LABEL_MAP: Record<string,string> = { EDITOR: 'Editor', FIELD_CREW: 'Field Crew', VIEWER: 'Viewer', ADMIN: 'Admin', SUPER_ADMIN: 'Super Admin' };

export default function AdminPanel() {
  const { user, isLoading } = useAuth();
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

  /** Pesan server yang berarti "pendaftar ini sudah diproses admin lain". */
  const isAlreadyHandled = (err: unknown) => {
    const m = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
    return m.includes("not found") || m.includes("tidak ditemukan") || m.includes("already") || m.includes("sudah");
  };

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
        setApprovalNotice(`Pendaftaran ${u.email} sudah diproses. Daftar diperbarui.`);
        refetchPending().catch(() => undefined);
      } else {
        const what = kind === "approve" ? "menyetujui" : "menolak";
        setApprovalNotice(`Gagal ${what} ${u.email}. Coba lagi. ${humanizeError(err)}`);
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
  const fmtDate = (raw: any) => {
    try { return new Date(raw).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };


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
        setCreateError(data.register.message || "Gagal membuat user");
      }
    },
    onError: (err) => setCreateError(err.message),
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
      setTableNotice(`Gagal mengubah role ${u.name}. Coba lagi. ${humanizeError(err)}`);
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
      const what = u.active ? 'menonaktifkan' : 'mengaktifkan';
      setTableNotice(`Gagal ${what} ${u.name}. Coba lagi. ${humanizeError(err)}`);
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
    if (resetMode === "manual" && resetPassword.length < MIN_PASSWORD_LENGTH) {
      setResetError(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
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
        const message = result.message || "Password berhasil diatur. Semua sesi login user ini sudah di-logout.";
        setNotice({ type: "success", text: message });
        refetch();
        if (!stillCurrent()) return; // modal sudah berganti target — jangan tampilkan hasil di user lain
        setResetPassword("");
        setResetResult({ message, password: result.password ?? null, googleOnly: !target.hasPassword });
      } else if (stillCurrent()) {
        // Dialog TETAP terbuka dengan pilihan & isian utuh; tidak ada
        // `one-time-secret` yang dirender karena tidak ada password yang
        // benar-benar dibuat.
        setResetFormError(`Gagal mengatur password. Coba lagi. ${humanizeError(result?.message)}`);
      }
    } catch (err) {
      if (stillCurrent()) {
        setResetFormError(`Gagal mengatur password. Coba lagi. ${humanizeError(err)}`);
      }
    }
  };

  /** Kalimat gagal hapus: menyebut rincian dari server lalu menawarkan
      "Nonaktifkan" sebagai jalan keluar (AC 3.21). */
  const activityBlockedText = (target: User, reason: unknown) => {
    const raw = typeof reason === "string" ? reason : (reason as { message?: string } | null)?.message;
    const detail = (raw || "").trim();
    // Server SUDAH mengirim kalimat utuh persis bentuk AC ("…tidak bisa
    // dihapus karena punya aktivitas: 958 file upload… Gunakan
    // \"Nonaktifkan\"…"). Kalau begitu dipakai APA ADANYA — membungkusnya
    // lagi hanya menggandakan kalimatnya.
    if (/tidak bisa dihapus karena punya aktivitas/i.test(detail)) return detail;
    const looksLikeActivity = /aktivitas|activity|upload|share|chat|relasi|foreign key|constraint/i.test(detail);
    if (detail && looksLikeActivity) {
      return `Akun ${target.email} tidak bisa dihapus karena punya aktivitas: ${detail}. Gunakan "Nonaktifkan" untuk memblokir akses tanpa menghapus datanya.`;
    }
    return `Akun ${target.email} tidak bisa dihapus. ${humanizeError(reason)} Gunakan "Nonaktifkan" untuk memblokir akses tanpa menghapus datanya.`;
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
        setNotice({ type: "success", text: `Akun ${target.email} berhasil dihapus.` });
        refetch();
        refetchPending();
      } else {
        // Server menolak karena akun punya jejak (upload, share link, chat).
        // Kalimatnya menawarkan JALAN KELUAR, bukan sekadar menolak.
        setNotice({ type: "error", text: activityBlockedText(target, result?.message) });
      }
    } catch (err) {
      setNotice({ type: "error", text: activityBlockedText(target, err) });
    }
  };

  return (
    <div className={styles.adminContainer}>
      <div className={styles.pageHead}>
        <h1 className={`spine-display-page ${styles.pageTitle}`}>Admin Panel</h1>
        <p className={`spine-body-sub ${styles.pageSub}`}>
          Kelola user, pantau lalu lintas, dan atur penyimpanan platform.
        </p>
      </div>

      {/* Panel "Menunggu Persetujuan" HANYA tampil bila ada pendaftaran. */}
      {pendingUsers.length > 0 && (
        <section className={`${styles.panel} ${styles.panelWait}`} aria-labelledby="admin-pending-title">
          <div className={styles.panelHead}>
            <h2 id="admin-pending-title" className={`spine-display-panel ${styles.panelTitle}`}>
              Menunggu Persetujuan
              <span className={`spine-display-sticker ${styles.countSticker}`}>
                {formatNumber(pendingUsers.length)}
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
              const name = u.name || 'Tanpa nama';
              return (
                <article key={u.id} className={styles.approvalCard} aria-label={name}>
                  <div className={styles.apHead}>
                    <div className={styles.apWho}>
                      <span className={`spine-display-card ${styles.apAvatar}`} aria-hidden="true">{initials}</span>
                      <div style={{ minWidth: 0 }}>
                        <b className={`spine-row-title ${styles.apName}`}>{name}</b>
                        <span className={`spine-body-sm ${styles.apEmail}`}>{u.email}</span>
                        {u.createdAt && (
                          <span className={`spine-footnote ${styles.apDate}`}>Daftar: {fmtDate(u.createdAt)}</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.apReq}>
                      <span className={`spine-label ${styles.tagPill}`}>
                        Minta: {ROLE_LABEL_MAP[u.requestedRole] || u.requestedRole || 'Belum diisi'}
                      </span>
                      <span className={`spine-footnote ${styles.apCount}`}>{formatCount(answers.length, 'jawaban')}</span>
                    </div>
                  </div>

                  {answers.length > 0 ? (
                    <div className={styles.apAnswers}>
                      {answers.map((qa: any, i: number) => (
                        <div key={i}>
                          <span className={`spine-footnote ${styles.apQ}`}>{qa.question}</span>
                          <span className={`spine-body-sm ${styles.apA}`}>{qa.answer || '—'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={`spine-body-sm ${styles.apNoAnswers}`}>
                      Pelamar belum mengisi jawaban onboarding.
                    </p>
                  )}

                  <div className={styles.apDecision}>
                    <span className={`spine-body-sm ${styles.apDecisionLabel}`} id={`ap-role-${u.id}`}>
                      Setujui sebagai:
                    </span>
                    <span className={styles.selectWrap}>
                      <select
                        className={`spine-focus-ring ${styles.selectPill}`}
                        aria-label={`Setujui sebagai, ${name}`}
                        value={selRole}
                        onChange={(e) => setApproveRole((v) => ({ ...v, [u.id]: e.target.value }))}
                      >
                        <option value="EDITOR">Editor</option>
                        <option value="FIELD_CREW">Field Crew</option>
                        <option value="VIEWER">Viewer</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      {CHEVRON}
                    </span>
                    <span className={styles.apSpacer} />
                    <PillButton
                      variant="yellow"
                      busy={busy === 'approve'}
                      busyLabel="Memproses..."
                      aria-label={`Setujui ${name}`}
                      onClick={() =>
                        runApproval(u, 'approve', () =>
                          approveUser({ variables: { userId: u.id, role: selRole } }),
                        )
                      }
                    >
                      Setujui
                    </PillButton>
                    <ButtonDanger
                      variant="outline"
                      aria-busy={busy === 'reject' || undefined}
                      aria-disabled={busy === 'reject' || undefined}
                      aria-label={`Tolak ${name}`}
                      onClick={() => setRejectTarget(u)}
                    >
                      {busy === 'reject' ? 'Memproses...' : 'Tolak'}
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
            User Management
            <span className={`spine-display-sticker ${styles.countSticker}`}>
              {formatNumber(users.length)}
            </span>
          </h2>
          <PillButton variant="yellow" onClick={() => setShowCreateModal(true)}>
            + Add User
          </PillButton>
        </div>

        {/* Hasil hapus/tambah akun. Sukses `role="status"`, gagal
            `role="alert"` — keduanya bertahan sampai ditutup ×. */}
        {notice && (
          <NoticeBar
            tone={notice.type === "error" ? "danger" : "ok"}
            closeLabel="Tutup pesan"
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
            placeholder="Cari nama atau email…"
            aria-label="Cari nama atau email"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className={styles.selectWrap}>
            <select
              className={`spine-focus-ring ${styles.selectPill} ${styles.filterPill}`}
              aria-label="Saring menurut role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="ALL">Semua role</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="ADMIN">Admin</option>
              <option value="EDITOR">Editor</option>
              <option value="FIELD_CREW">Field Crew</option>
              <option value="VIEWER">Viewer</option>
            </select>
            {CHEVRON}
          </span>
        </div>

        <table className={styles.userTable}>
          <thead>
            <tr>
              <th scope="col" className="spine-label">Name</th>
              <th scope="col" className="spine-label">Email</th>
              <th scope="col" className="spine-label">Role</th>
              <th scope="col" className="spine-label">Status</th>
              <th scope="col" className="spine-label">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={5} className={`spine-body ${styles.tableEmpty}`}>Memuat daftar user…</td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className={`spine-body ${styles.tableEmpty}`}>
                  {searchQuery || roleFilter !== "ALL" ? "Tidak ada user yang cocok." : "Belum ada user."}
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const manageable = canManageAccount(u);
                const roleValue = roleDraft[u.id] ?? u.role;
                return (
                  <tr key={u.id}>
                    <td data-label="Name">
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
                            Google
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label="Email" className={`spine-body-sm ${styles.userEmail}`}>{u.email}</td>
                    <td data-label="Role">
                      <span className={styles.selectWrap}>
                        <select
                          className={`spine-focus-ring ${styles.selectPill}`}
                          aria-label={`Role ${u.name}`}
                          value={roleValue}
                          onChange={(e) => handleRoleChange(u, e.target.value)}
                        >
                          <option value="SUPER_ADMIN">Super Admin</option>
                          <option value="ADMIN">Admin</option>
                          <option value="EDITOR">Editor</option>
                          <option value="FIELD_CREW">Field Crew</option>
                          <option value="VIEWER">Viewer</option>
                        </select>
                        {CHEVRON}
                      </span>
                    </td>
                    <td data-label="Status">
                      <StatusChip tone={u.active ? "ok" : "danger"}>
                        {u.active ? "Active" : "Inactive"}
                      </StatusChip>
                    </td>
                    <td data-label="Actions">
                      <div className={styles.rowActions}>
                        {/* Label membawa KEADAANNYA sekaligus nama barisnya. */}
                        <PillButton
                          variant="surface"
                          busy={rowBusy[u.id]}
                          busyLabel="Memproses..."
                          aria-label={`${u.active ? "Nonaktifkan" : "Aktifkan"} ${u.name}`}
                          onClick={() => handleToggleActive(u)}
                        >
                          {u.active ? "Nonaktifkan" : "Aktifkan"}
                        </PillButton>
                        {/* Reset Password & Hapus TIDAK ditampilkan untuk akun
                            sendiri maupun akun SUPER_ADMIN — server menolaknya
                            juga, jadi gerbangnya ada di dua sisi. */}
                        {manageable ? (
                          <>
                            <PillButton
                              variant="surface"
                              aria-label={`Reset Password ${u.name}`}
                              onClick={() => openResetModal(u)}
                            >
                              Reset Password
                            </PillButton>
                            <ButtonDanger
                              variant="outline"
                              aria-label={`Hapus ${u.name}`}
                              onClick={() => setDeleteTarget(u)}
                            >
                              Hapus
                            </ButtonDanger>
                          </>
                        ) : (
                          <span className={`spine-footnote ${styles.rowNote}`}>
                            {u.id === user.id ? "Akun kamu" : "Akun Super Admin"}
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
            Storage Overview
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
                <b className={`spine-row-title ${styles.errorTitle}`}>Gagal memuat data penyimpanan. Coba lagi.</b>
                <span className={`spine-footnote ${styles.errorCause}`}>{humanizeError(statsError)}</span>
                <PillButton
                  variant="surface"
                  className={styles.errorRetry}
                  onClick={() => { refetchStats().catch(() => undefined); }}
                >
                  Coba lagi
                </PillButton>
              </div>
            </div>
          ) : statsLoading && !stats ? (
            <>
              <div className={styles.skeletonRow} aria-hidden="true" />
              <div className={styles.skeletonRow} aria-hidden="true" />
            </>
          ) : !stats ? (
            <p className={`spine-body ${styles.emptyState}`}>Belum ada data penyimpanan.</p>
          ) : (
            <div className={styles.stats}>
              {/* Label + angka berada dalam SATU elemen supaya pembaca layar
                  membacanya utuh ("Total Projects, 12"), bukan dua potongan. */}
              {[
                { label: 'Total Projects', value: formatNumber(Number(stats.totalProjects)) },
                { label: 'Total Files', value: formatNumber(Number(stats.totalFiles)) },
                { label: 'Used Space', value: formatFileSize(Number(stats.usedSpace)) },
                { label: 'Free Space', value: formatFileSize(Number(stats.freeSpace)) },
              ].map((t) => (
                <p key={t.label} className={styles.statTile}>
                  <span className={`spine-label ${styles.statLabel}`}>{t.label}</span>
                  <span className={`spine-display-stat ${styles.statValue}`}>{t.value}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Tolak pendaftaran — `dialog` Story 3.1 menggantikan `confirm()`. */}
      {rejectTarget && (
        <ConfirmDialog
          title={`Tolak pendaftaran ${rejectTarget.email}?`}
          lead="Pendaftar ini tidak akan bisa masuk. Ia harus mendaftar ulang bila ingin dipertimbangkan lagi."
          tone="permanent"
          confirmLabel="Tolak"
          cancelLabel="Batal"
          busyLabel="Memproses..."
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
          title="Create New User"
          onClose={() => { if (!registerLoading) { setShowCreateModal(false); setCreateError(""); } }}
          closeDisabled={registerLoading}
          actions={
            <>
              <PillButton
                variant="surface"
                aria-disabled={registerLoading || undefined}
                onClick={() => { if (!registerLoading) { setShowCreateModal(false); setCreateError(""); } }}
              >
                Cancel
              </PillButton>
              <PillButton
                variant="yellow"
                busy={registerLoading}
                busyLabel="Creating..."
                onClick={() => handleCreateUser()}
              >
                Create User
              </PillButton>
            </>
          }
        >
          <div className={styles.dlgStack}>
            <TextField
              label="Name"
              value={newUserName}
              onChange={(e) => { setNewUserName(e.target.value); setCreateError(""); }}
              required
              placeholder="Nama lengkap"
              autoComplete="name"
            />
            <TextField
              label="Email"
              type="email"
              value={newUserEmail}
              onChange={(e) => { setNewUserEmail(e.target.value); setCreateError(""); }}
              required
              placeholder="user@example.com"
              autoComplete="email"
            />
            <div className={fieldStyles.field}>
              <label className={`spine-label ${fieldStyles.label}`} htmlFor="new-user-password">
                Password
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
                Password minimal {MIN_PASSWORD_LENGTH} karakter
              </p>
            </div>
            <div className={fieldStyles.field}>
              <label className={`spine-label ${fieldStyles.label}`} htmlFor="new-user-role">
                Role
              </label>
              <span className={`${styles.selectWrap} ${styles.selectWrapBlock}`}>
                <select
                  id="new-user-role"
                  className={`spine-focus-ring ${styles.selectPill} ${styles.filterPill}`}
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value)}
                >
                  <option value="ADMIN">Admin</option>
                  <option value="EDITOR">Editor</option>
                  <option value="FIELD_CREW">Field Crew</option>
                  <option value="VIEWER">Viewer</option>
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
          title="Reset Password"
          lead={`${resetTarget.name} (${resetTarget.email})`}
          onClose={closeResetModal}
          closeDisabled={resetLoading}
          actions={
            <>
              <PillButton variant="surface" onClick={closeResetModal} aria-disabled={resetLoading || undefined}>
                Batal
              </PillButton>
              <PillButton
                variant="yellow"
                busy={resetLoading}
                busyLabel="Memproses..."
                onClick={() => handleResetSubmit()}
              >
                Reset Password
              </PillButton>
            </>
          }
        >
          {/* Akun Google → catatan NETRAL; akun nonaktif → catatan PERINGATAN. */}
          {!resetTarget.hasPassword && (
            <InfoNote variant="neutral">
              Akun ini terdaftar via Google dan belum punya password. Setelah dibuatkan, user bisa
              login dengan email + password dan tetap bisa login dengan Google.
            </InfoNote>
          )}
          {!resetTarget.active && (
            <InfoNote variant="warn">
              Akun ini sedang nonaktif. Reset password saja tidak cukup — klik &quot;Aktifkan&quot; di
              tabel user supaya user bisa login.
            </InfoNote>
          )}

          <RadioCardGroup
            label="Cara membuat password"
            value={resetMode}
            onChange={(v) => { setResetMode(v); setResetError(""); setResetFormError(null); }}
            options={[
              { value: "auto", title: "Buat otomatis (10 karakter acak, disarankan)" },
              { value: "manual", title: "Tulis manual" },
            ]}
          />

          {resetMode === "manual" && (
            <div className={fieldStyles.field}>
              {/* Kalimat panjang minimal di ATAS field (pola Story 1.13). */}
              <p className={`spine-footnote ${styles.minHint}`}>
                Password minimal {MIN_PASSWORD_LENGTH} karakter
              </p>
              <label className={`spine-label ${fieldStyles.label}`} htmlFor="reset-new-password">
                Password baru
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
            Semua sesi login user ini akan di-logout.
          </p>

          {/* `form-alert` danger TEPAT di atas tombol — kegagalan permintaan,
              bukan kesalahan isian. */}
          {resetFormError && <FormAlert tone="danger">{resetFormError}</FormAlert>}
        </Dialog>
      )}

      {/* Hasil reset — rahasia sekali tampil: TIDAK tertutup oleh klik di luar. */}
      {resetTarget && resetResult && (
        <Dialog
          title="Password Berhasil Diatur"
          /* `locked`: rahasia yang hanya tampil SEKALI tidak boleh hilang
             karena klik di luar ATAU Esc yang tak sengaja — AC 3.20
             menulis "hanya tombol Selesai yang menutupnya". Tanpa
             `closeLabel` tidak ada tombol × sama sekali, jadi "Selesai"
             benar-benar satu-satunya jalan keluar; ia tetap bisa dicapai
             keyboard karena fokus terkunci di dalam dialog. */
          locked
          dismissOnBackdrop={false}
          onClose={closeResetModal}
          actions={<PillButton variant="yellow" onClick={closeResetModal}>Selesai</PillButton>}
        >
          {resetResult.password ? (
            <>
              <p className={`spine-body ${styles.resetLead}`}>
                Password baru untuk <strong>{resetTarget.name}</strong> ({resetTarget.email}):
              </p>
              <OneTimeSecret secret={resetResult.password} />
              <p className={`spine-footnote ${styles.resetWarn}`}>
                Password ini hanya ditampilkan sekali. Salin sekarang dan kirim ke user lewat jalur
                pribadi.
              </p>
            </>
          ) : (
            /* Mode manual TIDAK menampilkan kotak password. */
            <FormAlert tone="ok">
              Password manual untuk {resetTarget.name} ({resetTarget.email}) sudah disimpan.
            </FormAlert>
          )}
          <p className={`spine-body ${styles.resetLead}`}>
            Semua sesi login user ini sudah di-logout. User perlu login ulang di semua perangkat.
            {resetResult.googleOnly && " User tetap bisa login dengan Google."}
          </p>
          {!resetTarget.active && (
            <InfoNote variant="warn">
              Akun ini masih nonaktif, jadi user tetap belum bisa login. Klik &quot;Aktifkan&quot; di
              tabel user supaya bisa login.
            </InfoNote>
          )}
        </Dialog>
      )}

      {/* Hapus akun */}
      {deleteTarget && (
        <ConfirmDialog
          title={`Hapus akun ${deleteTarget.email}?`}
          lead={`Akun ${deleteTarget.name} akan dihapus permanen beserta sesi, perangkat, dan notifikasinya. Hanya akun tanpa upload, share link, dan chat yang bisa dihapus — selain itu gunakan "Nonaktifkan". Tindakan ini tidak bisa dibatalkan.`}
          tone="permanent"
          confirmLabel="Hapus"
          cancelLabel="Batal"
          busy={deleteLoading}
          onConfirm={handleConfirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
