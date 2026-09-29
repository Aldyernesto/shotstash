'use client';

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';
import { useLocale, useTranslations } from 'next-intl';
import styles from './page.module.css';
import { useAuth } from '@/components/AuthContext';
import AuthPage from '@/components/auth/AuthPage';
import AuthCard from '@/components/auth/AuthCard';
import AuthTabs from '@/components/auth/AuthTabs';
import PasswordInput from '@/components/PasswordInput';
import HeroStage from '@/components/hero/HeroStage';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '@/lib/passwordRule';
import TextField from '@/components/form/TextField';
// Komposisi field password memakai kelas kontrak text-field (pola yang
// sama dengan PasswordInput: .field/.label/.input — bukan duplikasi gaya).
import fieldStyles from '@/components/form/TextField.module.css';
import { FormAlert } from '@/components/form/FormAlert';
import { ButtonPrimary, TextLink } from '@/components/form/buttons';
import { EMAIL_TAKEN, LOGIN_ERROR_CODES } from '@/lib/authMessages';
import { errorCodeOf, errorKind } from '@/lib/errorCodes';
import { brand } from '@/lib/brand';
import { issueMediaCookie } from '@/lib/authClient';
import { usePublicConfig } from '@/lib/usePublicConfig';
// Story 1.31: email hasil reset dibawa lewat sessionStorage (bukan query param).
import { LOGIN_PREFILL_KEY } from '@/app/forgot-password/shared';

/**
 * Every message the form alert can show: a key, never server text. The copy
 * lives in `authErrors` (plus `password.*` for the password rule) and is
 * picked at render time, so raw server or network text never reaches the
 * user (Story 1.15).
 */
type AuthAlert =
  | 'network'
  | 'rateLimited'
  | 'invalidCredentials'
  | 'googleOnly'
  | 'deactivated'
  | 'rejected'
  | 'emailTaken'
  | 'signupFailed'
  | 'signupDisabled'
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'googleCancelled'
  | 'googleLoadFailed'
  | 'googleFailed'
  | 'googleNetwork'
  | 'googleNotVerified'
  | 'server';



/** Failed `login` payload: its stable `errorCode` picks the message. */
function loginAlert(code: string | null | undefined): AuthAlert {
  switch (code) {
    case LOGIN_ERROR_CODES.googleOnly:
      return 'googleOnly';
    case LOGIN_ERROR_CODES.deactivated:
      return 'deactivated';
    case LOGIN_ERROR_CODES.rejected:
      return 'rejected';
    case LOGIN_ERROR_CODES.invalidCredentials:
      return 'invalidCredentials';
    default:
      // INTERNAL or a code this client does not know: not the user's fault.
      return 'server';
  }
}

/** Failed `register` payload: password-rule or taken-email code, else generic. */
function registerAlert(code: string | null | undefined): AuthAlert {
  if (code === 'PASSWORD_TOO_SHORT') return 'passwordTooShort';
  if (code === 'PASSWORD_TOO_LONG') return 'passwordTooLong';
  if (code === EMAIL_TAKEN) return 'emailTaken';
  if (code === 'FEATURE_DISABLED') return 'signupDisabled';
  return 'signupFailed';
}

/** Thrown request (transport or GraphQL error): network or rate limit when it is one. */
function mapAuthError(err: unknown, fallback: AuthAlert): AuthAlert {
  // By code and error structure only, never by message text.
  const code = errorCodeOf(err);
  if (code === 'RATE_LIMITED') return 'rateLimited';
  if (!code) {
    const kind = errorKind(err);
    if (kind === 'offline' || kind === 'timeout') return 'network';
  }
  return fallback;
}

/** Failed `googleAuth`: known server cases by code or text, else generic. */
function googleAlert(error: { message?: string; extensions?: { code?: string } } | undefined): AuthAlert {
  if (error?.extensions?.code === 'EMAIL_NOT_VERIFIED') return 'googleNotVerified';
  if (error?.extensions?.code === 'RATE_LIMITED') return 'rateLimited';
  if (error?.extensions?.code === LOGIN_ERROR_CODES.deactivated) return 'deactivated';
  // Sign-up is off and this Google account has no account here yet.
  if (error?.extensions?.code === 'FEATURE_DISABLED') return 'signupDisabled';
  return 'googleFailed';
}

