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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Repository `owner/name`, as next.config.mjs derives it. */
export function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? '');
  if (!match) throw new Error('docs: cannot derive the repository from package.json');
  return match[1];
}

/**
 * Rewrites one Markdown link target found in `fromFile` (a repository path).
 * Site pages become `/docs/<slug>/`, other repository files GitHub URLs,
 * external links and pure anchors stay as they are.
 */
export function rewriteHref(href, fromFile, repo) {
  if (/^([a-z]+:|#|\/\/)/i.test(href)) return href;
  const [target, anchor] = href.split('#');
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));
  const hash = anchor ? `#${anchor}` : '';
  const imported = IMPORTS.find((i) => i.from === repoPath);
  if (imported) return `/docs/${imported.slug}/${hash}`;
  if (SITE_PATHS[repoPath]) return `/docs/${SITE_PATHS[repoPath]}/${hash}`;
  // GitHub resolves ../../x from a file at the root to the repository page x
  // (for example ../../security/advisories/new).
  if (repoPath.startsWith('../../') && !repoPath.slice(6).startsWith('..')) {
    return `https://github.com/${repo}/${repoPath.slice(6)}${hash}`;
  }
  if (repoPath.startsWith('..')) return href;
  const isDir = repoPath.endsWith('/') || !path.posix.extname(repoPath);
  const kind = isDir && existsSync(path.join(ROOT, repoPath)) ? 'tree' : 'blob';
  return `https://github.com/${repo}/${kind}/main/${repoPath.replace(/\/$/, '')}${hash}`;
}

/** Rewrites inline links and images outside fenced code blocks. */
export function rewriteLinks(markdown, fromFile, repo) {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(/(!?\[[^\]]*\])\(([^)\s]+)(\s+"[^"]*")?\)/g, (_m, text, href, title = '') => {
        return `${text}(${rewriteHref(href, fromFile, repo)}${title})`;
      });
    })
    .join('\n');
}

const yaml = (s) => JSON.stringify(s);

/** Builds the page text: frontmatter, the source without its first heading, a source note. */
export function toPage(source, entry, repo) {
  let body = source.replace(/\r\n/g, '\n');
  body = body.replace(/^\s*# [^\n]*\n+/, '');
  body = rewriteLinks(body, entry.from, repo);
  const note = `\n\n---\n\nThis page is generated from [\`${entry.from}\`](https://github.com/${repo}/blob/main/${entry.from}) in the repository; edit it there.\n`;
  return `---\ntitle: ${yaml(entry.title)}\ndescription: ${yaml(entry.description)}\n---\n\n<!-- Generated by docs/scripts/prepare.mjs from ${entry.from}. Do not edit. -->\n\n${body.trimEnd()}${note}`;
}

function changelogPage(repo) {
  const file = path.join(ROOT, 'CHANGELOG.md');
  const front = `---\ntitle: "Release notes"\ndescription: "Every release, generated by release-please from the commit history."\n---\n\n`;
  if (!existsSync(file)) {
    return `${front}No release has been published yet. The changelog is written by release-please when the first release PR is merged; until then, follow the [commit history](https://github.com/${repo}/commits/main) and the [releases page](https://github.com/${repo}/releases).\n`;
  }
  const entry = { from: 'CHANGELOG.md', title: 'Changelog' };
  let body = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^\s*# [^\n]*\n+/, '');
  body = rewriteLinks(body, entry.from, repo);
  return `${front}Release notes: [GitHub releases](https://github.com/${repo}/releases).\n\n${body.trimEnd()}\n`;
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

  for (const name of ['icon.svg', 'logo-on-dark.svg', 'logo-on-light.svg']) {
    copy(path.join(ROOT, 'public', 'brand', name), path.join(DOCS, 'public', 'brand', name));
  }
  copy(path.join(ROOT, 'public', 'brand', 'icon.svg'), path.join(DOCS, 'app', 'icon.svg'));
  for (const name of ['poppins-black-900.woff2', 'poppins-black-900-italic.woff2']) {
    copy(path.join(ROOT, 'public', 'fonts', name), path.join(DOCS, 'assets', 'fonts', name));
  }
  console.log(`docs: imported ${IMPORTS.length + 1} pages and the brand files (${repo})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
