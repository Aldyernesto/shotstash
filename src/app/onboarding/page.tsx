'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import AppSelect from '@/components/AppSelect';
import AuthPage from '@/components/auth/AuthPage';
import AuthCard from '@/components/auth/AuthCard';
import { FormAlert } from '@/components/form/FormAlert';
import { ButtonPrimary } from '@/components/form/buttons';
import styles from './onboarding.module.css';

// Story 3.32: halaman onboarding bergaya spine — `auth-topbar` TANPA
// panggung hero, kartu 376 px di tengah (AuthPage 'centered' + AuthCard),
// `question-field` kalimat penuh, dan `select-field` combobox penuh.
//
// Perilaku yang TIDAK berubah: pertanyaan MUNCUL SATU PER SATU (drip),
// pertanyaan lanjutan bergantung jawaban sebelumnya, dan akun tetap
// PENDING sampai admin menyetujui.

type QDef = {
  id: string;
  label: string;
  options: string[];
  followUps?: Record<string, QDef[]>;
};

const DISCOVER_Q: QDef = {
  id: 'discover',
  label: 'Dari mana kamu tahu Shotstash Shotstash?',
  options: [
    'Diundang / direkomendasikan admin',
    'Teman atau kolega',
    'Media sosial (IG / TikTok / YouTube)',
    'Grup travel / umrah',
    'Pencarian Google',
    'Lainnya',
  ],
  followUps: {
    'Media sosial (IG / TikTok / YouTube)': [
      {
        id: 'discover_social',
        label: 'Platform mana yang membuat kamu tahu?',
        options: ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'Lainnya'],
      },
    ],
    'Lainnya': [
      {
        id: 'discover_other',
        label: 'Paling mendekati, dari kategori mana?',
        options: ['Rekan travel/umrah', 'Event / pameran', 'Website / blog', 'Iklan', 'Tidak ingat'],
      },
    ],
  },
};

const ROLE_QUESTIONS: Record<string, QDef[]> = {
  EDITOR: [
    {
      id: 'edit_exp',
      label: 'Sudah berapa lama pengalaman editing videomu?',
      options: ['< 1 tahun', '1–3 tahun', '3–5 tahun', '> 5 tahun'],
    },
    {
      id: 'edit_content',
      label: 'Jenis konten apa yang paling sering kamu edit?',
      options: ['Reels / Shorts', 'Dokumentasi perjalanan', 'Iklan / promosi', 'Vlog panjang', 'Campuran semua'],
      followUps: {
        'Reels / Shorts': [
          {
            id: 'edit_reels_dur',
            label: 'Rata-rata durasi hasil editmu?',
            options: ['< 30 detik', '30–60 detik', '1–3 menit', '> 3 menit'],
          },
        ],
      },
    },
    {
      id: 'edit_software',
      label: 'Software editing utamamu?',
      options: ['Adobe Premiere Pro', 'DaVinci Resolve', 'Final Cut Pro', 'CapCut', 'After Effects', 'Lainnya'],
    },
  ],
  FIELD_CREW: [
    {
      id: 'fc_exp',
      label: 'Sudah berapa lama pengalaman shooting / liputan lapanganmu?',
      options: ['< 1 tahun', '1–3 tahun', '3–5 tahun', '> 5 tahun'],
    },
    {
      id: 'fc_gear',
      label: 'Peralatan utama yang biasa kamu pakai?',
      options: [
        'Kamera mirrorless / DSLR',
        'Kamera cinema (RED / BMPCC dll.)',
        'Smartphone + gimbal',
        'Action cam (GoPro / Insta360)',
        'Drone',
        'Campuran',
      ],
      followUps: {
        'Drone': [
          {
            id: 'fc_drone_cert',
            label: 'Apakah kamu punya sertifikat / izin terbang drone?',
            options: ['Ya, ada', 'Belum ada', 'Sedang diproses'],
          },
        ],
      },
    },
    {
      id: 'fc_file',
      label: 'Bagaimana kamu mengatur file footage setelah shooting?',
      options: ['Folder per tanggal', 'Folder per lokasi / acara', 'Langsung upload ke NAS / cloud', 'Belum ada sistem tetap'],
    },
  ],
  VIEWER: [
    {
      id: 'ag_purpose',
      label: 'Untuk keperluan apa kamu butuh akses footage?',
      options: ['Materi pemasaran media sosial', 'Arsip klien', 'Review hasil produksi', 'Lainnya'],
    },
    {
      id: 'ag_org',
      label: 'Kamu mewakili tim / instansi jenis apa?',
      options: ['Klien', 'Agensi / studio partner', 'Media / content creator', 'Perorangan'],
    },
  ],
};

async function gql(query: string, variables?: any) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('shotstash_token') : '';
  const res = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const WARN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4.5l8.5 15h-17z" />
    <path d="M12 10v4.2M12 17.2v.2" />
  </svg>
);

const ROLE_FIELD_ID = 'role';

