// Where the docs site lives, derived from the repository (one helper for
// next.config.mjs, scripts/prepare.mjs, source.config.ts and the workflows).
// Nothing here names the owner: it comes from GITHUB_REPOSITORY in Actions,
// else from the root package.json.
//
//   node lib/repository.mjs     prints DOCS_BASE_PATH, DOCS_SITE_URL and DOCS_DOMAIN
//                               for a GitHub Pages build (append to $GITHUB_ENV)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `owner/name` from a package.json `repository` value: a string (`owner/name`,
 * `github:owner/name`, a GitHub URL, `git@github.com:owner/name.git`) or an
 * object with `url`. Names may contain dots; only a `.git` suffix is dropped.
 */
export function parseRepository(value) {
  const raw = String((value && typeof value === 'object' ? value.url : value) ?? '').trim();
  const patterns = [
    /^(?:github:)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/,
    /github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
  ];
  for (const re of patterns) {
    const m = re.exec(raw);
    if (m) return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
  }
  return null;
}

/** Repository `owner/name`: GITHUB_REPOSITORY, else the root package.json. */
export function repository(env = process.env, root = ROOT) {
  if (env.GITHUB_REPOSITORY) {
    const fromEnv = parseRepository(env.GITHUB_REPOSITORY);
    if (fromEnv) return fromEnv;
  }
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const repo = parseRepository(pkg.repository);
  if (!repo) throw new Error('docs: cannot derive the repository from GITHUB_REPOSITORY or package.json "repository"');
  return repo;
}

/** `docs.example.com` from `https://Docs.Example.com/x/`; empty when unset. */
export function normaliseDomain(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

/**
 * The public demo's origin for the try-it console (`https://demo.example.com`),
 * from DEMO_ORIGIN; empty when unset. Throws on anything but an exact
 * http(s) origin (no path, no wildcard), so a typo never ships a console
 * pointed somewhere unexpected.
 */
export function normaliseDemoOrigin(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`docs: DEMO_ORIGIN is not a URL: ${value}`);
  }
  // No path, query or fragment; an explicit default port normalises away.
  const exact = url.pathname === '/' && !/[?#]/.test(value);
  if (!['https:', 'http:'].includes(url.protocol) || !exact || value.includes('*') || url.username) {
    throw new Error(`docs: DEMO_ORIGIN must be an origin such as https://demo.example.com (no path): ${value}`);
  }
  return url.origin;
}

/** `/repo` or `''`, without a trailing slash. */
export function normaliseBasePath(raw) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

/**
 * Facts of the site. `pagesBasePath` and `url` describe the GitHub Pages
 * address: a domain root when DOCS_DOMAIN is set, the root of a user site
 * (repository `<owner>.github.io`), else `/<repo>`. `basePath` is what this
 * build uses: DOCS_BASE_PATH when set (the workflows set it), else none.
 */
export function site(env = process.env, root = ROOT) {
  const repo = repository(env, root);
  const [owner, name] = repo.split('/');
  const ownerLc = owner.toLowerCase();
  const domain = normaliseDomain(env.DOCS_DOMAIN);
  const userSite = name.toLowerCase() === `${ownerLc}.github.io`;
  const pagesBasePath = domain || userSite ? '' : `/${name}`;
  const host = domain || `${ownerLc}.github.io`;
  const url = `https://${host}${pagesBasePath}/`;
  const basePath = env.DOCS_BASE_PATH === undefined ? '' : normaliseBasePath(env.DOCS_BASE_PATH);
  const demoOrigin = normaliseDemoOrigin(env.DEMO_ORIGIN);
  return { repo, owner, name, ownerLc, domain, userSite, pagesBasePath, basePath, url, demoOrigin };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = site({ ...process.env, DOCS_BASE_PATH: undefined });
  console.log(`DOCS_BASE_PATH=${s.pagesBasePath}`);
  console.log(`DOCS_SITE_URL=${s.url}`);
  console.log(`DOCS_DOMAIN=${s.domain}`);
}