// ============================================
// Google Identity Services (GSI)
// ============================================

type GsiCredentialResponse = { credential?: string };
type GsiPromptNotification = { isSkippedMoment?: () => boolean; isNotDisplayed?: () => boolean };
type GsiId = {
  initialize: (config: { client_id: string; callback: (res: GsiCredentialResponse) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  prompt: (listener?: (notification: GsiPromptNotification) => void) => void;
};

function getGsi(): GsiId | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { google?: { accounts?: { id?: GsiId } } }).google?.accounts?.id;
}

let gsiScriptPromise: Promise<GsiId> | null = null;
function loadGsi(): Promise<GsiId> {
  const ready = getGsi();
  if (ready) return Promise.resolve(ready);
  if (!gsiScriptPromise) {
    gsiScriptPromise = new Promise<GsiId>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        const gsi = getGsi();
        if (gsi) resolve(gsi);
        else reject(new Error('GSI unavailable'));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('GSI failed to load'));
      };
      document.head.appendChild(script);
    }).catch((err) => {
      gsiScriptPromise = null; // izinkan coba lagi
      throw err;
    });
  }
  return gsiScriptPromise;
}

// GSI cukup di-initialize sekali per halaman; credential diteruskan ke handler yang sedang aktif.
let gsiInitializedClientId: string | null = null;
let gsiCredentialHandler: ((credential: string) => void) | null = null;
function setGsiCredentialHandler(handler: ((credential: string) => void) | null) {
  gsiCredentialHandler = handler;
}
function ensureGsiInitialized(gsi: GsiId, clientId: string) {
  if (gsiInitializedClientId === clientId) return;
  gsi.initialize({
    client_id: clientId,
    callback: (res) => {
      if (res.credential) gsiCredentialHandler?.(res.credential);
    },
  });
  gsiInitializedClientId = clientId;
}

