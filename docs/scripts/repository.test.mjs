import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normaliseBasePath, normaliseDomain, parseRepository, repository, site } from '../lib/repository.mjs';

test('repository strings in every package.json shape', () => {
  assert.equal(parseRepository('git+https://github.com/someone/shotstash.git'), 'someone/shotstash');
  assert.equal(parseRepository({ type: 'git', url: 'https://github.com/someone/shot.stash' }), 'someone/shot.stash');
  assert.equal(parseRepository('git@github.com:someone/my.docs.git'), 'someone/my.docs');
  assert.equal(parseRepository('github:someone/shotstash'), 'someone/shotstash');
  assert.equal(parseRepository('someone/some.name'), 'someone/some.name');
  assert.equal(parseRepository('https://gitlab.com/a/b'), null);
});

test('GITHUB_REPOSITORY wins, else the root package.json', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'docs-repo-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ repository: 'github:pkg/site' }));
  assert.equal(repository({}, root), 'pkg/site');
  assert.equal(repository({ GITHUB_REPOSITORY: 'Org/Shot.Stash' }, root), 'Org/Shot.Stash');
  writeFileSync(path.join(root, 'package.json'), '{}');
  assert.throws(() => repository({}, root), /cannot derive/);
});

test('domains and base paths are normalised', () => {
  assert.equal(normaliseDomain(' https://Docs.Example.com/x/ '), 'docs.example.com');
  assert.equal(normaliseDomain('docs.example.com/'), 'docs.example.com');
  assert.equal(normaliseDomain(''), '');
  assert.equal(normaliseBasePath('shotstash/'), '/shotstash');
  assert.equal(normaliseBasePath('/'), '');
});

test('project site, user site and custom domain addresses', () => {
  const project = site({ GITHUB_REPOSITORY: 'Someone/shotstash' });
  assert.equal(project.pagesBasePath, '/shotstash');
  assert.equal(project.url, 'https://someone.github.io/shotstash/');
  assert.equal(project.basePath, '');

  const user = site({ GITHUB_REPOSITORY: 'Someone/someone.github.io' });
  assert.equal(user.userSite, true);
  assert.equal(user.pagesBasePath, '');
  assert.equal(user.url, 'https://someone.github.io/');

  const domain = site({ GITHUB_REPOSITORY: 'Someone/shotstash', DOCS_DOMAIN: 'https://Docs.Example.com/' });
  assert.equal(domain.pagesBasePath, '');
  assert.equal(domain.url, 'https://docs.example.com/');

  assert.equal(site({ GITHUB_REPOSITORY: 'a/b', DOCS_BASE_PATH: '/b' }).basePath, '/b');
});
