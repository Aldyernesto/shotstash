// Story 3.5: server text by code. Every code the server can emit has an
// English message, the password-reset email follows the recipient's locale
// and the instance time zone, and client error helpers read codes by
// structure, never by message text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { makeTranslator } = await import('../src/modules/i18n/translator.ts');
const { passwordResetCopy } = await import('../src/emails/passwordResetCopy.ts');
const codes = await import('../src/lib/errorCodes.ts');

const en = JSON.parse(readFileSync(path.join(ROOT, 'messages', 'en.json'), 'utf8'));
const t = makeTranslator({ en }, 'en');

/* ---------------- codes the server can emit ---------------- */

// Server-side code: API routes, share routes, GraphQL, services, modules,
// shared libs, and the custom server. Client components never emit codes.
const SERVER_DIRS = ['src/graphql', 'src/services', 'src/modules', 'src/app/api', 'src/app/s', 'src/lib'];
const SERVER_FILES = ['server.ts'];

// Codes Apollo Server itself answers with (parse, validation, masked crash).
const APOLLO_BUILTIN = ['INTERNAL_SERVER_ERROR', 'GRAPHQL_PARSE_FAILED', 'GRAPHQL_VALIDATION_FAILED', 'BAD_USER_INPUT', 'BAD_REQUEST'];

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) return e.name === 'generated' ? [] : walk(child);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [child] : [];
  });
}

const CODE = "['\"]([A-Z][A-Z0-9_]+)['\"]";
const EMIT_PATTERNS = [
  new RegExp(`\\bcode:\\s*${CODE}`, 'g'), // { code: 'X' } in a GraphQL extension or REST body
  new RegExp(`\\berrorCode:\\s*${CODE}`, 'g'), // payload errorCode
  new RegExp(`jsonError\\(\\s*\\d+\\s*,\\s*${CODE}`, 'g'),
  new RegExp(`(?:codedError|trashError)\\(\\s*${CODE}`, 'g'),
  new RegExp(`new (?:PasswordResetError|AdminActionError)\\(\\s*${CODE}`, 'g'),
];

/** Every string literal of `type XxxErrorCode = 'A' | 'B'` and `type PasswordProblem = ...`. */
function unionCodes(text) {
  const out = [];
  for (const m of text.matchAll(/export type (?:\w*ErrorCode|PasswordProblem)\s*=([^;]+);/g)) {
    for (const lit of m[1].matchAll(new RegExp(CODE, 'g'))) out.push(lit[1]);
  }
  return out;
}

/** `export const NAME = 'CODE'` constants and object literals of code constants in authMessages. */
function authConstantCodes(text) {
  return [...text.matchAll(new RegExp(`(?:=|:)\\s*${CODE}`, 'g'))].map((m) => m[1]);
}

export function serverEmittedCodes() {
  const files = [...SERVER_DIRS.flatMap(walk), ...SERVER_FILES.filter((f) => existsSync(path.join(ROOT, f)))];
  const found = new Set(APOLLO_BUILTIN);
  for (const rel of files) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of EMIT_PATTERNS) for (const m of text.matchAll(re)) found.add(m[1]);
    for (const c of unionCodes(text)) found.add(c);
    if (rel.endsWith('authMessages.ts')) for (const c of authConstantCodes(text)) found.add(c);
  }
  return [...found].sort();
}

test('every code the server can emit has an English message in errors.codes', () => {
  const all = serverEmittedCodes();
  // A broken pattern would find (almost) nothing and pass vacuously.
  assert.ok(all.length >= 45, `only ${all.length} codes found: ${all.join(', ')}`);
  for (const must of ['USER_HAS_ACTIVITY', 'ALREADY_HANDLED', 'INVALID_CREDENTIALS', 'NOT_IN_TRASH', 'SETUP_REQUIRED', 'TOO_LARGE']) {
    assert.ok(all.includes(must), `scan misses ${must}`);
  }
  const missing = all.filter((c) => typeof en.errors?.codes?.[c] !== 'string');
  assert.deepEqual(missing, [], `codes without errors.codes messages: ${missing.join(', ')}`);
});

