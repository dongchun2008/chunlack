#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createIdentityStore} = require('../identity/store.cjs');
const {createSessionService} = require('../identity/sessions.cjs');
const {IdentityError} = require('../identity/policy.cjs');
const specifications = Object.freeze({
  bootstrap: ['data-root', 'login', 'workspace', 'password-stdin'],
  'create-workspace': ['data-root', 'owner-id', 'workspace'],
  'issue-reset': ['data-root', 'user-id', 'output'],
  'disable-user': ['data-root', 'user-id']
});
function parse(argv) {
  if (!Array.isArray(argv) || !specifications[argv[0]]) throw new IdentityError('invalid_command', 400);
  const command = argv[0]; const options = Object.create(null);
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!specifications[command].includes(key) || Object.hasOwn(options, key)) throw new IdentityError('invalid_command', 400);
    if (key === 'password-stdin') options[key] = true;
    else {
      const value = argv[++i];
      if (typeof value !== 'string' || !value || value.startsWith('--') || value.length > 4096) throw new IdentityError('invalid_command', 400);
      options[key] = value;
    }
  }
  if (specifications[command].some(key => !Object.hasOwn(options, key))) throw new IdentityError('invalid_command', 400);
  return {command, options};
}
async function privatePassword(stdin) {
  if (stdin.isTTY) throw new IdentityError('protected_stdin_required', 400);
  const chunks = []; let size = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2048) throw new IdentityError('invalid_password', 400);
    chunks.push(buffer);
  }
  const bytes = Buffer.concat(chunks);
  let input;
  try {input = JSON.parse(bytes.toString('utf8'));} catch {throw new IdentityError('invalid_password', 400);}
  finally {bytes.fill(0); for (const chunk of chunks) chunk.fill(0);}
  if (!input || typeof input.password !== 'string' || Array.isArray(input) || Object.keys(input).length !== 1) throw new IdentityError('invalid_password', 400);
  return input.password;
}
function privateRoot(value) {
  if (!path.isAbsolute(value)) throw new IdentityError('private_state_required', 400);
  const root = path.resolve(value);
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new IdentityError('private_state_required', 400);
  return root;
}
async function runAccounts(argv, {stdin = process.stdin, stdout = process.stdout, stderr = process.stderr} = {}) {
  let store; let sessions;
  try {
    const {command, options} = parse(argv);
    const root = privateRoot(options['data-root']);
    store = createIdentityStore({dbPath: path.join(root, 'identity.sqlite')});
    sessions = createSessionService({store});
    if (command === 'bootstrap') {
      const password = await privatePassword(stdin);
      const passwordHash = await sessions.hashNewPassword({password, source: 'local-maintenance', login: options.login});
      const result = store.bootstrapIdentity({login: options.login, passwordHash, workspaceName: options.workspace});
      stdout.write(JSON.stringify({ok: true, userId: result.user.id, workspaceId: result.workspace.id}) + '\n');
    } else if (command === 'create-workspace') {
      const workspace = store.createWorkspace({name: options.workspace, ownerId: options['owner-id']});
      stdout.write(JSON.stringify({ok: true, workspaceId: workspace.id}) + '\n');
    } else if (command === 'issue-reset') {
      const output = options.output;
      if (!path.isAbsolute(output) || path.dirname(path.resolve(output)) !== root) throw new IdentityError('private_output_required', 400);
      const fd = fs.openSync(output, 'wx', 0o600);
      try {
        const reset = sessions.issuePasswordReset(options['user-id']);
        fs.writeFileSync(fd, JSON.stringify(reset) + '\n', 'utf8');
        fs.fsyncSync(fd);
      } catch (error) {
        fs.closeSync(fd); fs.unlinkSync(output); throw error;
      }
      fs.closeSync(fd);
      stdout.write(JSON.stringify({ok: true, output}) + '\n');
    } else {
      store.disableUser(options['user-id']);
      stdout.write(JSON.stringify({ok: true}) + '\n');
    }
    return 0;
  } catch (error) {
    const code = error instanceof IdentityError ? error.code : error.code === 'EEXIST' ? 'output_exists' : 'maintenance_failed';
    stderr.write(JSON.stringify({error: code}) + '\n');
    return 1;
  } finally {sessions?.close(); store?.close();}
}
if (require.main === module) runAccounts(process.argv.slice(2)).then(code => {process.exitCode = code;}, () => {process.exitCode = 1;});
module.exports = {runAccounts};
