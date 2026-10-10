'use strict';
const {validateBaseUrl} = require('./agent-client.cjs');
function id(value) {if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid pairing identity'); return value;}
function pairingArgs(args) {
  if (!Array.isArray(args) || !(args.length === 1 || args.length === 3 && args[1] === '--workspace')) throw new Error('Usage: pair <private-gateway-origin> [--workspace <id>]');
  return {baseUrl: validateBaseUrl(args[0]), workspaceId: args.length === 3 ? id(args[2]) : undefined};
}
function bindingFromPairing(value, {workspaceId} = {}) {
  if (!value || typeof value.token !== 'string' || value.token.length < 40 || value.token.length > 128) throw new Error('Invalid pairing credentials');
  const nodeId = id(value.nodeId);
  if (workspaceId === undefined ? value.workspaceId !== undefined : id(workspaceId) !== value.workspaceId) throw new Error('Pairing workspace mismatch; specify the approved workspace');
  return {nodeId, token: value.token, ...(workspaceId === undefined ? {} : {workspaceId})};
}
module.exports = {pairingArgs, bindingFromPairing};