test('code messages render with their ICU arguments', () => {
  assert.equal(t('forgotPassword.errors.invalidCodeAttempts', { count: 3 }), 'Wrong code. 3 attempts left.');
  assert.equal(t('forgotPassword.errors.invalidCodeAttempts', { count: 1 }), 'Wrong code. 1 attempt left.');
  assert.match(t('errors.codes.USER_HAS_ACTIVITY'), /Deactivate it instead/);
  assert.match(t('errors.codes.MESSAGE_TOO_LONG', { maxLength: 5000 }), /5,000/);
  assert.equal(
    t('errors.codes.FILE_TYPE_NOT_ALLOWED', { sectionType: 'video', ext: 'pdf' }),
    "This Section only takes videos, so .pdf files can't go here.",
  );
});

test('code messages need no arguments the client cannot supply', () => {
  // useHumanizeError passes only the values the error carries; these codes
  // are rendered from errors that carry nothing else.
  const noArgs = ['USER_HAS_ACTIVITY', 'USER_NOT_FOUND', 'ALREADY_HANDLED', 'ACCOUNT_DEACTIVATED', 'INTERNAL', 'FORBIDDEN'];
  for (const c of noArgs) assert.doesNotMatch(en.errors.codes[c], /\{/, c);
});

/* ---------------- password reset email ---------------- */

test('reset email: null locale, DEFAULT_TIMEZONE=UTC -> English, lang="en", time with "UTC"', () => {
  // Real resolution: no user locale, no DEFAULT_LOCALE, DEFAULT_TIMEZONE=UTC.
  const env = { locale: process.env.DEFAULT_LOCALE, zone: process.env.DEFAULT_TIMEZONE };
  delete process.env.DEFAULT_LOCALE;
  process.env.DEFAULT_TIMEZONE = 'UTC';
  let copy;
  try {
    copy = passwordResetCopy({
    translatorFor: (l) => makeTranslator({ en }, l),
    locale: null,
    name: 'Dana',
    email: 'dana@example.com',
    expiresAt: new Date('2026-09-28T10:15:00Z'),
    validMinutes: 15,
    productName: 'Shotstash',
  });
  } finally {
    if (env.locale === undefined) delete process.env.DEFAULT_LOCALE;
    else process.env.DEFAULT_LOCALE = env.locale;
    if (env.zone === undefined) delete process.env.DEFAULT_TIMEZONE;
    else process.env.DEFAULT_TIMEZONE = env.zone;
  }
  assert.equal(copy.lang, 'en');
  assert.equal(copy.subject, 'Your Shotstash password reset code');
  assert.equal(copy.greeting, 'Hi Dana,');
  assert.match(copy.validity, /15 minutes/);
  assert.match(copy.validity, /10:15 UTC/);
  assert.match(copy.intro, /dana@example\.com/);
  for (const v of Object.values(copy)) assert.doesNotMatch(v, /\{|\}/, `unfilled placeholder in "${v}"`);
});

test('reset email: an unsupported locale is English, an invalid zone is UTC, an empty name gets the generic greeting', () => {
  const copy = passwordResetCopy({
    translatorFor: (l) => makeTranslator({ en }, l),
    locale: 'fr',
    timeZone: 'Not/AZone',
    name: '  ',
    email: 'x@example.com',
    expiresAt: new Date('2026-09-28T23:05:00Z'),
    validMinutes: 1,
    productName: 'Shotstash',
  });
  assert.match(copy.validity, /1 minute \(until 23:05 UTC\)/);
  assert.equal(copy.greeting, 'Hi there,');
});

test('translatorFor resolves a null or unknown recipient locale to English', async () => {
  const { resolveLocale } = await import('../src/i18n/config.ts');
  assert.equal(resolveLocale(null, undefined), 'en');
  assert.equal(resolveLocale('fr', 'xx'), 'en');
});

/* ---------------- client error helpers ---------------- */

test('errorCodeOf: REST body, GraphQL extension, Apollo error and admin payload', () => {
  assert.equal(codes.errorCodeOf({ code: 'TOO_LARGE', message: 'x' }), 'TOO_LARGE');
  assert.equal(codes.errorCodeOf({ message: 'x', extensions: { code: 'NOT_FOUND' } }), 'NOT_FOUND');
  assert.equal(
    codes.errorCodeOf({ message: 'Forbidden', graphQLErrors: [{ message: 'y', extensions: { code: 'FORBIDDEN' } }] }),
    'FORBIDDEN',
  );
  assert.equal(
    codes.errorCodeOf({ networkError: { statusCode: 400, result: { errors: [{ extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] } } }),
    'GRAPHQL_VALIDATION_FAILED',
  );
  assert.equal(codes.errorCodeOf({ success: false, message: 'm', errorCode: 'USER_HAS_ACTIVITY' }), 'USER_HAS_ACTIVITY');
  assert.equal(codes.errorCodeOf({ success: false, errorCode: null }), null);
  assert.equal(codes.errorCodeOf(new Error('User not found')), null);
  assert.equal(codes.errorCodeOf(null), null);
});

test('errorDetailsOf: numbers and strings next to the code, never code or message', () => {
  assert.deepEqual(codes.errorDetailsOf({ errorCode: 'INVALID_CODE', message: 'm', attemptsLeft: 3, resetToken: null }), {
    attemptsLeft: 3,
  });
  assert.deepEqual(
    codes.errorDetailsOf({ graphQLErrors: [{ message: 'm', extensions: { code: 'MESSAGE_TOO_LONG', maxLength: 5000 } }] }),
    { maxLength: 5000 },
  );
  assert.deepEqual(codes.errorDetailsOf(new Error('x')), {});
});

test('errorKind: structure only, never message text', () => {
  assert.equal(codes.errorKind({ graphQLErrors: [{ extensions: { code: 'UNAUTHENTICATED' } }] }), 'session');
  assert.equal(codes.errorKind({ networkError: { statusCode: 502 } }), 'server');
  assert.equal(codes.errorKind({ networkError: { statusCode: 401 } }), 'session');
  assert.equal(codes.errorKind({ networkError: { message: 'Failed to fetch' } }), 'offline');
  assert.equal(codes.errorKind(new TypeError('Failed to fetch')), 'offline');
  assert.equal(codes.errorKind(Object.assign(new Error('x'), { name: 'AbortError' })), 'timeout');
  assert.equal(codes.errorKind({ status: 404 }), 'notFound');
  // Text alone never classifies.
  assert.equal(codes.errorKind(new Error('Unauthorized 401 not found timeout')), 'generic');
  assert.equal(codes.errorKind('HTTP 502'), 'generic');
});

test('errorCodeOf accepts only codes with a message in errors.codes', () => {
  for (const system of ['P2025', 'ENOSPC', 'ERR_NETWORK', 'ECONNRESET', 'SOMETHING_NEW']) {
    assert.equal(codes.errorCodeOf({ code: system, message: 'x' }), null, system);
    assert.equal(codes.errorCodeOf({ extensions: { code: system } }), null, system);
  }
  assert.equal(codes.isKnownErrorCode('TOO_LARGE'), true);
  assert.equal(codes.isKnownErrorCode('ENOSPC'), false);
  assert.equal(codes.errorKind({ code: 'P2025' }), 'generic');
});

test('errorKind: FORBIDDEN and a bare 403 are forbidden', () => {
  assert.equal(codes.errorKind({ graphQLErrors: [{ extensions: { code: 'FORBIDDEN' } }] }), 'forbidden');
  assert.equal(codes.errorKind({ status: 403 }), 'forbidden');
  assert.equal(codes.errorKind({ networkError: { statusCode: 403 } }), 'forbidden');
  assert.ok(en.errors.forbidden, 'errors.forbidden has a message');
});
