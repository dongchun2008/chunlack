'use strict';
// Acceptance adapter for the real workspace panel. This is a text-DOM contract,
// not a pixel/browser gate. Callers supply an already authorized REST client.
const assert = require('node:assert/strict');
const {documentFixture} = require('../../../tests/helpers/workspace-document.cjs');
const {mountWorkspaceShell} = require('../../../identity/workspace-shell.js');
async function readResearchReport({client, session, mount = mountWorkspaceShell}) {
  const document = documentFixture(), view = mount({client, document: document.document});
  try {
    view.render(client.snapshot()); await view.openResearch(session.id);
    const nodes = document.walk(), text = nodes.map(node => node.textContent).join('\n');
    assert.ok(text.includes('模型核验不等于事实已获人工确认'));
    const claims = Array.isArray(session.evidence) ? session.evidence : [];
    assert.equal(nodes.filter(node => node.className === 'workspace-research-claim').length, claims.length);
    for (const claim of claims) {
      const item = nodes.find(node => node.className === 'workspace-research-claim' && node.dataset.claimId === claim.claimId);
      assert.ok(item, claim.claimId); assert.ok(item.children.some(node => node.textContent === claim.text));
      assert.equal(item.dataset.status, claim.status || 'unverified');
      for (const ref of claim.verification?.evidence || []) assert.ok(item.children.some(node => node.tagName === 'blockquote' && node.textContent === ref.quote));
    }
    const summary = nodes.find(node => node.className === 'workspace-research-summary'); assert.ok(summary);
    const summaryIds = summary.children.filter(node => node.className === 'workspace-summary-claim').map(node => node.dataset.claimId);
    assert.deepEqual(summaryIds, session.summary?.claimIds || []);
    for (const source of session.sources || []) {
      const item = nodes.find(node => node.className === 'workspace-source' && node.children.some(child => child.textContent === source.sourceId)); assert.ok(item);
      assert.ok(item.children.some(node => node.tagName === 'blockquote' && node.textContent === (source.excerpt || '缺证：未提供原始摘录。')));
      let url; try {url = new URL(source.url);} catch {}
      if (url?.protocol === 'https:' && !url.username && !url.password) assert.ok(item.children.some(node => node.tagName === 'a' && node.href === source.url && node.rel === 'noopener noreferrer'));
    }
    return {text, claimCount: claims.length, sourceCount: (session.sources || []).length, summaryCount: summaryIds.length};
  } finally {view.close();}
}
module.exports = {readResearchReport};
