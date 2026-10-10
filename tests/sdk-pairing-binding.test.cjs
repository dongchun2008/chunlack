'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('private pairing requires an explicit workspace and preserves the server-owned node identity in its profile',()=>{
  const {pairingArgs,bindingFromPairing}=require('../sdk/pairing.cjs');
  assert.deepEqual(pairingArgs(['https://agents.example','--workspace','workspace-a']),{baseUrl:'https://agents.example',workspaceId:'workspace-a'});
  assert.deepEqual(pairingArgs(['http://127.0.0.1:3722']),{baseUrl:'http://127.0.0.1:3722',workspaceId:undefined});
  assert.throws(()=>pairingArgs(['https://agents.example','--workspace','../other']));
  const paired={nodeId:'node-a',token:'synthetic-only-'.repeat(4),workspaceId:'workspace-a'};
  assert.throws(()=>bindingFromPairing(paired,{}));
  assert.throws(()=>bindingFromPairing(paired,{workspaceId:'workspace-b'}));
  assert.deepEqual(bindingFromPairing(paired,{workspaceId:'workspace-a'}),paired);
  assert.throws(()=>bindingFromPairing({...paired,nodeId:'../other'},{workspaceId:'workspace-a'}));
  assert.deepEqual(bindingFromPairing({nodeId:'legacy-node',token:paired.token},{}),{nodeId:'legacy-node',token:paired.token});
});
