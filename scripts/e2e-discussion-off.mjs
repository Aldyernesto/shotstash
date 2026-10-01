// End-to-end check of the discussion toggle (Story 5.5) against an app
// process started with SHOTSTASH_FEATURE_DISCUSSION=false (CI runs a short
// third process for it):
//
//   SHOTSTASH_FEATURE_DISCUSSION=false PORT=3007 node dist/server.js
//   E2E_BASE_URL=http://127.0.0.1:3007 npm run e2e:discussion-off
//
// Asserts the discussion API answers FEATURE_DISABLED, a Project still loads
// with an empty chat list, the event stream carries no chat events and
// me.features.discussion is false. Needs the seeded development accounts.
import 'dotenv/config';
import WebSocket from 'ws';
import { createClient } from 'graphql-ws';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3005';
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
if (!LOCAL.has(hostOf(B))) {
  console.error(`e2e:discussion-off refuses to run: base URL ${B} is not localhost.`);
  process.exit(2);
}

let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`);
  if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (email) =>
  (await (await fetch(`${B}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'shotstash-dev' }) })).json()).token;
const gql = async (token, query, variables) =>
  (await fetch(`${B}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) })).json();
const code = (res) => res.errors?.[0]?.extensions?.code;

/** Collects the payloads of one subscription. */
function subscribe(token, query, variables) {
  const client = createClient({
    url: `${B.replace(/^http/, 'ws')}/api/graphql`,
    webSocketImpl: WebSocket,
    connectionParams: { authorization: `Bearer ${token}` },
    retryAttempts: 0,
  });
  const items = [];
  let end = null;
  client.subscribe({ query, variables }, { next: (v) => items.push(v), error: (e) => (end = { error: e }), complete: () => (end ??= { complete: true }) });
  return { items, ended: () => end, close: () => client.dispose() };
}

const editor = await login('editor@example.com');
ok(!!editor, 'login');
const me = await gql(editor, '{ me { features { discussion } } }');
ok(me.data?.me?.features?.discussion === false, 'me.features.discussion is false', JSON.stringify(me.data ?? me.errors));
const project = (await gql(editor, '{ projects { id title } }')).data?.projects?.find((p) => p.title === 'Sample project');
ok(!!project, 'the Sample project is listed');

const loaded = await gql(editor, 'query($p: ID!){ project(id:$p){ id title chats { id } } }', { p: project.id });
ok(loaded.data?.project?.id === project.id && Array.isArray(loaded.data.project.chats) && loaded.data.project.chats.length === 0 && !loaded.errors, 'the Project loads with an empty chat list', JSON.stringify(loaded.errors ?? ''));

const sent = await gql(editor, 'mutation($p: ID!){ sendMessage(projectId:$p, message:"hello"){ id } }', { p: project.id });
ok(code(sent) === 'FEATURE_DISABLED', 'sendMessage answers FEATURE_DISABLED', code(sent));
const people = await gql(editor, 'query($p: ID!){ mentionPeople(projectId:$p, query:"a"){ id } }', { p: project.id });
ok(code(people) === 'FEATURE_DISABLED', 'mentionPeople answers FEATURE_DISABLED', code(people));

const chatSub = subscribe(editor, 'subscription($p: ID!){ chatMessages(projectId:$p){ id } }', { p: project.id });
for (let i = 0; i < 40 && !chatSub.ended() && !chatSub.items.length; i++) await sleep(100);
const chatCode = chatSub.items[0]?.errors?.[0]?.extensions?.code ?? chatSub.ended()?.error?.[0]?.extensions?.code;
ok(chatCode === 'FEATURE_DISABLED', 'chatMessages answers FEATURE_DISABLED', String(chatCode));

// Chat written while the toggle was on (or through another process) never reaches projectEvents here.
const events = subscribe(editor, 'subscription($p: ID!){ projectEvents(projectId:$p){ type id chat { id } } }', { p: project.id });
await sleep(1500);
const other = process.env.E2E_OTHER_BASE_URL;
if (other) {
  const otherToken = (await (await fetch(`${other}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'editor@example.com', password: 'shotstash-dev' }) })).json()).token;
  await fetch(`${other}/api/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${otherToken}` },
    body: JSON.stringify({ query: 'mutation($p: ID!){ sendMessage(projectId:$p, message:"from the other process"){ id } }', variables: { p: project.id } }),
  });
}
await sleep(1500);
ok(!events.items.some((v) => v.data?.projectEvents?.type === 'chat.created'), 'projectEvents delivers no chat events', other ? '' : '(no E2E_OTHER_BASE_URL: no chat was sent)');

chatSub.close();
events.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
