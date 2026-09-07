'use strict';
const fs = require('node:fs');
const path = require('node:path');
for (const dir of ['config', 'logs', 'lineage', 'research', 'workspace', 'lack_repos/templates', 'thread_repos', 'agent_memories', 'db', 'k8s', 'jspace', '.github']) {
  fs.mkdirSync(path.join('/data', dir), { recursive: true });
}
const configPath = '/data/config/lack.config.json';
if (!fs.existsSync(configPath)) {
  fs.copyFileSync('/run/lack-seed.json', configPath, fs.constants.COPYFILE_EXCL);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (config.httpPort !== 3721) throw new Error('Container configuration must use httpPort 3721');
if (!config.defaultModel || config.defaultModel.startsWith('REPLACE_')) throw new Error('Set a real defaultModel before deployment');
require('/app/server.js');
