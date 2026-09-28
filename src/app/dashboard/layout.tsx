"use client";

import React, { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { gql, useMutation } from "@apollo/client";
import styles from "./layout.module.css";
import { UploadProvider } from "@/components/UploadContext";
// Story 3.2: satu host `toast` untuk seluruh /dashboard/*.
import { ToastProvider } from "@/components/feedback/ToastProvider";
import { useAuth } from "@/components/AuthContext";
// Story 3.14: `upload-panel` hidup di LAYOUT, di bawah provider antrean —
// navigasi client-side antar Section/Project tidak melepas state dan
// upload tetap berjalan.
import UploadPanel from "@/components/upload/UploadPanel";
import UploadDock from "@/components/upload/UploadDock";
import NotificationBell from "@/components/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import DesktopFrame from "@/components/dashboard/DesktopFrame";
import MobileFrame from "@/components/dashboard/MobileFrame";
// Story 2.18: satu sumber kebenaran gerbang role.
import { useApolloClient } from "@apollo/client";
import { useTranslations } from "next-intl";
import AppSelect from "@/components/AppSelect";
import { useHumanizeError, errorKind } from "@/components/feedback/ToastProvider";
import { useFormat } from "@/i18n/useFormat";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { syncLocaleCookie } from "@/i18n/client";

const UPDATE_PROFILE = gql`
  mutation UpdateProfile($name: String, $avatarUrl: String, $locale: String) {
    updateProfile(name: $name, avatarUrl: $avatarUrl, locale: $locale) { id name avatarUrl locale }
  }
`;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const apolloClient = useApolloClient();
  const t = useTranslations("shell");

  // Clear Apollo cache on mount to prevent merge conflicts
  useEffect(() => {
    apolloClient.cache.reset().catch(() => {});
    apolloClient.refetchQueries({ include: "active" }).catch(() => {});
  }, []);

  // Authentication Check
  useEffect(() => {
    console.warn('[DashboardLayout] Auth check:', { isLoading, isAuthenticated, user: user?.email });
    // Basic protection (would be better with middleware, but this works for client-side demo)
    if (!isLoading && !isAuthenticated && typeof window !== "undefined") {
      console.warn('[DashboardLayout] NOT authenticated, redirecting to /');
      console.trace('[DashboardLayout] redirect stack trace');
      router.replace("/");
    }
  }, [isAuthenticated, isLoading, router, user?.email]);

  // Session heartbeat: detect disconnect from mobile
  useEffect(() => {
    const check = async () => {
      try {
        const token = localStorage.getItem('shotstash_token');
        if (!token) { window.location.href = '/'; return; }
        const res = await fetch('/api/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ query: '{ me { id } }' }),
          cache: 'no-store',
        });
        const data = await res.json();
        // Logout on auth errors OR null me (session deleted)
        if (data.errors?.some((e: any) => e.message?.includes('Unauthorized')) || !data?.data?.me) {
          localStorage.removeItem('shotstash_user');
          localStorage.removeItem('shotstash_token');
          window.location.href = '/';
        }
      } catch (_) {
        // Network error — do NOT logout, just skip this check
      }
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);
  // Story 2.2: sesi belum termuat → frame tetap dirender dengan placeholder
  // netral (tanpa tujuan role mana pun, AC 2.2); sesi gagal → perilaku lama:
  // null + redirect di efek atas. Isi <main> baru menyusul setelah authed.
  if (!isLoading && !isAuthenticated) return null; // Avoid flashing the layout before redirect
  const authed = !isLoading && isAuthenticated;

  return (
    <>
      <ToastProvider>
      <UploadProvider>
      <div className={`${styles.dashboardLayout} dashThemeScope`}>
        {/* Story 2.1: skip-link — fokus pertama di body untuk /dashboard/*;
            Enter memindahkan fokus ke <main> (bukan sekadar mengubah hash). */}
        <a
          href="#spine-main-content"
          className="spine-skip-link spine-focus-ring"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("spine-main-content")?.focus();
          }}
        >
          {t("skipToContent")}
        </a>
        <DesktopFrame
          user={authed ? user ?? null : null}
          pathname={pathname}
          onOpenProfile={() => setShowProfileSettings(true)}
          onOpenLogout={() => setShowLogoutConfirm(true)}
        />
        {/* Story 2.3: kerangka HP — header mobile + bottom-bar + more-sheet. */}
        <MobileFrame
          user={authed ? user ?? null : null}
          pathname={pathname}
          onOpenProfile={() => setShowProfileSettings(true)}
          onOpenLogout={() => setShowLogoutConfirm(true)}
        />

        <main id="spine-main-content" tabIndex={-1} className={styles.mainContent}>{authed ? children : null}</main>

        <UploadPanel />
        <UploadDock />

        {showLogoutConfirm && (
          <LogoutConfirm
            onCancel={() => setShowLogoutConfirm(false)}
            onConfirm={() => { setShowLogoutConfirm(false); logout(); }}
          />
        )}

        {showProfileSettings && user && (
          <ProfileSettingsModal
            user={user}
            onClose={() => setShowProfileSettings(false)}
          />
        )}
      </div>
      </UploadProvider>
    </ToastProvider>
    </>
  );
}

function LogoutConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface-container-high)',
          border: '1px solid var(--dash-chip-border)',
          borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h3 style={{ margin: '0 0 8px', color: 'var(--color-on-surface)', fontSize: '1.05rem' }}>{t("logoutTitle")}</h3>
        <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '0.88rem', margin: '0 0 20px', lineHeight: 1.55 }}>
          {t("logoutBody")}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent', border: '1px solid var(--color-outline-variant)',
              color: 'var(--color-on-surface)', padding: '9px 16px', borderRadius: '999px',
              cursor: 'pointer', fontSize: '13px', fontWeight: 600,
            }}
          >
            {tc("cancel")}
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: '#ef4444', border: 'none', color: '#fff',
              padding: '9px 18px', borderRadius: '999px',
              cursor: 'pointer', fontSize: '13px', fontWeight: 700,
            }}
          >
            {t("logoutConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileSettingsModal({ user, onClose }: { user: any; onClose: () => void }) {
  const [name, setName] = useState<string>(user.name || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl || null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [updateProfile] = useMutation(UPDATE_PROFILE);
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const tl = useTranslations("language");
  const humanize = useHumanizeError();
  const f = useFormat();
  // '' = instance default (stored as null on the server).
  const initialLocale: string = user.locale || '';
  const [locale, setLocale] = useState<string>(initialLocale);
  const languageLabelId = React.useId();
  const languageHintId = React.useId();

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError(t('photoTooLarge')); return; }
    setError(null);
    setUploading(true);
    try {
      const token = localStorage.getItem('shotstash_token');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'user');
      const res = await fetch('/api/upload/cover', {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'upload failed');
      setAvatarUrl(data.url);
    } catch (err: any) {
      setError(errorKind(err) === 'generic' ? t('uploadFailed') : humanize(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError(t('nameRequired')); return; }
    setError(null);
    setSaving(true);
    try {
      // Only send the locale when the user picked a different one; '' clears
      // it back to the instance default.
      const res = await updateProfile({
        variables: {
          name: trimmed,
          avatarUrl: avatarUrl ?? '',
          locale: locale !== initialLocale ? locale : undefined,
        },
      });
      const updated = res.data?.updateProfile;
      if (updated) {
        // Update localStorage user
        const cached = localStorage.getItem('shotstash_user');
        if (cached) {
          const parsed = JSON.parse(cached);
          localStorage.setItem('shotstash_user', JSON.stringify({ ...parsed, name: updated.name, avatarUrl: updated.avatarUrl, locale: updated.locale ?? null }));
        }
        // Server components follow the cookie; the reload below re-renders
        // them (and the rest of the page) in the saved locale.
        syncLocaleCookie(updated.locale);
        window.location.reload();
      }
    } catch (err: any) {
      setError(errorKind(err) === 'generic' ? t('saveFailed') : humanize(err));
    } finally {
      setSaving(false);
    }
  };

  const initials = ((user.name || user.email || '?').slice(0, 2)).toUpperCase();

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface-container-high)',
          border: '1px solid var(--dash-chip-border)',
          borderRadius: '18px', padding: '28px', maxWidth: '480px', width: '100%',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, color: 'var(--color-on-surface)', fontSize: '1.15rem', fontWeight: 700 }}>{t('title')}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--color-on-surface-variant)', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}
            aria-label={tc('close')}
          >×</button>
        </div>

        {/* Avatar */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
          <div
            onClick={uploading ? undefined : handlePickFile}
            style={{
              width: '96px', height: '96px', borderRadius: '50%',
              background: avatarUrl ? `url(${avatarUrl}) center/cover no-repeat` : 'linear-gradient(135deg, var(--app-spine-accent) 0%, var(--app-spine-accent-edge) 100%)',
              border: '3px solid var(--app-spine-accent-45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '32px', fontWeight: 800, color: 'var(--app-spine-on-accent)',
              cursor: uploading ? 'wait' : 'pointer',
              position: 'relative',
              boxShadow: '0 8px 24px var(--app-spine-accent-20)',
            }}
            title={t('changePhotoTitle')}
          >
            {!avatarUrl && initials}
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: '30px', height: '30px', borderRadius: '50%',
              background: '#141310', border: '2px solid var(--color-primary-container)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--app-spine-accent-2)', fontSize: '14px',
            }}>📷</div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            {uploading ? t('uploading') : (
              <>
                <span>{t('changePhotoHint')}</span>
                {avatarUrl && (
                  <button onClick={() => setAvatarUrl(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>{t('removePhoto')}</button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-on-surface-variant)', marginBottom: '6px', fontWeight: 700 }}>{t('name')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            style={{
              width: '100%', padding: '11px 14px', boxSizing: 'border-box',
              background: 'var(--color-surface-container)', border: '1px solid var(--color-outline-variant)',
              borderRadius: '10px', color: 'var(--color-on-surface)', fontSize: '14px', outline: 'none',
            }}
          />
        </div>

        {/* Email (read-only) */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-on-surface-variant)', marginBottom: '6px', fontWeight: 700 }}>{t('email')}</label>
          <div style={{
            padding: '11px 14px', background: 'var(--dash-chip)',
            border: '1px solid var(--dash-hairline-soft)', borderRadius: '10px',
            color: 'var(--color-on-surface-variant)', fontSize: '14px',
          }}>{user.email}</div>
        </div>

        {/* Role (read-only) */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-on-surface-variant)', marginBottom: '6px', fontWeight: 700 }}>{t('role')}</label>
          <div style={{
            padding: '11px 14px', background: 'var(--dash-chip)',
            border: '1px solid var(--dash-hairline-soft)', borderRadius: '10px',
            color: 'var(--app-accent)', fontSize: '14px', fontWeight: 700, letterSpacing: '0.05em',
          }}>{f.role(user).toLocaleUpperCase(f.locale)}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '4px', opacity: 0.7 }}>
            {t('roleHint')}
          </div>
        </div>

        {/* Language */}
        <div style={{ marginBottom: '20px' }}>
          <label id={languageLabelId} style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-on-surface-variant)', marginBottom: '6px', fontWeight: 700 }}>{tl('label')}</label>
          <AppSelect
            value={locale}
            options={[
              { value: '', label: tl('instanceDefault') },
              ...SUPPORTED_LOCALES.map((code) => ({ value: code, label: LOCALE_NAMES[code] })),
            ]}
            onChange={setLocale}
            labelledBy={languageLabelId}
            describedBy={languageHintId}
          />
          <div id={languageHintId} style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '4px', opacity: 0.7 }}>
            {tl('hint')}
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', fontSize: '13px', marginBottom: '14px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              background: 'transparent', border: '1px solid var(--color-outline-variant)',
              color: 'var(--color-on-surface)', padding: '9px 18px', borderRadius: '999px',
              cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600,
            }}
          >{tc('cancel')}</button>
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            style={{
              background: 'var(--color-primary-container)', border: 'none', color: 'var(--color-on-primary-container)',
              padding: '9px 20px', borderRadius: '999px',
              cursor: saving ? 'wait' : 'pointer', fontSize: '13px', fontWeight: 700,
              opacity: (saving || uploading) ? 0.6 : 1,
            }}
          >{saving ? tc('saving') : tc('save')}</button>
        </div>
      </div>
    </div>
  );
}
