'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c',
  'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'
], {cwd: root, encoding: 'utf8'})).SERVER_JS;

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Source boundaries: ${start}`);
  return source.slice(from, to);
}

function runtime(options = {}) {
  const session = {id: 'fixture', topic: 'Public fixture topic', notes: [], logs: [], metric: 0};
  const calls = [], writes = new Map(), messages = [], scraped = [];
  const agent = {id: 'researcher', model: 'served-model', provider: 'local-compatible'};
  const context = vm.createContext({
    config: options.config || {researchAgentId: agent.id},
    agents: new Map([[agent.id, agent], ['verifier', {id: 'verifier', model: 'review-model', provider: 'local-compatible'}], ['summarizer', {id: 'summarizer', model: 'summary-model', provider: 'local-compatible'}]]),
    researchSessions: new Map([[session.id, session]]),
    clients: new Map(), WebSocket: {OPEN: 1},
    path, RESEARCH_DIR: '/fixture-research',
    require(name) {
      assert.equal(name, 'crypto', 'No network or process module allowed');
      return require('node:crypto');
    },
    fs: {writeFileSync(file, text) {
      if (options.writeFailure) throw new Error('fixture disk failure');
      writes.set(file, JSON.parse(text));
    }},
    console: {error() {}, warn() {}, log() {}},
    setTimeout(callback) { callback(); },
    async ddgSearch() { return options.urls || []; },
    async scrapeText(url) { scraped.push(url); return options.contents?.[url] ?? (options.content === undefined ? 'The fixture launched in 2020.' : options.content); },
    async queryOllamaWithRetry(...args) {
      calls.push(args);
      if (args[4] === 'verifier' && typeof options.onVerify === 'function') return options.onVerify({args, session});
      if (args[4] === 'summarizer' && typeof options.onSummary === 'function') return options.onSummary({args, session});
      if (args[4] === 'verifier') return options.verificationResponse === undefined ? JSON.stringify({decisions: [{claimId: 'C1', status: 'supported', reason: 'The excerpt states the launch year.', evidence: [{sourceId: 'S1', quote: 'The fixture launched in 2020.'}]}]}) : options.verificationResponse;
      if (args[4] === 'summarizer') return options.summaryResponse === undefined ? JSON.stringify({claimIds: ['C1']}) : options.summaryResponse;
      if (args[1].startsWith('Generate 3 sub-questions')) {
        return options.questions === undefined ? 'When did the fixture launch?' : options.questions;
      }
      return options.extract === undefined ? 'FACT: The fixture launched in 2020.' : options.extract;
    },
    addMessage(channel, sender, type, content) { const msg = {channel, sender, type, content}; messages.push(msg); return msg; },
    broadcastToStore() {},
    async gitCommit() { assert.fail('Research must not invoke Git'); }
  });
  context.workspaceTransport = () => null;
  context.workspaceServices = () => null;
  context.workspaceResources = () => null;
  const api = vm.runInContext(section('function workspaceSetting(', 'function workspaceTransport(') + section('function scopedResourceDir(', 'function workspaceAuthorizeModel(') + section('function persistWorkspaceResearch(', 'function scheduleWorkspaceMaintenance(') + section('function workspaceClients()', 'function initializeWorkspace(') + section('function formatResearchSummary(', '// ==================== CLEANUP') + '\n({runResearch, formatResearchSummary, reviewResearchEvidence})', context);
  return {api, session, calls, writes, messages, scraped};
}

test('empty search never manufactures facts or generates an answer', async () => {
  const r = runtime();
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.equal(r.calls.length, 1, 'Only question generation is allowed');
  assert.equal(r.session.facts.length, 0);
  assert.equal(r.session.evidence.length, 0);
  assert.equal(r.session.phase, 'Insufficient evidence');
  assert.equal(r.session.notes[0].status, 'search_unavailable_or_empty');
  assert.match(r.api.formatResearchSummary(r.session), /Insufficient evidence/);
  assert.equal(r.writes.get(path.join('/fixture-research', 'fixture.json')).notes.length, 1);
});

for (const content of ['', '[Scrape failed: timeout]', '[Scrape skipped: URL on blocklist]']) {
  test(`unusable page cannot enter the extraction or answer path: ${JSON.stringify(content)}`, async () => {
    const r = runtime({urls: ['https://example.org/source'], content});
    await r.api.runResearch('fixture', r.session.topic, 'general');
    assert.equal(r.calls.length, 1);
    assert.equal(r.session.evidence.length, 0);
    assert.equal(r.session.sources[0].status, 'fetch_failed');
    assert.equal(r.session.notes[0].status, 'insufficient_evidence');
  });
}

test('source references survive collection, persistence and the full report', async () => {
  const r = runtime({urls: ['https://example.org/source']});
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.equal(r.calls.length, 2, 'No unsupported synthesis call');
  assert.ok(r.calls.every(call => call[0] === 'served-model' && call[4] === 'researcher'));
  assert.equal(r.session.phase, 'Awaiting verification');
  assert.equal(r.session.verifiedCount, 0);
  assert.equal(r.session.evidence[0].text, 'The fixture launched in 2020.');
  assert.equal(r.session.evidence[0].sourceId, 'S1');
  assert.equal(r.session.evidence[0].status, 'unverified');
  const saved = r.writes.get(path.join('/fixture-research', 'fixture.json'));
  assert.equal(saved.sources[0].url, 'https://example.org/source');
  assert.equal(saved.sources[0].excerpt, 'The fixture launched in 2020.');
  assert.match(saved.sources[0].excerptSha256, /^[0-9a-f]{64}$/);
  const report = r.api.formatResearchSummary(r.session);
  assert.match(report, /\[UNVERIFIED\] The fixture launched in 2020\./);
  assert.match(report, /Source \[S1\]: https:\/\/example.org\/source/);
  assert.match(report, /not evidence confidence/);
});

test('all question notes remain in the report, not just the last answer', async () => {
  const r = runtime({urls: ['https://example.org/source'], questions: 'When did the fixture launch?\nWho maintains this fixture?\nWhere is this fixture documented?'});
  await r.api.runResearch('fixture', r.session.topic, 'general');
  const report = r.api.formatResearchSummary(r.session);
  assert.equal(r.session.notes.length, 3);
  for (const question of ['When did the fixture launch?', 'Who maintains this fixture?', 'Where is this fixture documented?']) {
    assert.ok(report.includes(question));
  }
  assert.ok(report.includes('Source [S1]'));
  assert.ok(report.includes('Source [S3]'));
});

test('missing or invalid explicit research assignment sends no model requests', async () => {
  for (const config of [{}, {researchAgentId: 'missing'}]) {
    const r = runtime({config});
    await r.api.runResearch('fixture', r.session.topic, 'general');
    assert.equal(r.calls.length, 0);
    assert.equal(r.session.evidenceStatus, 'configuration_error');
    assert.equal(r.session.phase, 'Failed');
  }
});

test('initiating Agent overrides slash-command default assignment', async () => {
  const r = runtime({config: {researchAgentId: 'missing'}});
  await r.api.runResearch('fixture', r.session.topic, 'general', 'researcher');
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0][4], 'researcher');
  assert.equal(r.session.agentId, 'researcher');
});

test('research action passes its initiating Agent identity', async () => {
  const launches = [];
  const execute = vm.runInNewContext(section('async function executeAction(', 'async function agentPlanAndAct(') + '\nexecuteAction', {
    uuidv4: () => 'fixture', researchSessions: new Map(),
    async runResearch(...args) { launches.push(args); },
    addMessage() { return null; }, console
  });
  await execute({id: 'local-1cat', name: 'Retriever'}, 'research-room', {type: 'research', payload: {topic: 'fixture'}});
  assert.deepEqual(launches, [['fixture', 'fixture', 'research-room', 'local-1cat']]);
});

for (const questions of ['[OLLAMA_ERROR] Model request failed', '']) {
  test(`failed question generation stops collection: ${JSON.stringify(questions)}`, async () => {
    const r = runtime({questions});
    await r.api.runResearch('fixture', r.session.topic, 'general');
    assert.equal(r.session.phase, 'Failed');
    assert.equal(r.session.evidenceStatus, 'model_failed');
    assert.equal(r.scraped.length, 0);
  });
}

test('failed extraction leaves evidence empty and preserves the source', async () => {
  const r = runtime({urls: ['https://example.org/source'], extract: '[OLLAMA_ERROR] Model request failed'});
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.equal(r.calls.length, 2);
  assert.equal(r.session.evidence.length, 0);
  assert.equal(r.session.sources[0].status, 'extraction_failed');
  assert.equal(r.session.sources[0].url, 'https://example.org/source');
  assert.equal(r.session.phase, 'Insufficient evidence');
});

test('duplicate URLs are fetched once per question and excerpts are bounded', async () => {
  const r = runtime({urls: ['https://example.org/source', 'https://example.org/source'], content: 'x'.repeat(4500)});
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.equal(r.scraped.length, 1);
  assert.equal(r.session.sources[0].excerpt.length, 4000);
  assert.equal(r.session.sources[0].truncated, true);
});

test('broken source reference is visibly marked missing rather than fabricated', () => {
  const r = runtime();
  const report = r.api.formatResearchSummary({topic: 'fixture', phase: 'Awaiting verification', notes: [{question: 'Question?', evidence: [{text: 'Unsupported claim', sourceId: 'absent'}], sources: []}]});
  assert.match(report, /MISSING SOURCE: do not use as a conclusion/);
});

test('artifact write failure is surfaced without claiming persistence', async () => {
  const r = runtime({writeFailure: true});
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.equal(r.session.persistenceError, true);
  assert.ok(r.session.logs.includes('Research artifact could not be saved.'));
});

const roleConfig = {researchRoles: {retriever: 'researcher', verifier: 'verifier', summarizer: 'summarizer'}};
const supportedDecision = {claimId: 'C1', status: 'supported', reason: 'The excerpt supports the date.', evidence: [{sourceId: 'S1', quote: 'The fixture launched in 2020.'}]};
function collaborative(options = {}) {
  return runtime({config: roleConfig, urls: ['https://example.org/source'], ...options});
}

test('three-role research routes in order and persists exact evidence for its summary', async () => {
  const r = collaborative();
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.deepEqual(r.calls.map(call => [call[0], call[4]]), [['served-model', 'researcher'], ['served-model', 'researcher'], ['review-model', 'verifier'], ['summary-model', 'summarizer']]);
  assert.equal(r.session.phase, 'Review complete');
  assert.equal(r.session.verifiedCount, 1);
  assert.equal(r.session.evidence[0].status, 'supported');
  assert.equal(r.session.evidence[0].verification.verifierId, 'verifier');
  assert.equal(r.session.evidence[0].verification.evidence[0].quote, 'The fixture launched in 2020.');
  const saved = r.writes.get(path.join('/fixture-research', 'fixture.json'));
  assert.deepEqual(saved.summary.claimIds, ['C1']);
  assert.equal(saved.summary.summarizerId, 'summarizer');
  const report = r.api.formatResearchSummary(r.session);
  assert.match(report, /\[SUPPORTED\] The fixture launched in 2020\./);
  assert.match(report, /Quote: The fixture launched in 2020\./);
  assert.match(report, /https:\/\/example.org\/source/);
  assert.match(report, /human review/i);
});

for (const researchRoles of [
  {retriever: 'researcher', verifier: 'missing', summarizer: 'summarizer'},
  {retriever: 'researcher', verifier: 'researcher', summarizer: 'summarizer'},
  {retriever: 'researcher', verifier: 'verifier'}
]) {
  test(`invalid role mapping is rejected before any model call: ${JSON.stringify(researchRoles)}`, async () => {
    const r = collaborative({config: {researchRoles}});
    await r.api.runResearch('fixture', r.session.topic, 'general');
    assert.equal(r.session.evidenceStatus, 'configuration_error');
    assert.equal(r.calls.length, 0);
  });
}

test('a local-only role cannot hand its evidence to a role without local-only policy', async () => {
  const r = collaborative({config: {...roleConfig, agentRouting: {researcher: {localOnly: true}}}});
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.equal(r.session.evidenceStatus, 'configuration_error');
  assert.equal(r.calls.length, 0);
});

for (const [name, verificationResponse] of [
  ['model failure', '[OLLAMA_ERROR] timeout'],
  ['malformed JSON', 'not JSON'],
  ['omitted decision', '{"decisions":[]}'],
  ['unknown claim', JSON.stringify({decisions: [{...supportedDecision, claimId: 'invented'}]})],
  ['invented quote', JSON.stringify({decisions: [{...supportedDecision, evidence: [{sourceId: 'S1', quote: 'The fixture launched in 2099.'}]}]})],
  ['unknown source', JSON.stringify({decisions: [{...supportedDecision, evidence: [{sourceId: 'invented', quote: 'The fixture launched in 2020.'}]}]})],
  ['missing supporting quote', JSON.stringify({decisions: [{...supportedDecision, evidence: []}]})],
  ['duplicate decision', JSON.stringify({decisions: [supportedDecision, supportedDecision]})]
]) {
  test(`verification fails closed for ${name}`, async () => {
    const r = collaborative({verificationResponse});
    await r.api.runResearch('fixture', r.session.topic, 'general');
    assert.equal(r.session.evidenceStatus, 'verification_failed');
    assert.equal(r.session.verifiedCount, 0);
    assert.equal(r.session.evidence[0].status, 'unverified');
    assert.equal(r.calls.filter(call => call[4] === 'summarizer').length, 0);
    assert.equal(r.writes.get(path.join('/fixture-research', 'fixture.json')).evidenceStatus, 'verification_failed');
  });
}

for (const status of ['partially_supported', 'insufficient_evidence']) {
  test(`${status} is not promoted into a supported conclusion`, async () => {
    const r = collaborative({verificationResponse: JSON.stringify({decisions: [{...supportedDecision, status, evidence: status === 'insufficient_evidence' ? [] : supportedDecision.evidence}]})});
    await r.api.runResearch('fixture', r.session.topic, 'general');
    assert.equal(r.session.evidence[0].status, status);
    assert.equal(r.session.verifiedCount, 0);
    assert.equal(r.calls.filter(call => call[4] === 'summarizer').length, 0);
    const report = r.api.formatResearchSummary(r.session);
    assert.ok(report.includes(`[${status.toUpperCase()}]`));
    assert.ok(!report.includes('[SUPPORTED]'));
  });
}

test('conflicting sources remain in the report and never reach synthesis', async () => {
  const evidence = [{sourceId: 'S1', quote: 'The fixture launched in 2020.'}, {sourceId: 'S2', quote: 'The fixture launched in 2021.'}];
  const r = collaborative({urls: ['https://example.org/a', 'https://example.org/b'], contents: {'https://example.org/b': 'The fixture launched in 2021.'}, verificationResponse: JSON.stringify({decisions: ['C1', 'C2'].map(claimId => ({claimId, status: 'conflicting', reason: 'Launch years disagree.', evidence}))})});
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.equal(r.session.verifiedCount, 0);
  assert.equal(r.calls.filter(call => call[4] === 'summarizer').length, 0);
  const report = r.api.formatResearchSummary(r.session);
  assert.match(report, /\[CONFLICTING\]/);
  assert.ok(report.includes('https://example.org/a') && report.includes('https://example.org/b'));
  assert.ok(report.includes('2020') && report.includes('2021'));
});

for (const summaryResponse of ['[OLLAMA_ERROR] timeout', '{"claimIds":["invented"]}', '{"claimIds":[]}', '{"claimIds":["C1","C1"]}', '{"claimIds":["C1"],"conclusion":"invented conclusion"}']) {
  test(`invalid synthesis is rejected: ${summaryResponse}`, async () => {
    const r = collaborative({summaryResponse});
    await r.api.runResearch('fixture', r.session.topic, 'general');
    assert.equal(r.session.phase, 'Summary failed');
    assert.equal(r.session.summary.status, 'failed');
    assert.equal(r.session.verifiedCount, 1, 'Successful verification remains auditable');
    assert.ok(!r.api.formatResearchSummary(r.session).includes('invented conclusion'));
  });
}


function batchMaterial(args) {
  return JSON.parse(args[1].split('\nData:\n')[1]);
}
function batchDecisions(material) {
  return {decisions: material.claims.map(claim => ({claimId: claim.claimId, status: 'supported', reason: 'The saved synthetic source states the claim.', evidence: [{sourceId: claim.sourceId, quote: claim.text}]}))};
}
function seedBatchSession(r, counts) {
  let claimNumber = 0;
  const notes = counts.map((count, noteIndex) => {
    const sentences = year => Array.from({length: count}, (_, i) => 'Fixture ' + noteIndex + ' item ' + i + ' launched in ' + year + '.');
    const sources = [2020, 2021].map((year, index) => ({sourceId: 'S' + noteIndex + '_' + index, url: 'https://example.org/note-' + noteIndex + '/source-' + index, excerpt: sentences(year).join(' '), truncated: false}));
    const evidence = Array.from({length: count}, (_, i) => {
      const sourceIndex = i < Math.ceil(count / 2) ? 0 : 1;
      return {claimId: 'C' + (++claimNumber), text: sentences(sourceIndex ? 2021 : 2020)[i], sourceId: sources[sourceIndex].sourceId, status: 'unverified'};
    });
    return {question: 'Synthetic question ' + noteIndex, status: 'unverified', sources, evidence, facts: evidence.map(item => item.text)};
  });
  Object.assign(r.session, {notes, sources: notes.flatMap(note => note.sources), evidence: notes.flatMap(note => note.evidence), verifiedCount: 0, evidenceStatus: 'unverified'});
}
async function reviewBatchSession(r) {
  await r.api.reviewResearchEvidence(r.session, {retriever: {id: 'researcher'}, verifier: {id: 'verifier'}, summarizer: {id: 'summarizer'}}, update => Object.assign(r.session, update));
}
for (const count of [0, 1, 3, 4, 6, 7, 9, 10]) {
  test('verification uses three-claim batches without loss at boundary ' + count, async () => {
    const batches = [];
    const r = collaborative({
      onVerify({args, session}) {
        const material = batchMaterial(args);
        batches.push(material.claims.map(claim => claim.claimId));
        assert.ok(session.evidence.every(claim => claim.status === 'unverified' && !claim.verification));
        assert.equal(session.verifiedCount, 0);
        return JSON.stringify(batchDecisions(material));
      },
      onSummary({args}) { return JSON.stringify({claimIds: batchMaterial(args).claims.map(claim => claim.claimId).reverse()}); }
    });
    seedBatchSession(r, [count]);
    const expected = r.session.evidence.map(claim => claim.claimId);
    await reviewBatchSession(r);
    assert.deepEqual(batches.map(batch => batch.length), Array.from({length: Math.ceil(count / 3)}, (_, i) => Math.min(3, count - i * 3)));
    assert.deepEqual(batches.flat(), expected);
    assert.equal(r.session.verifiedCount, count);
    assert.equal(r.session.summary.status, count ? 'complete' : 'skipped_no_supported_claims');
    assert.equal(r.calls.filter(call => call[4] === 'summarizer').length, count ? 1 : 0);
    if (count) assert.deepEqual(JSON.parse(JSON.stringify(r.session.summary.claimIds)), [...expected].reverse());
  });
}

test('batched full collection persists all claims, original sources, quotes and complete synthesis', async () => {
  const facts = Array.from({length: 5}, (_, i) => 'Fixture item ' + i + ' launched in 2020.');
  const sizes = [];
  const r = collaborative({urls: ['https://example.org/source-a', 'https://example.org/source-b'], content: facts.join(' '), extract: facts.map(text => 'FACT: ' + text).join('\n'),
    onVerify({args, session}) {
      const material = batchMaterial(args); sizes.push(material.claims.length);
      assert.ok(session.evidence.every(claim => claim.status === 'unverified'));
      return JSON.stringify(batchDecisions(material));
    },
    onSummary({args}) { return JSON.stringify({claimIds: batchMaterial(args).claims.map(claim => claim.claimId)}); }
  });
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.deepEqual(sizes, [3, 3, 3, 1]);
  assert.equal(r.session.phase, 'Review complete');
  const saved = r.writes.get(path.join('/fixture-research', 'fixture.json'));
  assert.equal(saved.evidence.length, 10); assert.equal(saved.verifiedCount, 10);
  assert.deepEqual(saved.summary.claimIds, saved.evidence.map(claim => claim.claimId));
  assert.deepEqual(saved.sources.map(source => source.url), ['https://example.org/source-a', 'https://example.org/source-b']);
  assert.ok(saved.evidence.every(claim => claim.verification.verifierId === 'verifier' && claim.verification.evidence[0].quote === claim.text));
  const report = r.api.formatResearchSummary(r.session);
  for (const source of saved.sources) assert.ok(report.includes(source.url));
  for (const fact of facts) assert.ok(report.includes('Quote: ' + fact));
  assert.deepEqual(r.calls.filter(call => call[4] === 'verifier').map(call => call[0]), Array(4).fill('review-model'));
  assert.equal(r.calls.find(call => call[4] === 'summarizer')[0], 'summary-model');
});

for (const kind of ['model_failure', 'malformed_json', 'missing_decision', 'previous_batch_claim', 'duplicate_decision', 'invented_quote', 'unknown_source']) {
  test('later batch ' + kind + ' cannot promote any question or run synthesis', async () => {
    let batch = 0, priorClaim;
    const r = collaborative({onVerify({args, session}) {
      const material = batchMaterial(args), output = batchDecisions(material);
      assert.ok(session.evidence.every(claim => claim.status === 'unverified' && !claim.verification));
      batch++;
      if (batch === 1) priorClaim = {...output.decisions[0]};
      if (batch === 3) {
        if (kind === 'model_failure') return '[OLLAMA_ERROR] bounded fixture failure';
        if (kind === 'malformed_json') return 'not JSON';
        if (kind === 'missing_decision') output.decisions.pop();
        if (kind === 'previous_batch_claim') output.decisions[0] = priorClaim;
        if (kind === 'duplicate_decision') output.decisions[1] = output.decisions[0];
        if (kind === 'invented_quote') output.decisions[0].evidence = [{sourceId: material.claims[0].sourceId, quote: 'This sentence is absent from the original sources.'}];
        if (kind === 'unknown_source') output.decisions[0].evidence = [{sourceId: 'absent', quote: material.claims[0].text}];
      }
      return JSON.stringify(output);
    }, onSummary() { assert.fail('A failed batch must never reach synthesis'); }});
    seedBatchSession(r, [4, 4]);
    await reviewBatchSession(r);
    assert.equal(batch, 3);
    assert.equal(r.session.phase, 'Verification failed');
    assert.equal(r.session.evidenceStatus, 'verification_failed');
    assert.equal(r.session.verifiedCount, 0);
    assert.ok(r.session.notes.every(note => note.status === 'unverified'));
    assert.ok(r.session.evidence.every(claim => claim.status === 'unverified' && !claim.verification));
    assert.equal(r.calls.filter(call => call[4] === 'summarizer').length, 0);
  });
}

test('late batch retains other trusted sources for conflicts and preserves unresolved gaps in synthesis', async () => {
  const sizes = [];
  const r = collaborative({onVerify({args}) {
    const material = batchMaterial(args), output = batchDecisions(material); sizes.push(material.claims.length);
    if (material.claims.length === 1) {
      const claim = material.claims[0], other = material.sources.find(source => source.sourceId !== claim.sourceId);
      assert.ok(other, 'A later batch must retain the full trusted source context');
      output.decisions[0] = {claimId: claim.claimId, status: 'conflicting', reason: 'The two saved synthetic sources disagree.', evidence: [
        {sourceId: claim.sourceId, quote: claim.text}, {sourceId: other.sourceId, quote: claim.text.replace('2021', '2020')}
      ]};
    }
    return JSON.stringify(output);
  }, onSummary({args}) { return JSON.stringify({claimIds: batchMaterial(args).claims.map(claim => claim.claimId)}); }});
  seedBatchSession(r, [4]);
  await reviewBatchSession(r);
  assert.deepEqual(sizes, [3, 1]);
  assert.equal(r.session.verifiedCount, 3); assert.equal(r.session.phase, 'Review complete with gaps');
  assert.deepEqual(JSON.parse(JSON.stringify(r.session.summary.claimIds)), ['C1', 'C2', 'C3']);
  const report = r.api.formatResearchSummary(r.session);
  assert.match(report, /\[CONFLICTING\]/);
  assert.ok(report.includes('https://example.org/note-0/source-0') && report.includes('https://example.org/note-0/source-1'));
});

test('failure in a later collection batch persists all evidence as unverified', async () => {
  let batch = 0;
  const facts = Array.from({length: 5}, (_, i) => 'Fixture item ' + i + ' launched in 2020.');
  const r = collaborative({urls: ['https://example.org/source-a', 'https://example.org/source-b'], content: facts.join(' '), extract: facts.map(text => 'FACT: ' + text).join('\n'),
    onVerify({args}) { return ++batch === 2 ? '[OLLAMA_ERROR] fixture timeout' : JSON.stringify(batchDecisions(batchMaterial(args))); },
    onSummary() { assert.fail('Synthesis is not allowed after failure'); }
  });
  await r.api.runResearch('fixture', r.session.topic, 'general');
  assert.equal(batch, 2);
  const saved = r.writes.get(path.join('/fixture-research', 'fixture.json'));
  assert.equal(saved.phase, 'Verification failed'); assert.equal(saved.evidence.length, 10); assert.equal(saved.verifiedCount, 0);
  assert.ok(saved.evidence.every(claim => claim.status === 'unverified' && !claim.verification));
  assert.equal(saved.sources.length, 2); assert.ok(saved.sources.every(source => source.excerpt && source.excerptSha256));
  assert.equal(r.calls.filter(call => call[4] === 'summarizer').length, 0);
});

test('summary cannot omit a supported claim from a later verification batch', async () => {
  const r = collaborative({onVerify({args}) { return JSON.stringify(batchDecisions(batchMaterial(args))); },
    onSummary({args}) { return JSON.stringify({claimIds: batchMaterial(args).claims.slice(0, 3).map(claim => claim.claimId)}); }});
  seedBatchSession(r, [4]);
  await reviewBatchSession(r);
  assert.equal(r.session.verifiedCount, 4);
  assert.equal(r.session.phase, 'Summary failed'); assert.equal(r.session.summary.status, 'failed');
  assert.ok(r.session.evidence.every(claim => claim.status === 'supported'));
});
