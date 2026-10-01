// Story 7.3: the deterministic post-processing of scripts/gen-openapi.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNGATED_PATHS, leakProblems, nullableToType, postProcess, referenceProblems, sameDocument } from './gen-openapi.mjs';

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (name) => ({ content: { 'application/json': { schema: ref(name) } } });

function sample() {
  return {
    paths: {
      '/media/d/{fileId}': {
        head: {
          security: [{ cookie: [] }],
          parameters: [{ in: 'path', name: 'fileId', required: true, example: 123 }],
          responses: { 200: { description: 'bytes', ...json('MediaBytes') }, 404: { description: 'x', ...json('ErrorBody') } },
        },
        get: {
          security: [{ cookie: [] }],
          parameters: [{ in: 'path', name: 'fileId', required: true, example: 123 }],
          responses: { 200: { description: 'bytes', ...json('MediaBytes') }, 416: { description: 'range', ...json('NoBody') } },
        },
      },
      '/api/v1/pipeline/jobs/{id}/output': {
        put: {
          security: [{ worker: [] }],
          parameters: [{ in: 'header', name: 'X_Claim_Token', required: true, example: 'example' }],
          requestBody: json('BinaryBody'),
          responses: { 200: { description: 'ok', ...json('OutputResponse') } },
        },
      },
      '/s/{slug}/items': { get: { security: [{ share: [] }], responses: { 200: { description: 'ok', ...json('Page') } } } },
      '/api/health': { get: { security: [{ public: [] }], responses: { 200: { description: 'ok', ...json('Health') } } } },
    },
    components: {
      securitySchemes: { SessionCookie: {}, ShareCookie: {}, WorkerToken: {} },
      schemas: {
        ErrorBody: { type: 'object' },
        OutputResponse: { type: 'object', properties: { size: { type: 'number', nullable: false } } },
        Page: { type: 'object', properties: { cause: { type: ['string', 'null'], enum: ['EMPTY'] } } },
        Health: { type: 'object' },
        MediaBytes: { type: 'string' },
        BinaryBody: { type: 'string' },
        NoBody: { type: 'null' },
        JobPathParams: { type: 'object' },
      },
    },
  };
}

test('auth modes become security requirements and stay visible as x-shotstash-auth', () => {
  const { doc, problems } = postProcess(sample());
  assert.deepEqual(problems, []);
  assert.deepEqual(doc.paths['/media/d/{fileId}'].get.security, [{ SessionCookie: [] }]);
  assert.deepEqual(doc.paths['/api/v1/pipeline/jobs/{id}/output'].put.security, [{ WorkerToken: [] }]);
  assert.deepEqual(doc.paths['/s/{slug}/items'].get.security, [{ ShareCookie: [] }, {}]);
  assert.deepEqual(doc.paths['/api/health'].get.security, []);
  assert.equal(doc.paths['/api/health'].get['x-shotstash-auth'], 'public');
});

test('an unknown or missing auth mode is reported', () => {
  const s = sample();
  s.paths['/api/health'].get.security = [{ apikey: [] }];
  s.paths['/s/{slug}/items'].get.security = [];
  const { problems } = postProcess(s);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /GET \/api\/health: @auth must be one of/);
});

test('byte answers get media types, bodiless answers and HEAD lose their content', () => {
  const { doc } = postProcess(sample());
  const get = doc.paths['/media/d/{fileId}'].get;
  assert.deepEqual(Object.keys(get.responses[200].content), ['application/octet-stream']);
  assert.equal(get.responses[416].content, undefined);
  const head = doc.paths['/media/d/{fileId}'].head;
  assert.equal(head.responses[200].content, undefined);
  assert.equal(head.responses[404].content, undefined);
  const put = doc.paths['/api/v1/pipeline/jobs/{id}/output'].put;
  assert.deepEqual(Object.keys(put.requestBody.content), ['application/octet-stream']);
  assert.equal(put.requestBody.required, true);
});

