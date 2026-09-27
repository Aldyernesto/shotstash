// Story 2.4: the permission matrix, cell by cell (node --test, TS via type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  ROLES,
  assertCan,
  can,
  canManageUser,
  permissionsFor,
} from '../src/modules/auth/permissions.ts';

const ALL = ['SUPER_ADMIN', 'ADMIN', 'FIELD_CREW', 'EDITOR', 'VIEWER'];
const NOT_VIEWER = ['SUPER_ADMIN', 'ADMIN', 'FIELD_CREW', 'EDITOR'];

// PRD matrix: action -> roles allowed.
const EXPECTED = {
  'project.view': ALL,
  'media.download': ALL,
  'discussion.use': ALL,
  upload: NOT_VIEWER,
  'section.create': NOT_VIEWER,
  'share.manage': NOT_VIEWER,
  'item.move': NOT_VIEWER,
  'item.trash': NOT_VIEWER,
  'trash.view': NOT_VIEWER,
  'trash.purge': ['SUPER_ADMIN', 'ADMIN'],
  'pipeline.trigger': ['SUPER_ADMIN', 'ADMIN', 'EDITOR'],
  'users.manage': ['SUPER_ADMIN', 'ADMIN'],
  'instance.configure': ['SUPER_ADMIN'],
};

const actor = (role, extra = {}) => ({ id: `u-${role}`, role, active: true, accountStatus: 'ACTIVE', readOnly: false, ...extra });

test('the expected table covers every action and role', () => {
  assert.deepEqual([...ACTIONS].sort(), Object.keys(EXPECTED).sort());
  assert.deepEqual([...ROLES].sort(), [...ALL].sort());
});

for (const action of Object.keys(EXPECTED)) {
  for (const role of ALL) {
    const want = EXPECTED[action].includes(role);
    test(`${role} ${want ? 'may' : 'may not'} ${action}`, () => {
      assert.equal(can(actor(role), action), want);
    });
  }
}

test('read-only accounts keep reads and lose every write', () => {
  const reads = new Set(['project.view', 'media.download', 'trash.view']);
  for (const role of ALL) {
    const ro = actor(role, { readOnly: true });
    for (const action of ACTIONS) {
      const want = reads.has(action) && EXPECTED[action].includes(role);
      assert.equal(can(ro, action), want, `${role} read-only ${action}`);
    }
  }
});

test('inactive, pending, rejected or missing actors get nothing', () => {
  for (const action of ACTIONS) {
    assert.equal(can(null, action), false);
    assert.equal(can(actor('SUPER_ADMIN', { active: false }), action), false);
    assert.equal(can(actor('SUPER_ADMIN', { accountStatus: 'PENDING' }), action), false);
    assert.equal(can(actor('SUPER_ADMIN', { accountStatus: 'REJECTED' }), action), false);
  }
  assert.deepEqual(permissionsFor(null), []);
});

test('permissionsFor lists exactly the allowed actions', () => {
  assert.deepEqual(permissionsFor(actor('VIEWER')).sort(), ['discussion.use', 'media.download', 'project.view']);
  assert.deepEqual(permissionsFor(actor('SUPER_ADMIN')).sort(), [...ACTIONS].sort());
});

test('share links: non-admins manage only their own, admins any', () => {
  const editor = actor('EDITOR');
  assert.equal(can(editor, 'share.manage', { ownerId: editor.id }), true);
  assert.equal(can(editor, 'share.manage', { ownerId: 'someone-else' }), false);
  assert.equal(can(actor('ADMIN'), 'share.manage', { ownerId: 'someone-else' }), true);
  assert.equal(can(actor('VIEWER'), 'share.manage', { ownerId: 'u-VIEWER' }), false);
});

test('upload sessions belong to their uploader only, for every role', () => {
  for (const role of NOT_VIEWER) {
    const a = actor(role);
    assert.equal(can(a, 'upload', { ownerId: a.id }), true);
    assert.equal(can(a, 'upload', { ownerId: 'other' }), false);
  }
});

test('assertCan throws FORBIDDEN, or UNAUTHENTICATED without an actor', () => {
  assert.throws(() => assertCan(actor('VIEWER'), 'item.trash'), (e) => e.extensions?.code === 'FORBIDDEN');
  assert.throws(() => assertCan(null, 'project.view'), (e) => e.extensions?.code === 'UNAUTHENTICATED');
  assert.doesNotThrow(() => assertCan(actor('EDITOR'), 'item.trash'));
});

