'use client';

/**
 * First-run setup form (Story 2.6): the first super admin account.
 * Built from the existing auth-card, text-field, form-alert and info-note
 * patterns; no new visual language. English copy (Epic 3 externalises it).
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthCard from '@/components/auth/AuthCard';
import TextField from '@/components/form/TextField';
import { ButtonPrimary } from '@/components/form/buttons';
import { FormAlert } from '@/components/form/FormAlert';
import { InfoNote } from '@/components/overlay/fields';
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_LONG_MESSAGE, passwordProblem } from '@/lib/passwordRule';
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
    if (tokenRequired && !values.setupToken.trim()) out.setupToken = 'Enter the setup token from the server configuration.';
    if (!values.name.trim()) out.name = 'Enter your name.';
    if (!EMAIL_PATTERN.test(values.email.trim())) out.email = 'Enter a valid email address.';
    const problem = passwordProblem(values.password);
    if (problem === 'PASSWORD_TOO_SHORT') out.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (problem === 'PASSWORD_TOO_LONG') out.password = PASSWORD_TOO_LONG_MESSAGE;
    if (values.confirm !== values.password) out.confirm = 'The passwords do not match.';
    return out;
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
        setFormError('Setup is already complete. Sign in instead.');
        router.replace('/');
        return;
      }
      if (body?.field) {
        setErrors({ [body.field]: body.message ?? 'Check this field.' });
        return;
      }
      if (body?.code === 'STORAGE_UNAVAILABLE') {
        setFormError(`The media folder is not writable: ${body.message ?? 'check STORAGE_LOCAL_ROOT'}.`);
        return;
      }
      setFormError(body?.message || 'Setup failed. Try again.');
    } catch {
      setFormError('Cannot reach the server. Check the connection and try again.');
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title={`Set up ${productName}`}
      titleAs="h1"
      titleLang="en"
      pill={null}
      subtitle="Create the owner account. It becomes the super admin of this installation."
      form={
        <form className={styles.stack} onSubmit={onSubmit} noValidate lang="en">
          {storage.ok ? (
            <InfoNote>Storage check passed: the media folder is writable.</InfoNote>
          ) : (
            <InfoNote variant="warn">
              Storage check failed: {storage.reason} Fix STORAGE_LOCAL_ROOT, then reload this page.
            </InfoNote>
          )}
          {formError && <FormAlert tone="danger">{formError}</FormAlert>}
          {tokenRequired && (
            <TextField
              label="Setup token"
              type="password"
              autoComplete="off"
              value={values.setupToken}
              error={errors.setupToken}
              onChange={set('setupToken')}
            />
          )}
          {done && <FormAlert tone="ok">Setup complete. Sign in with the new account.</FormAlert>}
          <TextField label="Name" autoComplete="name" value={values.name} error={errors.name} onChange={set('name')} />
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={values.email}
            error={errors.email}
            onChange={set('email')}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={values.password}
            error={errors.password}
            onChange={set('password')}
          />
          <TextField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={values.confirm}
            error={errors.confirm}
            onChange={set('confirm')}
          />
          <p className={`spine-footnote ${styles.hint}`}>At least {MIN_PASSWORD_LENGTH} characters.</p>
          <ButtonPrimary type="submit" busy={submitting} busyLabel="Creating..." disabled={!storage.ok || done} style={{ width: '100%' }}>
            Create owner account
          </ButtonPrimary>
        </form>
      }
    />
  );
}
