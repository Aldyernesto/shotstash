// Story 7.2: every public GraphQL member is described, and schema.graphql
// matches the generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SDL_PATH, loadSchema, missingDescriptions, renderSdl, schemaFromTypeDefs } from './export-sdl.mjs';

test('the walker names an undescribed type, field, argument, input field and enum value', () => {
  const schema = schemaFromTypeDefs(`#graphql
    "Root."
    type Query {
      "Described."
      ok: Boolean!
      bare(id: ID!): String
    }
    input Filter { "Described." a: String b: String }
    "Colors."
    enum Color { "Red." RED BLUE }
  `);
  assert.deepEqual(missingDescriptions(schema), ['Color.BLUE', 'Filter', 'Filter.b', 'Query.bare', 'Query.bare(id)']);
});

test('a fully described schema passes', () => {
  const schema = schemaFromTypeDefs(`
    "Root."
    type Query {
      "One item."
      item(
        "Item id."
        id: ID!
      ): String
    }
  `);
  assert.deepEqual(missingDescriptions(schema), []);
});

test('the real schema describes every member', async () => {
  assert.deepEqual(missingDescriptions(await loadSchema()), []);
});

test('the committed schema.graphql matches the generator (npm run sdl)', async () => {
  const committed = readFileSync(SDL_PATH, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(committed, renderSdl(await loadSchema()));
});

test('custom directives and their arguments need a description; specified ones do not', () => {
  const bare = schemaFromTypeDefs(`
    directive @auth(role: String) on FIELD_DEFINITION
    "Root."
    type Query {
      "Described."
      ok: Boolean! @deprecated
    }
  `);
  assert.deepEqual(missingDescriptions(bare), ['@auth', '@auth(role)']);
  const described = schemaFromTypeDefs(`
    "Needs a role."
    directive @auth(
      "Role name."
      role: String
    ) on FIELD_DEFINITION
    "Root."
    type Query {
      "Described."
      ok: Boolean!
    }
  `);
  assert.deepEqual(missingDescriptions(described), []);
});
