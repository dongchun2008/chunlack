'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {crc32, deflateSync} = require('node:zlib');
const {workspaceFixture} = require('./workspace-fixture.cjs');
const {runWithWorkspace} = require('../../collaboration/context.cjs');
function screenshot() {
  function chunk(type, data) {const name = Buffer.from(type), value = Buffer.concat([name, data]); const size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(value)); return Buffer.concat([size, value, crc]);}
  const head = Buffer.alloc(13); head.writeUInt32BE(1, 0); head.writeUInt32BE(1, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.from([0, 1, 2, 3, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
function gatewayFixture(t, {capacityFactory} = {}) {
  const f = workspaceFixture(t);
  const capacity = capacityFactory ? f.own(capacityFactory(f)) : undefined;
  const store = require('../../gateway/store.cjs').createGatewayStore({dbPath: path.join(f.dir, 'gateway.sqlite'), now: f.now, multiUser: true, capacity});
  f.own(store);
  // A mode silently ignored by the existing store is the RED behavior, before the new facade exists.
  assert.equal(store.multiUser, true, 'Gateway must not silently fall back to unscoped storage');
  const access = require('../../gateway/workspace-access.cjs').createWorkspaceGatewayAccess({store, identity: f.store});
  const human = (user, workspace, fn) => runWithWorkspace(f.actor(user, workspace), () => fn(access.forHuman(f.actor(user, workspace))));
  const nodes = {}, credentials = {}, principals = {};
  for (const [user, workspace] of [['alice', 'a'], ['bob', 'b']]) {
    nodes[workspace] = human(user, workspace, h => h.createNode({name: 'Same name', capabilities: ['browser.public_read'], scopes: ['public']}));
    credentials[workspace] = store.pair(nodes[workspace].pairingCode);
    principals[workspace] = store.authenticate(credentials[workspace].token);
  }
  const node = workspace => access.forNode(principals[workspace]);
  const enqueue = workspace => human(workspace === 'a' ? 'alice' : 'bob', workspace, h => h.enqueueTask({targetNodeId: nodes[workspace].id, scopeId: 'public', taskType: 'browser.public_read', input: {url: 'https://example.com/', challenge: randomBytes(32).toString('base64url')}, deadlineAt: f.now() + 120000}));
  const artifacts = require('../../gateway/pilot-artifacts.cjs').createPilotArtifacts({store, root: path.join(f.dir, 'artifacts'), now: f.now});
  return {...f, gatewayStore: store, capacity, access, human, nodes, credentials, principals, node, enqueue, artifacts};
}
module.exports = {gatewayFixture, screenshot};
