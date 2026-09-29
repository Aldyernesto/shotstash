// Story 3.5: notifications render from `type` + `data` in the reader's
// locale; old rows without the needed data keep their stored text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { makeTranslator } = await import('../src/modules/i18n/translator.ts');
const { notificationText, parseNotificationData } = await import('../src/lib/notificationText.ts');

const en = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));
const root = makeTranslator({ en }, 'en');
const t = (key, values) => root(`notifications.${key}`, values);

test('chat_mention renders project, sender and excerpt from data', () => {
  const out = notificationText(
    {
      type: 'chat_mention',
      title: 'stored title',
      body: 'stored body',
      data: JSON.stringify({ projectId: 'p1', chatId: 'c1', projectTitle: 'Summer Shoot', senderName: 'Rina', excerpt: 'Check @B-Roll' }),
    },
    t,
  );
  assert.deepEqual(out, { label: 'Chat', title: 'New message in Summer Shoot', body: 'Rina: Check @B-Roll' });
});

test('chat_mention without a sender name uses the translated placeholder, never an email', () => {
  const out = notificationText(
    { type: 'chat_mention', data: { projectId: 'p1', chatId: 'c1', projectTitle: 'Summer Shoot', excerpt: 'hi' } },
    t,
  );
  assert.equal(out.body, `${t('someone')}: hi`);
  assert.equal(t('someone'), 'Someone');
});

test('project_created, upload_complete and file_shared render from data', () => {
  assert.deepEqual(notificationText({ type: 'project_created', data: { projectId: 'p', projectTitle: 'Expo' } }, t), {
    label: 'Project',
    title: 'New Project',
    body: 'Expo was created',
  });
  assert.equal(
    notificationText({ type: 'upload_complete', data: { projectId: 'p', fileId: 'f', fileName: 'a.mp4', projectTitle: 'Expo' } }, t).body,
    'a.mp4 was added to Expo',
  );
  assert.equal(notificationText({ type: 'upload_complete', data: { fileName: 'a.mp4' } }, t).body, 'a.mp4 was added');
  const shared = notificationText({ type: 'file_shared', data: { slug: 's', fileId: '', fileName: 'B-Roll', targetKind: 'section' } }, t);
  assert.deepEqual(shared, { label: 'Share', title: 'Share link created', body: 'New share link for Section B-Roll' });
  assert.equal(
    notificationText({ type: 'file_shared', data: { fileName: 'a.jpg', targetKind: 'weird' } }, t).body,
    'New share link for file a.jpg',
  );
});

test('missing or partial data falls back to the stored title and body', () => {
  const stored = { title: 'New message in Old', body: 'Someone: hi' };
  assert.deepEqual(notificationText({ type: 'chat_mention', ...stored, data: '{}' }, t), { label: 'Chat', ...stored });
  assert.deepEqual(
    notificationText({ type: 'chat_mention', ...stored, data: { projectId: 'p', chatId: 'c' } }, t),
    { label: 'Chat', ...stored },
  );
  assert.deepEqual(notificationText({ type: 'project_created', ...stored, data: 'not json' }, t), { label: 'Project', ...stored });
  assert.deepEqual(notificationText({ type: 'mystery', ...stored, data: { x: '1' } }, t), { label: 'Info', ...stored });
  assert.deepEqual(notificationText({ type: 'upload_complete', data: null }, t), { label: 'Upload', title: '', body: '' });
});

test('parseNotificationData keeps only non-empty string and number fields', () => {
  assert.deepEqual(parseNotificationData('{"a":"x","b":"","c":3,"d":null,"e":{}}'), { a: 'x', c: '3' });
  assert.deepEqual(parseNotificationData('[1,2]'), {});
  assert.deepEqual(parseNotificationData(undefined), {});
});
