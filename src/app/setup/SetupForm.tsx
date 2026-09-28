'use client';

/**
 * First-run setup form (Story 2.6): the first super admin account.
 * Built from the existing auth-card, text-field, form-alert and info-note
 * patterns; no new visual language. Copy lives in the `setup` messages.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import AuthCard from '@/components/auth/AuthCard';
import TextField from '@/components/form/TextField';
import { ButtonPrimary } from '@/components/form/buttons';
import { FormAlert } from '@/components/form/FormAlert';
import { InfoNote } from '@/components/overlay/fields';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, passwordProblem } from '@/lib/passwordRule';
import styles from './setup.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'name' | 'email' | 'password' | 'confirm' | 'setupToken';

/** How long the success message stays before the sign-in page opens. */
const REDIRECT_DELAY_MS = 1500;
type Storage = { ok: true } | { ok: false; reason: string };

export default function SetupForm({
  productName,
  storage,
  tokenRequired,
}: {
  productName: string;
  storage: Storage;
  tokenRequired: boolean;
}) {
  const t = useTranslations('setup');
  const router = useRouter();
  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '', setupToken: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const validate = (): Partial<Record<Field, string>> => {
    const out: Partial<Record<Field, string>> = {};
    if (tokenRequired && !values.setupToken.trim()) out.setupToken = t('errors.tokenRequired');
    if (!values.name.trim()) out.name = t('errors.nameRequired');
    if (!EMAIL_PATTERN.test(values.email.trim())) out.email = t('errors.emailInvalid');
    const problem = passwordProblem(values.password);
    if (problem === 'PASSWORD_TOO_SHORT') out.password = t('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
    if (problem === 'PASSWORD_TOO_LONG') out.password = t('errors.passwordTooLong', { max: MAX_PASSWORD_BYTES });
    if (values.confirm !== values.password) out.confirm = t('errors.passwordMismatch');
    return out;
  };

  // Known server codes render from messages; INVALID_INPUT keeps the server's
  // English, field-specific text (it names the exact limit).
  const fieldErrorMessage = (code: string | undefined, message: string | undefined): string => {
    switch (code) {
      case 'PASSWORD_TOO_SHORT': return t('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
      case 'PASSWORD_TOO_LONG': return t('errors.passwordTooLong', { max: MAX_PASSWORD_BYTES });
      case 'PASSWORD_MISMATCH': return t('errors.passwordMismatch');
      case 'SETUP_TOKEN_INVALID': return t('errors.tokenInvalid');
      default: return message ?? t('errors.checkField');
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    busy.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokenRequired ? values : { ...values, setupToken: undefined }),
      });
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string; field?: Field } | null;
      if (res.status === 201) {
        setDone(true);
        window.setTimeout(() => router.replace('/'), REDIRECT_DELAY_MS);
        return;
      }
      if (body?.code === 'SETUP_ALREADY_DONE') {
        setFormError(t('errors.alreadyDone'));
        router.replace('/');
        return;
      }
      if (body?.field) {
        setErrors({ [body.field]: fieldErrorMessage(body.code, body.message) });
        return;
      }
      if (body?.code === 'STORAGE_UNAVAILABLE') {
        setFormError(body.message ? t('errors.storageUnavailable', { reason: body.message }) : t('errors.storageUnavailableGeneric'));
        return;
      }
      setFormError(body?.message || t('errors.failed'));
    } catch {
      setFormError(t('errors.transport'));
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title={t('title', { productName })}
      titleAs="h1"
      pill={null}
      subtitle={t('subtitle')}
      form={
        <form className={styles.stack} onSubmit={onSubmit} noValidate>
          {storage.ok ? (
            <InfoNote>{t('storageOk')}</InfoNote>
          ) : (
            <InfoNote variant="warn">
              {t('storageFailed', { reason: storage.reason })}
            </InfoNote>
          )}
          {formError && <FormAlert tone="danger">{formError}</FormAlert>}
          {tokenRequired && (
            <TextField
              label={t('tokenLabel')}
              type="password"
              autoComplete="off"
              value={values.setupToken}
              error={errors.setupToken}
              onChange={set('setupToken')}
            />
          )}
          {done && <FormAlert tone="ok">{t('done')}</FormAlert>}
          <TextField label={t('nameLabel')} autoComplete="name" value={values.name} error={errors.name} onChange={set('name')} />
          <TextField
            label={t('emailLabel')}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            value={values.email}
            error={errors.email}
            onChange={set('email')}
          />
          <TextField
            label={t('passwordLabel')}
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={values.password}
            error={errors.password}
            onChange={set('password')}
          />
          <TextField
            label={t('confirmLabel')}
            type="password"
            autoComplete="new-password"
            value={values.confirm}
            error={errors.confirm}
            onChange={set('confirm')}
          />
          <p className={`spine-footnote ${styles.hint}`}>{t('minHint', { min: MIN_PASSWORD_LENGTH })}</p>
          <ButtonPrimary type="submit" busy={submitting} busyLabel={t('creating')} disabled={!storage.ok || done} style={{ width: '100%' }}>
            {t('submit')}
          </ButtonPrimary>
        </form>
      }
    />
  );
}
