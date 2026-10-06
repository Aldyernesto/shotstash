import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { site } from './lib/repository.mjs';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
});

const s = site();
/** Placeholders in pages, so no page hard-codes the owner or the site address. */
const placeholders: [string, string][] = [
  ['%REPO%', s.repo],
  ['%OWNER_LC%', s.ownerLc],
  ['%PAGES_URL%', s.url],
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
