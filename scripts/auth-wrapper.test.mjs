// Story 2.1: applyAuthMap on stub resolvers; Story 2.3: link liveness and share unlock.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MEDIA_SIGNING_SECRET = 'test-only-signing-secret-0123456789abcdef';

const { applyAuthMap } = await import('../src/graphql/withAuth.ts');
const { linkInactiveReason } = await import('../src/lib/shareState.ts');
const { shareUnlocked } = await import('../src/modules/share/unlock.ts');
const { mintShareAccess, shareCookieName } = await import('../src/modules/share/access.ts');

const actor = (extra = {}) => ({ id: 'u1', role: 'EDITOR', active: true, accountStatus: 'ACTIVE', readOnly: false, ...extra });
const stubs = () => ({
  Query: { projects: () => 'projects', me: () => 'me' },
  Mutation: { createFolder: () => 'created', login: () => 'logged-in' },
  Subscription: { chatMessages: { subscribe: () => 'iterator' } },
});
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.extensions?.code ?? e.message;
  }
  return 'resolved';
};

test('session fields reject a missing or inactive actor with UNAUTHENTICATED', () => {
  const r = applyAuthMap(stubs());
  assert.equal(code(() => r.Query.projects(null, {}, { actor: null }, null)), 'UNAUTHENTICATED');
  assert.equal(code(() => r.Query.projects(null, {}, undefined, null)), 'UNAUTHENTICATED');
  assert.equal(code(() => r.Query.projects(null, {}, { actor: actor({ active: false }) }, null)), 'UNAUTHENTICATED');
  assert.equal(code(() => r.Subscription.chatMessages.subscribe(null, {}, { actor: null }, null)), 'UNAUTHENTICATED');
  assert.equal(r.Query.projects(null, {}, { actor: actor() }, null), 'projects');
});

test('public fields resolve without an actor', () => {
  const r = applyAuthMap(stubs());
  assert.equal(r.Query.me(null, {}, { actor: null }, null), 'me');
  assert.equal(r.Mutation.login(null, {}, {}, null), 'logged-in');
});

test('a read-only actor is FORBIDDEN on mutations while queries resolve', () => {
  const r = applyAuthMap(stubs());
  const ro = { actor: actor({ readOnly: true }) };
  assert.equal(code(() => r.Mutation.createFolder(null, {}, ro, null)), 'FORBIDDEN');
  assert.equal(r.Query.projects(null, {}, ro, null), 'projects');
});

test('a resolver without an auth-map entry stops startup', () => {
  assert.throws(() => applyAuthMap({ Query: { bogusField: () => 1 } }), /Query\.bogusField has no entry/);
});

test('a map entry without a resolver answers NOT_IMPLEMENTED', () => {
  const r = applyAuthMap(stubs());
  assert.equal(code(() => r.Mutation.uploadChunk(null, {}, { actor: actor() }, null)), 'NOT_IMPLEMENTED');
  assert.equal(code(() => r.Subscription.notificationReceived.subscribe(null, {}, { actor: actor() }, null)), 'NOT_IMPLEMENTED');
});

test('linkInactiveReason: revoked beats expired, live links answer null', () => {
  const now = Date.UTC(2026, 8, 27);
  assert.equal(linkInactiveReason({ revokedAt: new Date(now - 1), expiresAt: new Date(now - 1) }, now), 'revoked');
  assert.equal(linkInactiveReason({ revokedAt: null, expiresAt: new Date(now - 1) }, now), 'expired');
  assert.equal(linkInactiveReason({ revokedAt: null, expiresAt: new Date(now) }, now), 'expired');
  assert.equal(linkInactiveReason({ revokedAt: null, expiresAt: new Date(now + 1000) }, now), null);
  assert.equal(linkInactiveReason({ revokedAt: null, expiresAt: null }, now), null);
});

test('shareUnlocked: PUBLIC open, PRIVATE needs this link\'s cookie', () => {
  const jar = (entries) => ({ get: (name) => (name in entries ? { value: entries[name] } : undefined) });
  const priv = { id: 'link-1', slug: 'slugA', mode: 'PRIVATE' };
  const other = { id: 'link-2', slug: 'slugB', mode: 'PRIVATE' };
  const good = mintShareAccess(priv.id).value;

  assert.equal(shareUnlocked(jar({}), { id: 'p', slug: 'pub', mode: 'PUBLIC' }), true, 'PUBLIC');
  assert.equal(shareUnlocked(jar({}), priv), false, 'PRIVATE without cookie');
  assert.equal(shareUnlocked(jar({ [shareCookieName(priv.slug)]: good }), priv), true, 'PRIVATE with its cookie');
  assert.equal(shareUnlocked(jar({ [shareCookieName(other.slug)]: good }), priv), false, 'cookie under another slug');
  assert.equal(shareUnlocked(jar({ [shareCookieName(other.slug)]: good }), other), false, 'cookie minted for another link');
  assert.equal(shareUnlocked(jar({ [shareCookieName(priv.slug)]: `${good}x` }), priv), false, 'tampered cookie');
});

test('PENDING and REJECTED accounts reach only the onboarding fields (Story 2.5)', () => {
  const r = applyAuthMap({
    Query: { projects: () => 'projects', me: () => 'me' },
    Mutation: { createFolder: () => 'created', completeOnboarding: () => 'onboarded', updateProfile: () => 'profile' },
    Subscription: { chatMessages: { subscribe: () => 'iterator' } },
  });
  for (const accountStatus of ['PENDING', 'REJECTED']) {
    const ctx = { actor: actor({ accountStatus }) };
    assert.equal(code(() => r.Query.projects(null, {}, ctx, null)), 'FORBIDDEN');
    assert.equal(code(() => r.Mutation.createFolder(null, {}, ctx, null)), 'FORBIDDEN');
    assert.equal(code(() => r.Subscription.chatMessages.subscribe(null, {}, ctx, null)), 'FORBIDDEN');
    assert.equal(r.Mutation.completeOnboarding(null, {}, ctx, null), 'onboarded');
    assert.equal(r.Mutation.updateProfile(null, {}, ctx, null), 'profile');
    assert.equal(r.Query.me(null, {}, ctx, null), 'me');
  }
});