test('user targets: admins cannot touch a super admin', () => {
  const admin = actor('ADMIN');
  const sa = { id: 'sa', role: 'SUPER_ADMIN' };
  for (const change of [{ kind: 'role', role: 'EDITOR' }, { kind: 'deactivate' }, { kind: 'reactivate' }, { kind: 'password' }, { kind: 'delete' }]) {
    assert.equal(canManageUser(admin, sa, change, 2), false, change.kind);
  }
  assert.equal(canManageUser(admin, { id: 'e', role: 'EDITOR' }, { kind: 'deactivate' }, 2), true);
  assert.equal(canManageUser(admin, { id: 'e', role: 'EDITOR' }, { kind: 'role', role: 'ADMIN' }, 2), true);
});

test('user targets: only a super admin grants SUPER_ADMIN', () => {
  assert.equal(canManageUser(actor('ADMIN'), { id: 'e', role: 'EDITOR' }, { kind: 'role', role: 'SUPER_ADMIN' }, 1), false);
  assert.equal(canManageUser(actor('ADMIN'), null, { kind: 'create', role: 'SUPER_ADMIN' }, 1), false);
  assert.equal(canManageUser(actor('ADMIN'), { id: 'p', role: 'EDITOR' }, { kind: 'approve', role: 'SUPER_ADMIN' }, 1), false);
  assert.equal(canManageUser(actor('SUPER_ADMIN'), { id: 'e', role: 'EDITOR' }, { kind: 'role', role: 'SUPER_ADMIN' }, 1), true);
  assert.equal(canManageUser(actor('SUPER_ADMIN'), { id: 'e', role: 'EDITOR' }, { kind: 'role', role: 'NOT_A_ROLE' }, 1), false);
});

test('user targets: the last super admin cannot demote or deactivate themselves', () => {
  const sa = actor('SUPER_ADMIN');
  const self = { id: sa.id, role: 'SUPER_ADMIN' };
  assert.equal(canManageUser(sa, self, { kind: 'role', role: 'ADMIN' }, 1), false);
  assert.equal(canManageUser(sa, self, { kind: 'deactivate' }, 1), false);
  assert.equal(canManageUser(sa, self, { kind: 'role', role: 'ADMIN' }, 2), true);
  assert.equal(canManageUser(sa, { id: 'sa2', role: 'SUPER_ADMIN' }, { kind: 'deactivate' }, 2), true);
});

test('user targets: approve with a lower role demotes like a role change', () => {
  const sa = actor('SUPER_ADMIN');
  const self = { id: sa.id, role: 'SUPER_ADMIN' };
  assert.equal(canManageUser(sa, self, { kind: 'approve', role: 'EDITOR' }, 1), false, 'last SA via approve');
  assert.equal(canManageUser(actor('ADMIN'), { id: 'sa2', role: 'SUPER_ADMIN' }, { kind: 'approve', role: 'VIEWER' }, 3), false, 'admin on SA');
  assert.equal(canManageUser(sa, { id: 'sa2', role: 'SUPER_ADMIN' }, { kind: 'approve', role: 'EDITOR' }, 2), true, 'SA with another SA left');
  assert.equal(canManageUser(sa, self, { kind: 'approve', role: 'SUPER_ADMIN' }, 1), true, 'no demotion');
  assert.equal(canManageUser(actor('ADMIN'), { id: 'p', role: 'EDITOR' }, { kind: 'approve', role: 'EDITOR' }, 1), true, 'normal approval');
});

test('user targets: password reset and deletion never hit oneself or a super admin', () => {
  const sa = actor('SUPER_ADMIN');
  assert.equal(canManageUser(sa, { id: sa.id, role: 'SUPER_ADMIN' }, { kind: 'password' }, 3), false);
  assert.equal(canManageUser(sa, { id: 'sa2', role: 'SUPER_ADMIN' }, { kind: 'delete' }, 3), false);
  assert.equal(canManageUser(sa, { id: 'e', role: 'EDITOR' }, { kind: 'password' }, 1), true);
});

test('user management needs users.manage and a writable account', () => {
  const target = { id: 'e', role: 'EDITOR' };
  for (const role of ['FIELD_CREW', 'EDITOR', 'VIEWER']) {
    assert.equal(canManageUser(actor(role), target, { kind: 'deactivate' }, 1), false, role);
  }
  assert.equal(canManageUser(actor('ADMIN', { readOnly: true }), target, { kind: 'deactivate' }, 1), false);
});
