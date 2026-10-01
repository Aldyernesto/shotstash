#!/usr/bin/env node
/**
 * Story 7.2: writes `schema.graphql` at the repo root from the type
 * definitions in `src/graphql/schema.ts`. Every type, field, argument, input
 * field and enum value must carry a description.
 *
 *   npm run sdl         write schema.graphql (refuses when a description is missing)
 *   npm run sdl:check   exit 1 on a missing description or a stale schema.graphql
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildSchema,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isSpecifiedScalarType,
  isIntrospectionType,
  isSpecifiedDirective,
  printSchema,
} from 'graphql';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SDL_PATH = resolve(ROOT, 'schema.graphql');

const HEADER = [
  '# Shotstash GraphQL schema.',
  '# Generated from src/graphql/schema.ts by `npm run sdl`. Do not edit by hand;',
  '# CI runs `npm run sdl:check`.',
  '',
].join('\n');

const has = (d) => typeof d === 'string' && d.trim().length > 0;

/** Every undescribed member: `Type`, `Type.field`, `Type.field(arg)`, `Input.field`, `Enum.VALUE`, `@directive` or `@directive(arg)`. */
export function missingDescriptions(schema) {
  const out = [];
  const types = Object.values(schema.getTypeMap())
    .filter((t) => !isIntrospectionType(t) && !isSpecifiedScalarType(t))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const type of types) {
    if (!has(type.description)) out.push(type.name);
    if (isObjectType(type) || isInterfaceType(type)) {
      for (const field of Object.values(type.getFields())) {
        if (!has(field.description)) out.push(`${type.name}.${field.name}`);
        for (const arg of field.args) if (!has(arg.description)) out.push(`${type.name}.${field.name}(${arg.name})`);
      }
    } else if (isInputObjectType(type)) {
      for (const field of Object.values(type.getFields())) if (!has(field.description)) out.push(`${type.name}.${field.name}`);
    } else if (isEnumType(type)) {
      for (const value of type.getValues()) if (!has(value.description)) out.push(`${type.name}.${value.name}`);
    }
  }
  // Custom directives and their arguments (the specified ones, such as
  // @deprecated, come described from graphql-js).
  const directives = schema
    .getDirectives()
    .filter((d) => !isSpecifiedDirective(d))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const d of directives) {
    if (!has(d.description)) out.push(`@${d.name}`);
    for (const arg of d.args) if (!has(arg.description)) out.push(`@${d.name}(${arg.name})`);
  }
  return out;
}

/** Builds the schema from SDL text (the `#graphql` editor marker is dropped). */
export function schemaFromTypeDefs(typeDefs) {
  return buildSchema(typeDefs.replace(/^\s*#graphql\s*/, ''));
}

export async function loadSchema() {
  const { typeDefs } = await import(pathToFileURL(resolve(ROOT, 'src/graphql/schema.ts')).href);
  return schemaFromTypeDefs(typeDefs);
}

/** The exact text of schema.graphql (LF line endings, trailing newline). */
export function renderSdl(schema) {
  return `${HEADER}\n${printSchema(schema).replace(/\r\n/g, '\n').trimEnd()}\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const schema = await loadSchema();
  const missing = missingDescriptions(schema);
  if (missing.length) {
    console.error(`GraphQL members without a description (${missing.length}); describe them in src/graphql/schema.ts:`);
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }
  const sdl = renderSdl(schema);
  if (check) {
    const current = existsSync(SDL_PATH) ? readFileSync(SDL_PATH, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current !== sdl) {
      console.error('schema.graphql is out of date with src/graphql/schema.ts. Run `npm run sdl` and commit the result.');
      process.exit(1);
    }
    console.log('schema.graphql is up to date and every member is described.');
    return;
  }
  writeFileSync(SDL_PATH, sdl);
  console.log(`Wrote ${SDL_PATH}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
