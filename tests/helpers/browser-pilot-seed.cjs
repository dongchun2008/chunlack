'use strict';
// Disposable manual UI fixture only: this never represents vendor execution.
const {deflateSync} = require('node:zlib');
const {AgentClient} = require('../../sdk/agent-client.cjs');
const {pairingRoute} = require('../../sdk/pairing.cjs');
const marker = 'SYNTHETIC LOCAL PNG ONLY - NOT MUSE/DOTS';
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);}
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([head, name, data, tail]);
}
function createSyntheticImage() {
  const width = 640, height = 360, stride = width * 3 + 1;
  const pixels = Buffer.alloc(height * stride), header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = (Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [235, 241, 214] : [112, 135, 58];
    const offset = y * stride + 1 + x * 3;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2];
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('tEXt', Buffer.from('Comment\0' + marker)), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
async function seedBrowserPilot({port, gatewayPort, origin, workspaceId, session, label}) {
  const baseUrl = 'http://127.0.0.1:' + port;
  async function step(name, fn) {
    try {return await fn();} catch (error) {throw new Error('Fixture ' + name + ' rejected: ' + (error.status || '') + ' ' + error.message);}
  }
  async function human(route, body) {
    const response = await fetch(baseUrl + route, {method: 'POST', redirect: 'error',
      headers: {Origin: origin, Cookie: '__Host-chunlack_session=' + session.token,
        'X-Workspace-Id': workspaceId, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000)});
    const value = await response.json();
    if (!response.ok) throw new Error('Fixture human route rejected: ' + response.status + ' ' + value.error);
    return value;
  }
  const created = await human('/api/nodes', {name: 'Synthetic Browser QA ' + label,
    capabilities: ['browser.public_read'], scopes: ['public']});
  if (!created.node?.id || typeof created.pairingCode !== 'string') throw new Error('Fixture node creation shape invalid');
  const pairing = new AgentClient({baseUrl: 'http://127.0.0.1:' + gatewayPort, workspaceId});
  const paired = await step('workspace pairing', () => pairing.request(pairingRoute({workspaceId}), {method: 'POST', body: {code: created.pairingCode}}));
  if (paired.workspaceId !== workspaceId || paired.nodeId !== created.node.id) throw new Error('Fixture pair binding invalid');
  const worker = new AgentClient({baseUrl: pairing.baseUrl, workspaceId, nodeId: paired.nodeId, token: paired.token});
  const queued = await human('/api/tasks', {targetNodeId: created.node.id});
  const task = await step('task claim', () => worker.claimTask(queued.task.taskId));
  if (!task || task.taskId !== queued.task.taskId) throw new Error('Fixture task claim mismatch');
  const artifact = await step('image upload', () => worker.uploadArtifact(task, {bytes: createSyntheticImage(), contentType: 'image/png'}));
  await step('result receipt', () => worker.result(task, {status: 'succeeded', output: {url: task.input.url, challenge: task.input.challenge,
    title: marker + ' / ' + label, artifactId: artifact.artifactId,
    executedAt: new Date().toISOString(), activityEvidence: 'Disposable UI fixture only; no external Agent or cloud browser executed.'}}));
  return {taskId: task.taskId, nodeId: paired.nodeId};
}
module.exports = {createSyntheticImage, seedBrowserPilot};
