'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'lack.py'), 'utf8');
const definition = source.match(/async function retrievePrivateMemory\([^]*?\n}/)[0];
function retrieve(memory, services = {}) {
  return vm.runInNewContext('(' + definition + ')', { agentMemories: new Map([['legacy', memory]]), getEmbedding: async () => { throw new Error('unexpected_embedding_call'); }, cosineSimilarity: () => 0, simpleTfidfSimilarity: () => 0, ...services });
}
test('URL-only migrated memory stays intact without becoming invented prompt evidence', async () => {
  const memory = { ePool: [{ url: 'https://example.com/original', missingEvidence: true }], xPool: [{ candidate: 'Original candidate text', score: 2 }] };
  const before = JSON.stringify(memory);
  assert.equal(await retrieve(memory)('legacy', 'query', 5, true), '[EXPLORE] Original candidate text');
  assert.equal(JSON.stringify(memory), before);
});
test('malformed pools and non-text records cannot crash recall or mutate valid original text', async () => {
  const memory = { ePool: [null, 1, { trajectory: 42 }, { trajectory: '' }, { trajectory: 'Original narrative', score: 3 }], xPool: { candidate: 'not an array' } }, before = JSON.stringify(memory);
  assert.equal(await retrieve(memory)('legacy', 'query'), '[PROVEN] Original narrative');
  assert.equal(JSON.stringify(memory), before);
});
test('invalid embeddings and scores are not submitted to an embedding backend', async () => {
  const memory = { ePool: [{ trajectory: 'Original low score', score: 'invalid', embedding: 'invalid' }], xPool: [{ candidate: 'Original high score', score: 2, embedding: [1, NaN] }] };
  assert.equal(await retrieve(memory)('legacy', 'query', 1, true), '[EXPLORE] Original high score');
});
test('valid original embeddings still rank normally and preserve bounded unmodified source entries', async () => {
  const memory = { ePool: [{ trajectory: 'Original relevant', score: 1, embedding: [1, 0] }], xPool: [{ candidate: 'Original unrelated', score: 5, embedding: [0, 1] }] }, before = JSON.stringify(memory);
  const query = retrieve(memory, { getEmbedding: async () => [1, 0], cosineSimilarity: (a, b) => a[0] * b[0] + a[1] * b[1] });
  assert.equal(await query('legacy', 'query', 1, true), '[PROVEN] Original relevant');
  assert.equal(JSON.stringify(memory), before);
});