// Story 1.23: ikon jam baris status PENDING (= mock i-clock, gaya goresan
// sama dengan ikon FormAlert) — status tidak pernah disampaikan warna saja.
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function GoogleLoginButton({ clientId, onSuccess, onError, highlight = false }: {
  /** Runtime Google client id from `/api/v1/config`; empty hides the button. */
  clientId: string;
  onSuccess: (token: string) => void;
  onError: (alert: AuthAlert) => void;
  highlight?: boolean;
}) {
  const t = useTranslations('login');
  const locale = useLocale();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef({ onSuccess, onError });
  // true hanya setelah iframe tombol Google benar-benar tampil (punya ukuran). Sebelum itu —
  // atau kalau Google menolak/memblokir iframe — tombol fallback prompt() yang ditampilkan.
  const [gsiVisible, setGsiVisible] = useState(false);

  useEffect(() => {
    handlersRef.current = { onSuccess, onError };
  });

  // Tombol resmi Google (renderButton) — tetap bekerja walau One Tap sedang cooldown.
  useEffect(() => {
    if (!clientId) return;
    setGsiCredentialHandler((credential) => handlersRef.current.onSuccess(credential));
    let cancelled = false;
    let lastWidth = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const watchVisibility = () => {
      clearInterval(poll);
      let tries = 0;
      poll = setInterval(() => {
        const frame = buttonRef.current?.querySelector('iframe');
        if (frame && frame.getBoundingClientRect().width > 0) {
          clearInterval(poll);
          if (!cancelled) setGsiVisible(true);
        } else if (++tries >= 40) {
          clearInterval(poll); // ~10 detik tanpa tombol → tetap pakai fallback
        }
      }, 250);
    };

    const render = () => {
      const gsi = getGsi();
      const el = buttonRef.current;
      if (cancelled || !gsi || !el) return;
      // Lebar tombol mengikuti kartu login (GSI: 200–400px) supaya tidak ada scroll horizontal.
      const width = Math.floor(Math.min(400, Math.max(200, el.clientWidth)));
      if (width === lastWidth && el.childElementCount > 0) return;
      lastWidth = width;
      try {
        ensureGsiInitialized(gsi, clientId);
        el.replaceChildren();
        // Story 1.22: size 'large' = tinggi 40px — SATU-SATUNYA pengecualian
        // target sentuh 48px spine, diikat kontrak tombol resmi GSI (catatan
        // sama di .googleBox/.gsiFallback, page.module.css).
        gsi.renderButton(el, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          logo_alignment: 'center',
          locale,
          width,
        });
        watchVisibility();
      } catch (err) {
        console.warn('[GoogleLogin] renderButton failed, using prompt()', err);
        setGsiVisible(false);
      }
    };

    loadGsi().then(render).catch((err) => console.warn('[GoogleLogin] GSI failed to load', err));

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(render, 150); })
      : null;
    if (observer && buttonRef.current) observer.observe(buttonRef.current);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(poll);
      observer?.disconnect();
      setGsiCredentialHandler(null);
    };
  }, [clientId, locale]);

  useEffect(() => {
    if (highlight) wrapperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  // Fallback kalau renderButton belum/tidak tersedia: One Tap prompt().
  const handleFallbackClick = () => {
    loadGsi()
      .then((gsi) => {
        ensureGsiInitialized(gsi, clientId);
        gsi.prompt((notification) => {
          if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
            handlersRef.current.onError('googleCancelled');
          }
        });
      })
      .catch(() => handlersRef.current.onError('googleLoadFailed'));
  };

  if (!clientId) return null;

  return (
    <div ref={wrapperRef} className={`${styles.googleWrap} ${highlight ? styles.googleWrapHl : ''}`}>
      {highlight && (
        /* Kalimat pendamping WAJIB bersama outline (AC 1.22 — sorotan
           tidak pernah berupa warna saja). */
        <p className={`spine-footnote ${styles.ghint}`}>
          {t('googleHint')}
        </p>
      )}
      {/* Story 1.22: kotak 40px dicadangkan sejak render pertama (AC —
          pergantian cadangan → GSI shift 0; pengecualian 48px tercatat di
          .googleBox pada page.module.css). Tanpa overflow:hidden — outline
          fokus tombol cadangan (offset 3px) tidak boleh terpotong. */}
      <div className={styles.googleBox}>
        {/* Tetap di DOM (supaya iframe Google termuat & lebarnya terukur), tapi dilipat sampai tampil. */}
        <div
          ref={buttonRef}
          // .gsi-host (globals.css): color-scheme light supaya iframe GSI tidak jadi kotak putih di tema gelap.
          className="gsi-host"
          style={{ width: '100%', display: 'flex', justifyContent: 'center', ...(gsiVisible ? {} : { height: 0, overflow: 'hidden' }) }}
        />
        {!gsiVisible && (
          <button type="button" onClick={handleFallbackClick} className={`spine-focus-ring ${styles.gsiFallback}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            {t('googleButton')}
          </button>
        )}
      </div>
    </div>
  );
}

const LOGIN_MUTATION = gql`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      success
      message
      errorCode
      token
      user {
        id
        email
        name
        role
        avatarUrl
        accountStatus
        onboardedAt
        permissions
        locale
      }
    }
  }
`;

// Publik: true bila reset password via email sudah aktif di server (env provider email ada).
const PASSWORD_RESET_AVAILABLE = gql`
  query PasswordResetAvailable {
    passwordResetAvailable
  }
`;

const REGISTER_MUTATION = gql`
  mutation Register($input: CreateUserInput!) {
    register(input: $input) {
      success
      message
      errorCode
      token
      user { id email name role avatarUrl }
    }
  }
`;

// Story 1.21: pertanyaan role signup (SignupRole/ROLE_QUESTIONS/ROLE_LABELS
// + state signupRole/signupAnswers) dihapus — jenis akun ditentukan di
// /onboarding; markupnya sudah lama tak dirender.

export default function LandingPage() {
  const t = useTranslations('login');
  const tErr = useTranslations('authErrors');
  const tPw = useTranslations('password');
  const tc = useTranslations('common');
  const productName = brand.productName;
  const [chosenMode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Story 1.13/1.15: fokus ke field password saat login gagal validasi/kredensial.
  const passwordInputRef = useRef<HTMLInputElement>(null);
  // Story 1.14 (review): pengaman kirim-ganda tingkat form — Enter di input
  // (implicit submission) TIDAK selalu men-klik tombol di WebKit, jadi guard
  // tombol saja tidak cukup. Ref, bukan state, agar bebas dari closure basi.
  const submittingRef = useRef(false);
  const [loginMessage, setLoginMessage] = useState<AuthAlert | null>(null);
  // Stable code of the last failed password login (drives the Google highlight).
  const [loginErrorCode, setLoginErrorCode] = useState<string | null>(null);
  // Story 1.23: akun non-ACTIVE sukses login — BUKAN error. Selama pengalihan
  // ke /pending atau /onboarding, tampil baris status peringatan (role="status").
  const [pendingNotice, setPendingNotice] = useState(false);

  const { login: authLogin, isAuthenticated, isLoading } = useAuth();
  // Story 6.3: runtime settings (Google client id, sign-up toggle), no rebuild needed.
  const publicConfig = usePublicConfig();
  const googleClientId = publicConfig?.googleClientId ?? '';
  // Shown only once the settings confirm sign-up is on.
  const signupEnabled = publicConfig?.features.signup === true;
  const mode = signupEnabled ? chosenMode : 'login';

  // Auto-redirect to dashboard if already logged in
  useEffect(() => {
    if (!isLoading && isAuthenticated && typeof window !== 'undefined') {
      window.location.href = '/dashboard';
    }
  }, [isLoading, isAuthenticated]);

  // Story 1.31: prefill sekali pakai — halaman /forgot-password/done menaruh
  // email akun yang baru direset; dihapus di sini agar tidak mengisi ulang
  // saat user bersih manual atau pindah akun.
  useEffect(() => {
    try {
      const prefilled = sessionStorage.getItem(LOGIN_PREFILL_KEY);
      if (prefilled === null) return;
      sessionStorage.removeItem(LOGIN_PREFILL_KEY);
      if (prefilled) setEmail(prefilled);
    } catch {}
  }, []);

  // Story 1.23 (review): pengalihan non-ACTIVE menahan busy sampai navigasi
  // selesai — bila navigasi tak pernah commit dan halaman dipulihkan dari
  // bfcache (tombol Back), state beku membuat form tak bisa dipakai lagi.
  // Lepas kunci saat restore bfcache; jaringan yang membatalkan navigasi
  // di tengah jalan (Esc) tetap butuh reload (deferred-work).
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        submittingRef.current = false;
        setIsSubmitting(false);
        setPendingNotice(false);
      }
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  const [login] = useMutation(LOGIN_MUTATION);
  const [register] = useMutation(REGISTER_MUTATION);
  // Fitur tersembunyi: link "Lupa password?" hanya tampil kalau server sudah mengaktifkan reset via email.
  const { data: resetAvailability, loading: resetAvailabilityLoading } = useQuery(PASSWORD_RESET_AVAILABLE, { fetchPolicy: 'network-only' });
  const passwordResetAvailable = resetAvailability?.passwordResetAvailable === true;

  // Story 1.24: pembuatan/polling QR pindah ke komponen PairingSlot (slot
  // `pairing` di bawah) — lima keadaan bercabang milik komponen itu.

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setLoginMessage(null);
    setLoginErrorCode(null);

    // Story 1.23: saat pengalihan akun non-ACTIVE, status busy DITAHAN —
    // tombol MASUK tetap aria-busy dan kiriman kedua diabaikan sampai
    // navigasi benar-benar terjadi (jaringan lambat = pengalihan tertunda).
    let holdBusy = false;
    try {
      console.warn('[Login] Attempting login for:', email);
      const { data } = await login({ variables: { email, password } });
      console.warn('[Login] Response:', JSON.stringify(data?.login?.success), data?.login?.errorCode);

      if (data?.login?.success && data?.login?.token && data?.login?.user) {
        const lu = data.login.user;
        // Gerbang approval: akun belum ACTIVE tidak boleh ke dashboard.
        if (lu?.accountStatus && lu.accountStatus !== 'ACTIVE') {
          holdBusy = true;
          setPendingNotice(true);
          try { localStorage.setItem('shotstash_token', data.login.token); } catch {}
          await issueMediaCookie(data.login.token);
          window.location.href = lu.onboardedAt ? '/pending' : '/onboarding';
          return;
        }
        console.warn('[Login] Success! Calling authLogin...');
        await issueMediaCookie(data.login.token);
        authLogin(lu, data.login.token);
        return;
      }

      // Backend returned success:false — show error message
      const code: string | null = data?.login?.errorCode ?? null;
      setLoginErrorCode(code);
      setLoginMessage(loginAlert(code));
      // Story 1.13/1.15: fokus pindah ke field yang perlu diperbaiki —
      // pada kegagalan kredensial itu field password (email sudah terisi).
      passwordInputRef.current?.focus();
    } catch (err: any) {
      console.error('Login request failed:', err);
      setLoginMessage(mapAuthError(err, 'server'));
      passwordInputRef.current?.focus();
    } finally {
      if (!holdBusy) {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };


  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setLoginMessage(null);
    setLoginErrorCode(null);
    try {
      // Signup MINIMAL: nama + email + password. Role & onboarding diisi di halaman /onboarding.
      // Akun dibuat berstatus PENDING; role asli ditentukan admin saat approve.
      const { data } = await register({ variables: { input: { name: signupName, email, password } } });
      if (data?.register?.success && data?.register?.token && data?.register?.user) {
        // simpan token lalu arahkan ke onboarding (JANGAN langsung dashboard)
        try { localStorage.setItem('shotstash_token', data.register.token); } catch {}
        await issueMediaCookie(data.register.token);
        window.location.href = '/onboarding';
        return;
      }
      // Story 1.21: "Email sudah terdaftar" memfokuskan field EMAIL —
      // jalan keluarnya ("Masuk lewat tab Login, ...") dirender di form-alert.
      const alert = registerAlert(data?.register?.errorCode);
      setLoginMessage(alert);
      if (alert === 'emailTaken') document.getElementById('email')?.focus();
    } catch (err: any) {
      // EMAIL_TAKEN may also arrive as a GraphQL error code,
      // so the catch path checks the code too.
      const alert = err?.graphQLErrors?.some((e: { extensions?: { code?: unknown } }) => e?.extensions?.code === EMAIL_TAKEN)
        ? 'emailTaken'
        : mapAuthError(err, 'signupFailed');
      setLoginMessage(alert);
      if (alert === 'emailTaken') document.getElementById('email')?.focus();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <AuthPage variant="centered"><p style={{ margin: 'auto', padding: '48px 0', color: 'var(--color-on-surface-variant)' }}>{tc('loading')}</p></AuthPage>;
  if (isAuthenticated) return null; // auto-redirect handles this

  const alertText = (alert: AuthAlert): string => {
    switch (alert) {
      case 'googleOnly':
        return passwordResetAvailable
          ? tErr('googleOnlyWithReset')
          : tErr('googleOnlyNoReset', { productName });
      case 'deactivated':
        return tErr('deactivated', { productName });
      case 'rejected':
        return tErr('rejected', { productName });
      case 'signupDisabled':
        return tErr('signupDisabled', { productName });
      case 'passwordTooShort':
        return tPw('tooShort', { min: MIN_PASSWORD_LENGTH });
      case 'passwordTooLong':
        return tPw('tooLong', { max: MAX_PASSWORD_BYTES });
      default:
        return tErr(alert);
    }
  };

  return (
    <AuthPage variant="split" stage={<HeroStage />}>
      {/* Story 1.20: kartu auth + slot bernama — kartu menyediakan kotak,
          jarak, dan URUTAN slot (tabs → head → form → alt → help → pairing).
          Story 1.21 mengisi slot-tabs/form/help; Story 1.22 mengisi slot-alt
          (pemisah OR + tombol Google + baris status PENDING 1.23); slot
          pairing (QR) milik Story 1.24-1.25.
          Panggung hero tetap milik '/' — foto hanya dirender bila lolos gerbang
          REVIEW.md (src/lib/hero-photos.ts). */}
      <AuthCard
        title={mode === 'login' ? t('titleLogin') : t('titleSignup')}
        subtitle={mode === 'login' ? undefined : t('subtitleSignup')}
        tabs={signupEnabled ? (
          /* Story 1.21: AuthTabs mengisi slot-tabs (tablist + aria-selected +
             panah kiri/kanan). Ganti tab hanya menghapus PESAN form; email,
             password, dan nama dipertahankan (AC: email tidak terhapus). */
          <AuthTabs
            tabs={[
              { key: 'login', label: t('tabLogin') },
              { key: 'signup', label: t('tabSignup') },
            ]}
            value={mode}
            /* Ganti tab menghapus PESAN form DAN baris status PENDING (1.23);
               email, password, dan nama dipertahankan (AC: email tidak
               terhapus). */
            onChange={(next) => {
              setMode(next);
              setLoginMessage(null);
              setLoginErrorCode(null);
              setPendingNotice(false);
            }}
          />
        ) : undefined}
        form={(
          /* Satu <form> untuk kedua tab — Enter di field mana pun mengirim
             form tab yang sedang aktif (AC 1.21). Urutan Login: EMAIL →
             PASSWORD → "Lupa password?" rata kanan → MASUK. Urutan Sign Up:
             FULL NAME → EMAIL → hint minimal 10 → PASSWORD → CREATE ACCOUNT. */
          <form key={mode} onSubmit={mode === 'login' ? handleLogin : handleSignup} className={styles.formStack}>
            {mode === 'signup' && (
              <TextField
                id="signupName"
                label={t('fullNameLabel')}
                type="text"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                placeholder={t('fullNamePlaceholder')}
                autoComplete="name"
                required
              />
            )}
            <TextField
              id="email"
              label={t('emailLabel')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              autoComplete="email"
              required
            />
            <div className={fieldStyles.field}>
              {mode === 'signup' && <p className={`spine-footnote ${styles.minHint}`}>{tPw('minHint', { min: MIN_PASSWORD_LENGTH })}</p>}
              <label className={`spine-label ${fieldStyles.label}`} htmlFor="password">
                {t('passwordLabel')}
              </label>
              <PasswordInput
                id="password"
                inputRef={passwordInputRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`spine-focus-ring ${fieldStyles.input}`}
                placeholder="••••••••"
                required
                minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
            {mode === 'login' &&
              (passwordResetAvailable ? (
                <div className={styles.linkRow}>
                  <TextLink
                    href={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : '/forgot-password'}
                  >
                    {t('forgotPassword')}
                  </TextLink>
                </div>
              ) : (
                // Selama status fitur belum diketahui, teks lama disembunyikan (tanpa geser layout) supaya tidak berkedip.
                <div className={styles.linkRow}>
                  <p
                    className={`spine-footnote ${styles.linkFallback}`}
                    style={{ visibility: resetAvailabilityLoading ? 'hidden' : 'visible' }}
                  >
                    {t('forgotPasswordFallback', { productName })}
                  </p>
                </div>
              ))}
            {mode === 'signup' && (
              // Copy signup dipertahankan (AC 1.21 — hanya gayanya yang baru).
              <p className={`spine-footnote ${styles.signupNote}`}>
                {t.rich('signupNote', { b: (chunks) => <strong>{chunks}</strong> })}
              </p>
            )}
            {/* Story 1.15/1.21: form-alert tepat di atas tombol utama (role="alert").
                "Email sudah terdaftar" diberi jalan keluar eksplisit. */}
            {loginMessage && (
              <FormAlert tone="danger">
                {alertText(loginMessage)}
              </FormAlert>
            )}
            {/* Story 1.23: baris status PENDING — login sukses, bukan error.
                role="status" (sopan), ikon jam selalu ikut, tampil selama
                pengalihan ke /pending atau /onboarding (login password
                maupun Google non-ACTIVE). */}
            {pendingNotice && (
              <div className={styles.pendingRow} role="status">
                <ClockIcon />
                <span className="spine-body-sm">
                  {t.rich('pendingNotice', { b: (chunks) => <strong>{chunks}</strong> })}
                </span>
              </div>
            )}
            {/* Story 1.14: kirim-ganda diabaikan via aria-disabled + aria-busy —
                fokus tidak pernah hilang dari tombol. */}
            <ButtonPrimary
              type="submit"
              busy={isSubmitting}
              busyLabel={mode === 'login' ? t('busyLogin') : t('busySignup')}
              style={{ width: '100%' }}
            >
              {mode === 'login' ? t('submitLogin') : t('submitSignup')}
            </ButtonPrimary>
          </form>
        )}
        alt={googleClientId ? (
          <>
            {/* Story 1.22: pemisah "OR" — typography.micro (.spine-micro).
                Kata visual "OR" aria-hidden (hiasan); pembaca layar membaca
                kata "atau" yang tersembunyi-visual; glyph garis = elemen
                pseudo kosong, tak terdapat teks yang dibacakan. Slot ini
                sama di tab Login maupun Sign Up. */}
            <div className={`spine-micro ${styles.divider}`}>
              <span aria-hidden="true">{t('or')}</span>
              <span className={styles.srOnly}>{t('orSr')}</span>
            </div>

            <GoogleLoginButton
              clientId={googleClientId}
              highlight={mode === 'login' && loginErrorCode === LOGIN_ERROR_CODES.googleOnly}
              onError={(alert) => { setLoginErrorCode(null); setLoginMessage(alert); }}
              onSuccess={async (token: string) => {
                setLoginMessage(null);
                setLoginErrorCode(null);
                try {
                  const res = await fetch('/api/graphql', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: 'mutation GoogleAuth($idToken:String!){googleAuth(idToken:$idToken){token user{id name email role avatarUrl accountStatus onboardedAt permissions locale}}}', variables: { idToken: token } }),
                  });
                  const json = await res.json();
                  if (json.data?.googleAuth?.token) {
                    const gu = json.data.googleAuth.user;
                    try { localStorage.setItem('shotstash_token', json.data.googleAuth.token); } catch {}
                    await issueMediaCookie(json.data.googleAuth.token);
                    // User Google baru berstatus PENDING -> arahkan ke onboarding.
                    if (gu?.accountStatus && gu.accountStatus !== 'ACTIVE') {
                      // Story 1.23: baris status yang sama (bukan pesan error)
                      // tampil sebelum pengalihan.
                      setPendingNotice(true);
                      window.location.href = gu.onboardedAt ? '/pending' : '/onboarding';
                    } else {
                      authLogin(gu, json.data.googleAuth.token);
                    }
                  } else {
                    // Known server reasons map to our own copy; never raw server text.
                    setLoginMessage(googleAlert(json.errors?.[0]));
                  }
                } catch { setLoginMessage('googleNetwork'); }
              }}
            />
          </>
        ) : undefined}
        help={
          /* Story 1.21: teks bantuan akses hanya di tab Login. Di Sign Up
             slot ini kosong dan AuthCard tidak merender wadahnya sama
             sekali (slot tanpa isi tidak menyisakan ruang). */
          mode === 'login' ? (
            <p className={`spine-footnote ${styles.helpText}`}>
              {t.rich('help', { productName, b: (chunks) => <strong>{chunks}</strong> })}
            </p>
          ) : undefined
        }
      />
    </AuthPage>
  );
}
