#!/usr/bin/env node
/**
 * Story 6.2: writes `.env.example` and `docs/configuration.md` from the
 * variable table in `src/lib/config.ts`, the single source of configuration.
 * `--check` exits 1 when either committed file differs from the output.
 *
 *   npm run env:example
 *   npm run env:example:check
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { GROUPS, SECRET_HINT, VARIABLES } = await import('../src/lib/config.ts');

export const ENV_EXAMPLE = resolve(ROOT, '.env.example');
export const CONFIG_DOC = resolve(ROOT, 'docs/configuration.md');

function wrap(text, width = 76) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function entries() {
  return Object.entries(VARIABLES).map(([name, def]) => ({ name, ...def }));
}

function defaultText(v) {
  if (v.default === undefined) return '';
  return String(v.default);
}

export function renderEnvExample() {
  const out = [
    '# Shotstash configuration.',
    '# Generated from src/lib/config.ts by `npm run env:example`. Do not edit by hand.',
    '#',
    '# Copy this file to .env and fill in the secrets. Every value here is a',
    '# placeholder; nothing in this file is a real secret. Empty means "not set".',
    '# Full reference: docs/configuration.md',
    '#',
    '# docker compose: set SESSION_SECRET, POSTGRES_PASSWORD and',
    '# WORKER_BOOTSTRAP_TOKEN, then run `docker compose up -d`. The compose file',
    '# sets DATABASE_URL, DRAGONFLY_HOST, STORAGE_LOCAL_ROOT and PORT for the app',
    '# container itself.',
  ];
  for (const group of GROUPS) {
    const vars = entries().filter((v) => v.group === group);
    if (!vars.length) continue;
    out.push('', `# ${'-'.repeat(70)}`, `# ${group}`, `# ${'-'.repeat(70)}`);
    for (const v of vars) {
      out.push('');
      for (const l of wrap(v.description)) out.push(`# ${l}`);
      const notes = [];
      if (v.required) notes.push('Required.');
      if (v.secret) notes.push(v.generate === false ? 'Secret.' : `Secret: generate with \`${SECRET_HINT}\`.`);
      if (v.default !== undefined) notes.push(`Default: ${defaultText(v)}.`);
      if (notes.length) out.push(`# ${notes.join(' ')}`);
      const line = `${v.name}=${v.secret ? '' : (v.example ?? '')}`;
      out.push(v.managed ? `# ${line}` : line);
    }
  }
  return `${out.join('\n')}\n`;
}

function cell(text) {
  return String(text).replace(/\|/g, '\\|');
}

export function renderConfigDoc() {
  const out = [
    '# Configuration',
    '',
    '<!-- Generated from src/lib/config.ts by `npm run env:example`. Do not edit by hand. -->',
    '',
    'Shotstash reads its whole configuration from environment variables when the',
    'server starts. There are no build-time settings: change a value in `.env`',
    'and restart (`docker compose up -d`); nothing needs a rebuild.',
    '',
    'At startup the server checks every variable and refuses to start when one',
    'is wrong, listing each bad variable by name. Values are checked for shape',
    'only (a number, a URL, a long enough secret); whether the database, cache',
    'and storage are reachable is reported by `/api/health` and the setup page.',
    '',
    'Naming: product settings start with `SHOTSTASH_`; infrastructure and',
    'secrets keep their usual names (`DATABASE_URL`, `SESSION_SECRET`).',
    '',
    `Secrets: generate each with \`${SECRET_HINT}\`.`,
    '',
    'The browser reads the public part of this configuration (app URL, Google',
    'client id, enabled features, version, default language) from',
    '`GET /api/v1/config`.',
  ];
  for (const group of GROUPS) {
    const vars = entries().filter((v) => v.group === group);
    if (!vars.length) continue;
    out.push('', `## ${group}`, '', '| Variable | Default | Required | Description |', '| --- | --- | --- | --- |');
    for (const v of vars) {
      const def = v.default !== undefined ? `\`${defaultText(v)}\`` : '';
      const required = v.required ? 'yes' : '';
      const secret = v.secret ? ' Secret.' : '';
      out.push(`| \`${v.name}\` | ${cell(def)} | ${required} | ${cell(v.description)}${secret} |`);
    }
  }
  return `${out.join('\n')}\n`;
}

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';
}

function main() {
  const check = process.argv.includes('--check');
  const files = [
    [ENV_EXAMPLE, renderEnvExample()],
    [CONFIG_DOC, renderConfigDoc()],
  ];
  if (check) {
    const stale = files.filter(([path, next]) => read(path) !== next).map(([path]) => path.slice(ROOT.length + 1));
    if (stale.length) {
      console.error(`env:example: ${stale.join(' and ')} out of date. Run \`npm run env:example\`.`);
      process.exit(1);
    }
    console.log('env:example: up to date');
    return;
  }
  for (const [path, next] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    console.log(`env:example: wrote ${path.slice(ROOT.length + 1)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
