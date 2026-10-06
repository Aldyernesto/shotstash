#!/usr/bin/env node
/**
 * Docs prebuild (Story 7.1). Brings committed repository files into the docs
 * app so every topic keeps one source:
 *
 *   - the Markdown guides (docs/*.md, CONTRIBUTING.md, SECURITY.md, CHANGELOG.md)
 *     become pages under content/docs, with frontmatter and links rewritten to
 *     site paths (other repository files link to GitHub);
 *   - the brand files (logo, icon, Poppins Black) are copied from public/.
 *
 * Everything written here is ignored by git (docs/.gitignore). Reads only
 * committed files; never imports app code, Prisma or the app's environment.
 *
 *   node scripts/prepare.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository } from '../lib/repository.mjs';

export { repository };

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DOCS, '..');
const CONTENT = path.join(DOCS, 'content', 'docs');

/**
 * Imported guides: repository path -> page. `slug` is the page path under
 * /docs; `title` replaces the first heading of the source.
 */
export const IMPORTS = [
  {
    from: 'docs/configuration.md',
    slug: 'configuration',
    title: 'Environment variables',
    description: 'Every environment variable, its default and what it does. Generated from src/lib/config.ts.',
  },
  {
    from: 'docs/storage.md',
    slug: 'storage',
    title: 'Storage backends',
    description: 'Local disk, NAS mounts and S3-compatible buckets: choosing and switching a storage backend.',
  },
  {
    from: 'docs/byo-ai.md',
    slug: 'byo-ai',
    title: 'The worker contract',
    description: 'The worker contract: plug any model or tool into the job pipeline over HTTP.',
  },
  {
    from: 'CONTRIBUTING.md',
    slug: 'contributing',
    title: 'Contributing',
    description: 'How to set up a development checkout, the checks CI runs and the commit style.',
  },
  {
    from: 'docs/releasing.md',
    slug: 'contributing/releasing',
    title: 'Releasing',
    description: 'Conventional commits, the release PR, published images and rollback by tag.',
  },
  {
    from: 'docs/i18n.md',
    slug: 'contributing/i18n',
    title: 'Translations',
    description: 'How text is stored, how the locale is chosen and how to add a language.',
  },
  {
    from: 'SECURITY.md',
    slug: 'contributing/security',
    title: 'Security policy',
    description: 'Supported versions and how to report a vulnerability privately.',
  },
];

/** Repository paths that are pages of the site (besides IMPORTS). */
const SITE_PATHS = {
  'CHANGELOG.md': 'changelog',
  'docs/content/docs/architecture.mdx': 'architecture',
};

/** Where an imported page lives on disk (index pages for folders). */
export function pageFile(slug) {
  const folders = new Set(IMPORTS.map((i) => i.slug.split('/').slice(0, -1).join('/')).filter(Boolean));
  return folders.has(slug) ? path.join(CONTENT, slug, 'index.md') : path.join(CONTENT, `${slug}.md`);
}

/**
 * Rewrites one Markdown link target found in `fromFile` (a repository path).
 * Site pages become `/docs/<slug>/`; other repository files become GitHub
 * URLs (folders `tree`, files `blob`, images raw.githubusercontent.com);
 * external links and pure anchors stay as they are. A target that does not
 * exist, or a path that leaves the repository, throws (the build fails).
 */
export function rewriteHref(href, fromFile, repo, { image = false, root = ROOT } = {}) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href;
  const at = href.indexOf('#');
  const target = at >= 0 ? href.slice(0, at) : href;
  const hash = at >= 0 ? href.slice(at) : '';
  // GitHub resolves a leading / from the repository root.
  const base = target.startsWith('/') ? '.' : path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(base, target.replace(/^\/+/, '')));
  const imported = IMPORTS.find((i) => i.from === joined);
  if (imported) return `/docs/${imported.slug}/${hash}`;
  if (SITE_PATHS[joined]) return `/docs/${SITE_PATHS[joined]}/${hash}`;
  // GitHub resolves ../../x past the root to the repository page x
  // (for example ../../security/advisories/new).
  if (joined.startsWith('../../') && !joined.slice(6).startsWith('..')) {
    return `https://github.com/${repo}/${joined.slice(6)}${hash}`;
  }
  if (joined === '..' || joined.startsWith('../')) throw new Error(`docs: ${fromFile}: link "${href}" leaves the repository`);
  const clean = joined.replace(/\/$/, '');
  if (clean === '.' || clean === '') return `https://github.com/${repo}${hash}`;
  const onDisk = path.join(root, decodeURIComponent(clean));
  if (!existsSync(onDisk)) throw new Error(`docs: ${fromFile}: link "${href}" points at ${clean}, which does not exist`);
  const url = encodeURI(decodeURIComponent(clean));
  if (statSync(onDisk).isDirectory()) return `https://github.com/${repo}/tree/main/${url}${hash}`;
  if (image) return `https://raw.githubusercontent.com/${repo}/main/${url}`;
  return `https://github.com/${repo}/blob/main/${url}${hash}`;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Calls `fn(line)` for every line outside fenced code blocks (a fence closes
 * only with the same character, at least as long, and nothing after it);
 * `fn` returns the new line, or null to drop it.
 */
