#!/usr/bin/env node
/**
 * Indonesian leftover check (Story 3.1).
 *
 * Fails when a word from scripts/indonesian-leftovers.json appears in
 *   - any messages/*.json value (walked from the parsed tree), or
 *   - the user-visible text of a checked source file: string literals,
 *     template literal text and JSX text. Comments and identifiers are
 *     ignored (the TypeScript scanner tells them apart).
 *
 * GraphQL documents (gql`...` / graphql`...`) are skipped. The short words
 * in AMBIGUOUS match only as lowercase whole words ("Dan" the name passes).
 * A source line with an `i18n-ignore` comment is a deliberate exception.
 * Technical text that is never shown to users (GraphQL SDL comments, GLSL
 * shader source) is listed in scripts/i18n-scope.json `exceptions`: each
 * entry skips the literals of one file whose text matches its pattern. An
 * entry that no longer matches anything is an error, so the list only
 * holds live exceptions.
 *
 * Usage:
 *   node scripts/i18n-check.mjs              the whole scope (scripts/i18n-scope.json: all of src) + messages
 *   node scripts/i18n-check.mjs --files a b  exactly these files (repo-relative, cwd-relative or absolute)
 *
 * Findings print `file:line  word`. Exit codes: 0 clean, 1 findings, 2 usage error.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Short words that are also names or abbreviations elsewhere. */
const AMBIGUOUS = new Set(['dan', 'ke', 'di']);

const GRAPHQL_TAGS = new Set(['gql', 'graphql']);

export function loadLeftovers(file = path.join(ROOT, 'scripts', 'indonesian-leftovers.json')) {
  return new Set(JSON.parse(readFileSync(file, 'utf8')).words.map((w) => w.toLowerCase()));
}

/** Leftover words found in a piece of text, in order (lowercased). */
export function leftoverWords(text, words) {
  return String(text)
    .normalize('NFKC')
    .split(/[^\p{L}\p{M}]+/u)
    .filter((raw) => {
      if (!raw) return false;
      const w = raw.toLowerCase();
      if (!words.has(w)) return false;
      return AMBIGUOUS.has(w) ? raw === w : true;
    })
    .map((raw) => raw.toLowerCase());
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Findings in a TS/TSX source: [{ line, word }]. `skip` holds RegExps for
 * technical literals of this file (scope exceptions); `used` receives the
 * index of every pattern that skipped something.
 */
export function checkSource(text, words, fileName = 'file.tsx', skip = [], used = new Set()) {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const lines = text.split(/\r?\n/);
  const findings = [];
  const visit = (node) => {
    // GraphQL documents are queries, not copy.
    if (ts.isTaggedTemplateExpression(node) && GRAPHQL_TAGS.has(node.tag.getText(sf))) return;
    let value = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      // Module specifiers ('./x', '@/lib/y') are paths, not copy.
      if (!(node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)))) {
        value = node.text;
      }
    } else if (ts.isJsxText(node)) {
      value = node.getText(sf);
    }
    if (value !== null) {
      let skipped = false;
      skip.forEach((re, i) => {
        if (re.test(value)) {
          used.add(i);
          skipped = true;
        }
      });
      if (skipped) value = null;
    }
    if (value !== null) {
      const line = lineOf(text, node.getStart(sf));
      if (!/i18n-ignore/.test(lines[line - 1] ?? '')) {
        for (const word of leftoverWords(value, words)) findings.push({ line, word });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

/**
 * Findings in a locale JSON file: every string value walked from the parsed
 * tree (layout does not matter), keys ignored. The line is where the value's
 * JSON text first appears, else 1.
 */
export function checkMessages(text, words) {
  const findings = [];
  const walk = (node) => {
    if (typeof node === 'string') {
      const found = leftoverWords(node, words);
      if (!found.length) return;
      const at = text.indexOf(JSON.stringify(node));
      const line = at >= 0 ? lineOf(text, at) : 1;
      for (const word of found) findings.push({ line, word });
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(JSON.parse(text));
  return findings;
}

function walkDir(rel) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) return e.name === 'generated' ? [] : walkDir(child);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [child] : [];
  });
}

