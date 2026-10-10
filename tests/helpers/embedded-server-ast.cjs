'use strict';
const assert = require('node:assert/strict');
function runtimeStatements(source) {
  const nodes = require('espree').parse(source, {ecmaVersion: 'latest', sourceType: 'script', range: true}).body;
  const lifecycle = nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'startLackRuntime');
  assert.ok(lifecycle, 'explicit runtime lifecycle exists');
  const initialization = lifecycle.body.body.find(node => node.type === 'TryStatement');
  assert.ok(initialization, 'owned startup has a cleanup boundary');
  return initialization.block.body;
}
module.exports = {runtimeStatements};
