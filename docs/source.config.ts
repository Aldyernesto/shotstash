import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
});

/** Repository `owner/name`, as next.config.mjs derives it (this file is compiled into .source, so paths are relative to the docs folder). */
function repository(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), '..', 'package.json'), 'utf8'));
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? '');
  if (!match) throw new Error('docs: cannot derive the repository from package.json');
  return match[1];
}

const repo = repository();
const owner = repo.split('/')[0];
/** Placeholders in pages, so no page hard-codes the owner. */
const placeholders: [string, string][] = [
  ['%REPO%', repo],
  ['%OWNER_LC%', owner.toLowerCase()],
  ['%PAGES_URL%', `https://${owner.toLowerCase()}.github.io/${repo.split('/')[1]}/`],
];

function fill(value: string): string {
  let out = value;
  for (const [key, val] of placeholders) out = out.replaceAll(key, val);
  return out;
}

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

/** Replaces the placeholders in text, inline code, code blocks and link targets. */
function remarkRepository() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (typeof node.value === 'string') node.value = fill(node.value);
      if (typeof node.url === 'string') node.url = fill(node.url);
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (v) => [remarkRepository, ...v, remarkMdxMermaid],
  },
});