/** Expands scope entries: "dir/**" = every TS file below dir, else an exact path. */
export function expandScope(entries) {
  const out = new Set();
  for (const entry of entries) {
    if (entry.endsWith('/**')) walkDir(entry.slice(0, -3)).forEach((f) => out.add(f));
    else if (existsSync(path.join(ROOT, entry))) out.add(entry);
    else throw new Error(`i18n-scope.json lists a missing file: ${entry}`);
  }
  return [...out].sort();
}

/**
 * Validates and groups scope exceptions: [{ file, pattern, reason }] ->
 * Map(file -> [{ re, entry }]). Throws on a missing file, an empty reason or
 * a pattern that does not compile.
 */
export function normalizeRel(file) {
  return path.posix.normalize(String(file).replace(/\\/g, '/')).replace(/^\.\//, '');
}

export function loadExceptions(entries = []) {
  const byFile = new Map();
  if (!Array.isArray(entries)) throw new Error('i18n-scope.json `exceptions` must be a list');
  for (const entry of entries) {
    const file = entry && typeof entry.file === 'string' ? normalizeRel(entry.file) : null;
    if (!file || !existsSync(path.join(ROOT, file))) {
      throw new Error(`i18n-scope.json exception names a missing file: ${entry?.file}`);
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`i18n-scope.json exception for ${file} needs a reason`);
    }
    if (typeof entry.pattern !== 'string' || !entry.pattern) {
      throw new Error(`i18n-scope.json exception for ${file} needs a string pattern`);
    }
    const re = new RegExp(entry.pattern);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ re, entry });
  }
  return byFile;
}

function messageFiles() {
  const dir = path.join(ROOT, 'messages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `messages/${f}`).sort();
}

/** Resolves --files arguments to repo-relative paths; null + message when one is missing. */
export function resolveFileArgs(args, cwd = process.cwd()) {
  const out = [];
  for (const f of args) {
    const abs = [path.resolve(ROOT, f), path.resolve(cwd, f)].find((p) => existsSync(p));
    if (!abs) return { error: `i18n:check: no such file: ${f}` };
    out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
  }
  return { files: out };
}

/** Runs the check; `scopeJson` defaults to scripts/i18n-scope.json. Returns the exit code. */
export function main(argv, scopeJson = null) {
  let files;
  scopeJson ??= JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'i18n-scope.json'), 'utf8'));
  let exceptions;
  try {
    exceptions = loadExceptions(scopeJson.exceptions);
  } catch (e) {
    console.error(`i18n:check: ${e.message}`);
    return 2;
  }
  if (argv.includes('--files')) {
    const args = argv.slice(argv.indexOf('--files') + 1);
    if (!args.length) {
      console.error('i18n:check: --files needs at least one path');
      return 2;
    }
    const r = resolveFileArgs(args);
    if (r.error) {
      console.error(r.error);
      return 2;
    }
    files = r.files;
  } else {
    files = [...expandScope(scopeJson.files), ...messageFiles()];
  }

  const words = loadLeftovers();
  let count = 0;
  let stale = 0;
  for (const rel of files) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    let findings;
    try {
      const skips = exceptions.get(rel) ?? [];
      const used = new Set();
      findings = rel.endsWith('.json')
        ? checkMessages(text, words)
        : checkSource(text, words, rel, skips.map((s) => s.re), used);
      skips.forEach((s, i) => {
        if (used.has(i)) return;
        console.error(`i18n:check: exception for ${rel} (${s.entry.pattern}) matches nothing; remove it`);
        stale++;
      });
    } catch (e) {
      console.error(`i18n:check: cannot read ${rel}: ${e.message}`);
      return 2;
    }
    for (const f of findings) {
      console.log(`${rel}:${f.line}  ${f.word}`);
      count++;
    }
  }
  if (count || stale) {
    if (count) console.error(`i18n:check: ${count} Indonesian leftover(s) in ${files.length} file(s).`);
    return 1;
  }
  console.log(`i18n:check: ${files.length} file(s) clean.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