test('header names, placeholder examples, operation ids, order and unused schemas', () => {
  const { doc } = postProcess(sample());
  const put = doc.paths['/api/v1/pipeline/jobs/{id}/output'].put;
  assert.equal(put.parameters[0].name, 'X-Claim-Token');
  assert.equal(put.parameters[0].example, undefined);
  assert.equal(doc.paths['/media/d/{fileId}'].get.parameters[0].example, undefined);
  assert.equal(put.operationId, 'putApiV1PipelineJobsByIdOutput');
  assert.deepEqual(Object.keys(doc.paths['/media/d/{fileId}']), ['get', 'head']);
  assert.deepEqual(Object.keys(doc.paths), [...Object.keys(doc.paths)].sort());
  assert.deepEqual(Object.keys(doc.components.schemas), ['ErrorBody', 'Health', 'OutputResponse', 'Page'], 'unused schemas are dropped; ErrorBody stays for the shared SetupRequired response');
  assert.equal('nullable' in doc.components.schemas.OutputResponse.properties.size, false);
  assert.deepEqual(doc.components.schemas.Page.properties.cause.enum, ['EMPTY', null]);
  assert.deepEqual(referenceProblems(doc), []);
});

test('leak checks catch hosts, absolute URLs, machine paths and tokens', () => {
  assert.deepEqual(leakProblems('{"servers":[{"url":"/"}],"jsonSchemaDialect":"https://spec.openapis.org/oas/3.1/dialect/base"}'), []);
  assert.equal(leakProblems('{"url":"http://localhost:3005"}').length, 2);
  assert.equal(leakProblems('{"url":"https://demo.example.org"}').length, 1);
  assert.equal(leakProblems('{"x":"/home/someone/shotstash"}').length, 1);
  assert.equal(leakProblems(`{"x":"${'ab12'.repeat(10)}"}`).length, 1);
});

test('3.0 nullable becomes a 3.1 type array (or a null branch) and is removed', () => {
  assert.deepEqual(nullableToType({ type: 'string', nullable: true }), { type: ['string', 'null'] });
  assert.deepEqual(nullableToType({ type: ['integer'], nullable: true }), { type: ['integer', 'null'] });
  assert.deepEqual(nullableToType({ $ref: '#/components/schemas/X', nullable: true }), { anyOf: [{ $ref: '#/components/schemas/X' }, { type: 'null' }] });
  assert.deepEqual(nullableToType({ anyOf: [{ type: 'string' }], nullable: true }), { anyOf: [{ type: 'string' }, { type: 'null' }] });
  assert.deepEqual(nullableToType({ type: 'string', nullable: false }), { type: 'string' });
  const { doc } = postProcess({
    paths: { '/api/v1/config': { get: { security: [{ public: [] }], responses: { 200: { description: 'ok', ...json('Thing') } } } } },
    components: { schemas: { Thing: { type: 'object', properties: { a: { type: 'string', nullable: true, enum: ['x'] } } } } },
  });
  assert.deepEqual(doc.components.schemas.Thing.properties.a, { type: ['string', 'null'], enum: ['x', null] });
  assert.ok(!JSON.stringify(doc).includes('nullable'));
});

test('every gated route documents the shared 503 SETUP_REQUIRED response; health, config and setup do not', () => {
  const op = () => ({ security: [{ public: [] }], responses: { 200: { description: 'ok', ...json('ErrorBody') } } });
  const paths = { '/api/ping': { get: op() }, '/api/v1/register': { post: { ...op(), responses: { 503: { description: 'PIPELINE_DISABLED', ...json('ErrorBody') } } } } };
  for (const p of UNGATED_PATHS) paths[p] = { get: op() };
  const { doc } = postProcess({ paths, components: { schemas: { ErrorBody: { type: 'object' } } } });
  assert.deepEqual(doc.paths['/api/ping'].get.responses['503'], { $ref: '#/components/responses/SetupRequired' });
  assert.match(doc.paths['/api/v1/register'].post.responses['503'].description, /PIPELINE_DISABLED or SETUP_REQUIRED/);
  for (const p of UNGATED_PATHS) assert.equal(doc.paths[p].get.responses['503'], undefined, p);
  assert.match(doc.components.responses.SetupRequired.description, /SETUP_REQUIRED/);
  assert.deepEqual(referenceProblems(doc), []);
});

test('openapi:check compares parsed JSON, so reformatting or key order is not drift', () => {
  const doc = { openapi: '3.1.0', info: { title: 'T', version: '1.2.3' } };
  assert.ok(sameDocument(JSON.stringify(doc, null, 2) + String.fromCharCode(10), doc));
  assert.ok(sameDocument('{"info":{"version":"1.2.3","title":"T"},"openapi":"3.1.0"}', doc));
  assert.ok(!sameDocument('{"info":{"version":"1.2.4","title":"T"},"openapi":"3.1.0"}', doc));
  assert.ok(!sameDocument('not json', doc));
  assert.ok(!sameDocument(null, doc));
});