export function mapOutsideFences(markdown, fn) {
  let fence = null;
  const out = [];
  for (const line of markdown.split('\n')) {
    if (fence) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === '`' && line.slice(line.indexOf(open[1]) + open[1].length).includes('`'))) {
      fence = open[1];
      out.push(line);
      continue;
    }
    const next = fn(line);
    if (next !== null) out.push(next);
  }
  return out.join('\n');
}

const INLINE = /(!?)(\[[^\]]*\])\((<[^>]*>|[^)\s]+)(\s+"[^"]*")?\)/g;
const DEFINITION = /^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>]*>|\S+)(.*)$/;

/** Rewrites inline links, images, `<angle>` targets and reference definitions outside fences. */
export function rewriteLinks(markdown, fromFile, repo, opts = {}) {
  const one = (raw, image) => {
    const angle = raw.startsWith('<') && raw.endsWith('>');
    const href = angle ? raw.slice(1, -1) : raw;
    const next = rewriteHref(href, fromFile, repo, { ...opts, image });
    return angle ? `<${next}>` : next;
  };
  return mapOutsideFences(markdown, (line) => {
    const def = DEFINITION.exec(line);
    if (def) return `${def[1]}${one(def[2], false)}${def[3]}`;
    return line.replace(INLINE, (_m, bang, text, raw, title = '') => `${bang}${text}(${one(raw, bang === '!')}${title})`);
  });
}

/** Drops the first level-1 heading outside fences (and the blank lines after it). */
export function stripFirstH1(markdown) {
  let done = false;
  let skipBlank = false;
  return mapOutsideFences(markdown, (line) => {
    if (skipBlank) {
      if (line.trim() === '') return null;
      skipBlank = false;
    }
    if (!done && /^ {0,3}# /.test(line)) {
      done = true;
      skipBlank = true;
      return null;
    }
    return line;
  }).replace(/^\n+/, '');
}

const yaml = (s) => JSON.stringify(s);
const note = (from, repo) =>
  `\n\n---\n\nThis page is generated from [\`${from}\`](https://github.com/${repo}/blob/main/${from}) in the repository; edit it there.\n`;

/** Builds the page text: frontmatter, the source without its first heading, a source note. */
export function toPage(source, entry, repo, opts = {}) {
  let body = stripFirstH1(source.replace(/\r\n/g, '\n'));
  body = rewriteLinks(body, entry.from, repo, opts);
  return `---\ntitle: ${yaml(entry.title)}\ndescription: ${yaml(entry.description)}\n---\n\n<!-- Generated by docs/scripts/prepare.mjs from ${entry.from}. Do not edit. -->\n\n${body.trimEnd()}${note(entry.from, repo)}`;
}

export function changelogPage(repo, root = ROOT) {
  const file = path.join(root, 'CHANGELOG.md');
  const front = `---\ntitle: "Release notes"\ndescription: "Every release, generated by release-please from the commit history."\n---\n\n`;
  if (!existsSync(file)) {
    return `${front}No release has been published yet. The changelog is written by release-please when the first release PR is merged; until then, follow the [commit history](https://github.com/${repo}/commits/main) and the [releases page](https://github.com/${repo}/releases).\n`;
  }
  let body = stripFirstH1(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  body = rewriteLinks(body, 'CHANGELOG.md', repo, { root });
  return `${front}Release notes: [GitHub releases](https://github.com/${repo}/releases).\n\n${body.trimEnd()}${note('CHANGELOG.md', repo)}`;
}

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const old = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (old !== text) writeFileSync(file, text);
}

function copy(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function main() {
  const repo = repository();
  for (const entry of IMPORTS) {
    const src = path.join(ROOT, entry.from);
    if (!existsSync(src)) throw new Error(`docs: ${entry.from} is missing`);
    write(pageFile(entry.slug), toPage(readFileSync(src, 'utf8'), entry, repo));
  }
  write(path.join(CONTENT, 'changelog.md'), changelogPage(repo));

  for (const name of ['icon.svg', 'logo-on-dark.svg', 'logo-on-light.svg', 'og.png']) {
    copy(path.join(ROOT, 'public', 'brand', name), path.join(DOCS, 'public', 'brand', name));
  }
  copy(path.join(ROOT, 'public', 'brand', 'icon.svg'), path.join(DOCS, 'app', 'icon.svg'));
  for (const name of ['poppins-black-900.woff2', 'poppins-black-900-italic.woff2']) {
    copy(path.join(ROOT, 'public', 'fonts', name), path.join(DOCS, 'assets', 'fonts', name));
  }
  console.log(`docs: imported ${IMPORTS.length + 1} pages and the brand files (${repo})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
