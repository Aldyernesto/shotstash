import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import type { MDXComponents } from 'mdx/types';
import { Mermaid } from './mermaid';
import { CommunityWorkers } from './community-workers';
import { Screenshot } from './screenshot';
import { DemoToken } from './demo-token';
import { Trailer, TrailerLive } from './trailer';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Mermaid,
    Step,
    Steps,
    Tab,
    Tabs,
    CommunityWorkers,
    Screenshot,
    DemoToken,
    Trailer,
    TrailerLive,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
