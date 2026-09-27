'use client';

// Story 3.33: halaman "menunggu persetujuan" bergaya spine — `auth-topbar`
// TANPA panggung hero, kartu 376 px di tengah, `status-mark` menggantikan
// emoji, dan `account-info` sebagai panel menjorok.
//
// Perilaku yang TIDAK berubah: polling status tiap 10 detik, akun yang
// disetujui langsung masuk ke /dashboard, akun yang ditolak berhenti
// polling.

import { useCallback, useEffect, useRef, useState } from 'react';
import AuthPage from '@/components/auth/AuthPage';
import AuthCard from '@/components/auth/AuthCard';
import StatusMark from '@/components/auth/StatusMark';
import TagPill from '@/components/tag-pill/TagPill';
import { ButtonPrimary, PillButton } from '@/components/form/buttons';
import styles from './pending.module.css';

async function gql(query: string, variables?: any) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('shotstash_token') : '';
  const res = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const ROLE_LABEL: Record<string, string> = {
  EDITOR: 'Editor',
  FIELD_CREW: 'Field Crew',
  VIEWER: 'Viewer',
  ADMIN: 'Admin',
};

/** Kalimat live region polling — keduanya tanpa teks mentah server. */
const POLL_OK = 'Status diperbarui otomatis tiap 10 detik.';
const POLL_FAIL = 'Belum bisa mengecek status. Mencoba lagi…';

const CLOCK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
);

export default function PendingPage() {
  const [me, setMe] = useState<any>(null);
  const [rejected, setRejected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pollLine, setPollLine] = useState(POLL_OK);
  /** Polling berhenti HANYA pada keadaan Ditolak. */
  const rejectedRef = useRef(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const j = await gql('{ me { id name email accountStatus requestedRole } }');
      const u = j?.data?.me;
      if (!u) {
        // Sesi tidak lagi valid → kembali ke halaman masuk.
        window.location.href = '/';
        return;
      }
      setMe(u);
      setPollLine(POLL_OK);
      if (u.accountStatus === 'ACTIVE') {
        window.location.href = '/dashboard';
        return;
      }
      if (u.accountStatus === 'REJECTED') {
        rejectedRef.current = true;
        setRejected(true);
      }
    } catch {
      /* Polling gagal: TETAP di keadaan menunggu — tidak pernah
         berpindah ke keadaan ditolak hanya karena koneksi putus. */
      setPollLine(POLL_FAIL);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('shotstash_token');
    if (!token) { window.location.href = '/'; return; }
    void check();
    const t = window.setInterval(() => {
      if (rejectedRef.current) return; // berhenti hanya pada Ditolak
      void check();
    }, 10000);
    return () => window.clearInterval(t);
  }, [check]);

  const logout = () => {
    try {
      localStorage.removeItem('shotstash_token');
      localStorage.removeItem('shotstash_user');
    } catch {
      /* penyimpanan diblokir: tetap keluar ke halaman masuk */
    }
    window.location.href = '/';
  };

  const roleLabel = me ? ROLE_LABEL[me.requestedRole] || me.requestedRole || 'Belum diisi' : '';

  return (
    <AuthPage variant="centered">
      <AuthCard
        head={
          <div className={styles.head}>
            {/* `status-mark` menggantikan emoji ⏳ / ⛔ — TANPA gerak. */}
            <StatusMark variant={rejected ? 'rejected' : 'waiting'} />
            <h1 className={`${styles.title} spine-display-panel`}>
              {rejected ? 'Pendaftaran Ditolak' : 'Menunggu Persetujuan'}
            </h1>
            <p className={`${styles.lead} ${rejected ? styles.leadBad : ''} spine-body-sub`}>
              {rejected
                ? 'Maaf, pendaftaran akunmu ditolak. Silakan hubungi admin untuk info lebih lanjut.'
                : 'Akunmu sudah kami terima dan sedang ditinjau admin. Kamu bisa masuk ke studio setelah disetujui.'}
            </p>
          </div>
        }
        form={
          <>
            {!rejected && me && (
              <dl className={styles.account}>
                <dt>Email</dt>
                <dd>{me.email}</dd>
                <dt>Jenis akun diminta</dt>
                <dd>
                  <TagPill>
                    <span className={styles.rolePill}>{roleLabel}</span>
                  </TagPill>
                </dd>
              </dl>
            )}

            <div className={`${styles.duo} ${rejected ? styles.solo : ''}`}>
              {!rejected && (
                <ButtonPrimary
                  arrow={false}
                  busy={checking}
                  busyLabel="Mengecek…"
                  onClick={() => void check()}
                >
                  Cek Status
                </ButtonPrimary>
              )}
              <PillButton variant="surface" onClick={logout}>
                Keluar
              </PillButton>
            </div>

            {!rejected && (
              <p className={styles.poll} role="status">
                {CLOCK_ICON}
                <span>{pollLine}</span>
              </p>
            )}
          </>
        }
      />
    </AuthPage>
  );
}
