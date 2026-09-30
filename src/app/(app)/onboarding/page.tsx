'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import AppSelect from '@/components/AppSelect';
import { brand } from '@/lib/brand';
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

// Question sets hold ids only; the copy lives in `onboarding.questions`
// (`<id>.label`, `<id>.options.<option>`). Answers are option ids, so a
// follow-up is keyed by the option id that opens it.
type QuestionId =
  | 'discover' | 'discover_social' | 'discover_other'
  | 'edit_exp' | 'edit_content' | 'edit_reels_dur' | 'edit_software'
  | 'fc_exp' | 'fc_gear' | 'fc_drone_cert' | 'fc_file'
  | 'ag_purpose' | 'ag_org';

type QDef = {
  id: QuestionId;
  options: string[];
  followUps?: Record<string, QDef[]>;
};

const DISCOVER_Q: QDef = {
  id: 'discover',
  options: ['invited', 'friend', 'social', 'travelGroup', 'google', 'other'],
  followUps: {
    social: [
      { id: 'discover_social', options: ['instagram', 'tiktok', 'youtube', 'facebook', 'other'] },
    ],
    other: [
      { id: 'discover_other', options: ['travelPartner', 'event', 'website', 'ad', 'dontRemember'] },
    ],
  },
};

const ROLE_QUESTIONS: Record<string, QDef[]> = {
  EDITOR: [
    { id: 'edit_exp', options: ['lt1', 'y1to3', 'y3to5', 'gt5'] },
    {
      id: 'edit_content',
      options: ['reels', 'travelDocs', 'ads', 'longVlog', 'mix'],
      followUps: {
        reels: [{ id: 'edit_reels_dur', options: ['lt30', 's30to60', 'm1to3', 'gt3'] }],
      },
    },
    { id: 'edit_software', options: ['premiere', 'resolve', 'finalCut', 'capcut', 'afterEffects', 'other'] },
  ],
  FIELD_CREW: [
    { id: 'fc_exp', options: ['lt1', 'y1to3', 'y3to5', 'gt5'] },
    {
      id: 'fc_gear',
      options: ['mirrorless', 'cinema', 'phone', 'action', 'drone', 'mix'],
      followUps: {
        drone: [{ id: 'fc_drone_cert', options: ['yes', 'no', 'inProgress'] }],
      },
    },
    { id: 'fc_file', options: ['byDate', 'byEvent', 'upload', 'none'] },
  ],
  VIEWER: [
    { id: 'ag_purpose', options: ['marketing', 'clientArchive', 'review', 'other'] },
    { id: 'ag_org', options: ['client', 'agency', 'media', 'individual'] },
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
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const tq = useTranslations('onboarding.questions');
  type QuestionKey = Parameters<typeof tq>[0];
  const questionLabel = (q: QDef) => tq(`${q.id}.label`, { productName: brand.productName });
  const optionLabel = (q: QDef, option: string) => tq(`${q.id}.options.${option}` as QuestionKey);
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
    if (!role) { setError(t('chooseRole')); focusField(ROLE_FIELD_ID); return; }
    if (!allAnswered) {
      const first = orderedQuestions.find(q => !answers[q.id]);
      setError(t('answerAll'));
      if (first) focusField(first.id);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        role,
        answers: orderedQuestions.map(q => ({ question: questionLabel(q), answer: optionLabel(q, answers[q.id]) })),
      };
      const j = await gql(
        'mutation Onboard($r: Role!, $a: String) { completeOnboarding(requestedRole: $r, signupAnswers: $a) { id accountStatus } }',
        { r: role, a: JSON.stringify(payload) }
      );
      if (j?.data?.completeOnboarding) { window.location.href = '/pending'; return; }
      // Teks server tidak pernah tampil mentah.
      setError(t('submitFailed'));
    } catch {
      setError(t('submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const firstName = name ? name.split(' ')[0] : '';
  const greeting = firstName ? t('greeting', { name: firstName }) : t('greetingAnon');

  if (!ready) {
    return (
      <AuthPage variant="centered">
        <AuthCard
          title={greeting}
          titleAs="h1"
          subtitle={null}
          pill={null}
          form={<p className={`${styles.loading} spine-body`}>{tc('loading')}</p>}
        />
      </AuthPage>
    );
  }

  return (
    <AuthPage variant="centered">
      <AuthCard
        title={greeting}
        titleAs="h1"
        subtitle={t('subtitle')}
        pill={null}
        form={
          <div className={styles.questions}>
            <QuestionField
              id={ROLE_FIELD_ID}
              label={t('roleQuestion')}
              value={role}
              placeholder={t('rolePlaceholder')}
              options={[
                { value: 'EDITOR', label: t('roleOptions.editor') },
                { value: 'FIELD_CREW', label: t('roleOptions.crew') },
                { value: 'VIEWER', label: t('roleOptions.viewer') },
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
                label={questionLabel(q)}
                value={answers[q.id] || ''}
                placeholder={t('answerPlaceholder')}
                options={q.options.map(o => ({ value: o, label: optionLabel(q, o) }))}
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
                busyLabel={t('submitting')}
                onClick={submit}
              >
                {t('submit')}
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