export default function OnboardingPage() {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'' | 'EDITOR' | 'FIELD_CREW' | 'VIEWER'>('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  /** Pertanyaan yang ditandai bermasalah — `aria-invalid` per field. */
  const [badField, setBadField] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  /** Tombol tiap field, supaya fokus bisa dipindah ke yang bermasalah. */
  const fieldRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const token = localStorage.getItem('shotstash_token');
    if (!token) { window.location.href = '/'; return; }
    gql('{ me { id name accountStatus onboardedAt } }').then(j => {
      const me = j?.data?.me;
      if (!me) { window.location.href = '/'; return; }
      if (me.accountStatus === 'ACTIVE') { window.location.href = '/dashboard'; return; }
      if (me.onboardedAt) { window.location.href = '/pending'; return; }
      setName(me.name || '');
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  const orderedQuestions = useMemo<QDef[]>(() => {
    if (!role) return [];
    const base: QDef[] = [DISCOVER_Q, ...ROLE_QUESTIONS[role]];
    const out: QDef[] = [];
    for (const q of base) {
      out.push(q);
      const ans = answers[q.id];
      if (ans && q.followUps && q.followUps[ans]) {
        for (const fq of q.followUps[ans]) out.push(fq);
      }
    }
    return out;
  }, [role, answers]);

  const visibleCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < orderedQuestions.length; i++) {
      count = i + 1;
      if (!answers[orderedQuestions[i].id]) break;
    }
    return count;
  }, [orderedQuestions, answers]);

  const allAnswered = role !== '' && orderedQuestions.length > 0 &&
    orderedQuestions.every(q => !!answers[q.id]);

  const setAnswer = (id: string, val: string) => {
    setError('');
    setBadField('');
    setAnswers(prev => {
      const next = { ...prev, [id]: val };
      const parent = orderedQuestions.find(q => q.id === id);
      if (parent?.followUps) {
        for (const key of Object.keys(parent.followUps)) {
          if (key !== val) {
            for (const fq of parent.followUps[key]) delete next[fq.id];
          }
        }
      }
      return next;
    });
  };

  /** Fokus pindah ke pertanyaan pertama yang bermasalah (AC 3.32). */
  const focusField = (id: string) => {
    setBadField(id);
    window.setTimeout(() => fieldRefs.current[id]?.focus(), 0);
  };

  const submit = async () => {
    setError('');
    setBadField('');
    if (!role) { setError('Pilih jenis akun dulu.'); focusField(ROLE_FIELD_ID); return; }
    if (!allAnswered) {
      const first = orderedQuestions.find(q => !answers[q.id]);
      setError('Mohon jawab semua pertanyaan dulu.');
      if (first) focusField(first.id);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        role,
        answers: orderedQuestions.map(q => ({ question: q.label, answer: answers[q.id] })),
      };
      const j = await gql(
        'mutation Onboard($r: Role!, $a: String) { completeOnboarding(requestedRole: $r, signupAnswers: $a) { id accountStatus } }',
        { r: role, a: JSON.stringify(payload) }
      );
      if (j?.data?.completeOnboarding) { window.location.href = '/pending'; return; }
      // Teks server tidak pernah tampil mentah.
      setError('Gagal mengirim. Coba lagi.');
    } catch {
      setError('Gagal mengirim. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  const firstName = name ? name.split(' ')[0] : '';
  const greeting = firstName ? `Selamat datang, ${firstName}` : 'Selamat datang';

  if (!ready) {
    return (
      <AuthPage variant="centered">
        <AuthCard
          title={greeting}
          titleAs="h1"
          subtitle={null}
          pill={null}
          form={<p className={`${styles.loading} spine-body`}>Memuat&hellip;</p>}
        />
      </AuthPage>
    );
  }

  return (
    <AuthPage variant="centered">
      <AuthCard
        title={greeting}
        titleAs="h1"
        subtitle="Beberapa pertanyaan singkat supaya kami menyiapkan studio sesuai kebutuhanmu."
        pill={null}
        form={
          <div className={styles.questions}>
            <QuestionField
              id={ROLE_FIELD_ID}
              label="Kamu ingin bergabung sebagai?"
              value={role}
              placeholder="Pilih jenis akun…"
              options={[
                { value: 'EDITOR', label: 'Editor' },
                { value: 'FIELD_CREW', label: 'Field Crew' },
                { value: 'VIEWER', label: 'Viewer' },
              ]}
              invalid={badField === ROLE_FIELD_ID}
              error={badField === ROLE_FIELD_ID ? error : ''}
              buttonRef={(el) => { fieldRefs.current[ROLE_FIELD_ID] = el; }}
              onChange={(v) => { setRole(v as any); setAnswers({}); setError(''); setBadField(''); }}
            />

            {orderedQuestions.slice(0, visibleCount).map((q) => (
              <QuestionField
                key={q.id}
                id={q.id}
                label={q.label}
                value={answers[q.id] || ''}
                placeholder="Pilih jawaban…"
                options={q.options.map(o => ({ value: o, label: o }))}
                invalid={badField === q.id}
                error={badField === q.id ? error : ''}
                buttonRef={(el) => { fieldRefs.current[q.id] = el; }}
                onChange={(v) => setAnswer(q.id, v)}
              />
            ))}

            {error && !badField && <FormAlert tone="danger">{error}</FormAlert>}

            {allAnswered && (
              <ButtonPrimary
                className={styles.submit}
                busy={submitting}
                busyLabel="Mengirim…"
                onClick={submit}
              >
                Kirim untuk Ditinjau
              </ButtonPrimary>
            )}
          </div>
        }
      />
    </AuthPage>
  );
}

/**
 * `question-field` — kalimat pertanyaan penuh 14 px berat 700 di atas
 * `select-field`, plus pesan error field ber-`aria-describedby`.
 */
function QuestionField({
  id,
  label,
  value,
  placeholder,
  options,
  invalid,
  error,
  onChange,
  buttonRef,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  invalid: boolean;
  error: string;
  onChange: (v: string) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { buttonRef(ref.current); });
  const labelId = `q-${id}-label`;
  const errId = `q-${id}-error`;
  return (
    <div className={styles.field}>
      <span className={styles.label} id={labelId}>{label}</span>
      <AppSelect
        value={value}
        options={options}
        placeholder={placeholder}
        onChange={onChange}
        invalid={invalid}
        labelledBy={labelId}
        describedBy={invalid && error ? errId : undefined}
        buttonRef={ref}
      />
      {invalid && error ? (
        <p className={styles.fieldError} id={errId} role="alert">
          {WARN_ICON}
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
