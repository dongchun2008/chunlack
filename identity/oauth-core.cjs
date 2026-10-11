'use strict';
const {randomBytes, randomUUID, createHash, timingSafeEqual} = require('node:crypto');
const OAuth = require('@node-oauth/oauth2-server');
const {authorize: requirePermission} = require('./policy.cjs');

const SCOPES = Object.freeze(['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe']);
const DAY = 86400000;
const AUTHORIZE_FIELDS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge',
  'code_challenge_method', 'state', 'scope', 'resource'];
const TOKEN_FIELDS = ['grant_type', 'client_id', 'client_secret', 'code', 'redirect_uri',
  'code_verifier', 'refresh_token', 'scope', 'resource'];
const digest = (kind, value) => createHash('sha256').update(`chunlack-oauth:${kind}\0`).update(value).digest('hex');
const credential = prefix => prefix + randomBytes(32).toString('base64url');
const reject = (code = 'invalid_grant', status = 400) => {
  const error = new Error(code); error.code = code; error.statusCode = status; throw error;
};

function fields(value, allowed) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject('invalid_request');
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.includes(key)) reject('invalid_request');
    if (item === undefined) continue;
    if (typeof item !== 'string' || item.length > 2048 || /[\x00-\x1f\x7f]/.test(item)) reject('invalid_request');
    result[key] = item;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 16384) reject('invalid_request');
  return result;
}

function httpsUrl(value, originOnly = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s*\\]/.test(value)) reject('invalid_configuration');
  let url;
  try {url = new URL(value);} catch {reject('invalid_configuration');}
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (originOnly ? url.origin !== value : url.href !== value)) reject('invalid_configuration');
  return url;
}

function scopes(value) {
  const result = typeof value === 'string' ? value.split(' ') : value;
  if (!Array.isArray(result) || !result.length || result.length > SCOPES.length ||
      new Set(result).size !== result.length || result.some(item => !SCOPES.includes(item))) reject('invalid_scope');
  return [...result];
}

// Internal service API, NOT an HTTP/consent endpoint. Callers must first prove
// a session-bound, CSRF-protected human consent transaction. Packaging/import
// creates no listeners, files or schema; identity-v1 databases are rejected.
function createOAuthCore({db, identity, resolveNode, issuer, resource, now = Date.now}) {
  httpsUrl(issuer, true);
  if (httpsUrl(resource).search) reject('invalid_configuration');
  if (typeof identity?.requireMembership !== 'function' || typeof resolveNode !== 'function' ||
      typeof now !== 'function') reject('invalid_configuration');
  const meta = db.prepare('SELECT * FROM oauth_meta WHERE id=1').get();
  if (!meta || meta.version !== 1) reject('unsupported_schema', 503);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()) reject('oauth_isolated_database_required', 503);
  if (meta.issuer !== null && (meta.issuer !== issuer || meta.resource !== resource)) reject('issuer_resource_mismatch', 503);
  db.prepare('UPDATE oauth_meta SET issuer=?,resource=? WHERE id=1 AND issuer IS NULL').run(issuer, resource);
  const clock = () => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0) reject('invalid_clock', 503);
    return time;
  };
  const clientRow = id => typeof id === 'string' ? db.prepare('SELECT * FROM oauth_clients WHERE id=?').get(id) : null;
  const clientView = row => ({id: row.id, grants: ['authorization_code', 'refresh_token'], redirectUris: JSON.parse(row.redirects)});
  const grantRow = id => db.prepare('SELECT * FROM oauth_grants WHERE id=?').get(id);
  const revoke = id => db.prepare('UPDATE oauth_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(clock(), id);
  function live(grant) {
    if (!grant || grant.revoked_at !== null || grant.expires_at <= clock()) reject();
    let actor, node;
    try {
      actor = identity.requireMembership(grant.user_id, grant.workspace_id);
      requirePermission(actor, 'node.manage');
      node = resolveNode(grant.node_id);
    } catch {reject();}
    if (actor?.then || actor.version !== grant.membership_version || node?.then || !node ||
        node.id !== grant.node_id || node.workspaceId !== grant.workspace_id || node.status !== 'active' ||
        !Array.isArray(node.capabilities) || !node.capabilities.includes('browser.public_read')) reject();
    return grant;
  }
  function ownedActor(actor) {
    if (!actor || typeof actor.userId !== 'string' || typeof actor.workspaceId !== 'string') reject('access_denied', 403);
    let current;
    try {current = identity.requireMembership(actor.userId, actor.workspaceId); requirePermission(current, 'node.manage');}
    catch {reject('access_denied', 403);}
    if (current?.then || current.version !== actor.version) reject('access_denied', 403);
    return current;
  }
  let pending = 0;
  const rates = new Map(); // Only fixed registered client IDs enter this map (<=32).
  async function bounded(clientId, operation, fn) {
    if (!clientRow(clientId)) reject('invalid_client');
    const time = clock(), key = `${clientId}:${operation}`;
    let rate = rates.get(key);
    if (!rate || time >= rate.until) {rate = {until: time + 60000, count: 0}; rates.set(key, rate);}
    if (pending >= 16 || rate.count >= (operation === 'authorize' ? 20 : 120)) reject('temporarily_unavailable', 429);
    rate.count++; pending++;
    try {return await fn();}
    catch (error) {
      const name = error instanceof OAuth.OAuthError ? error.name : error.code;
      const allowed = ['invalid_request', 'invalid_client', 'invalid_grant', 'invalid_scope', 'access_denied', 'temporarily_unavailable'];
      reject(allowed.includes(name) ? name : 'server_error', allowed.includes(name) ? (error.statusCode || 400) : 503);
    } finally {pending--;}
  }
  function modelFor({clientId, authorizing = false, grantId = null}) {
    let consumed = null;
    return {
      getClient(id, secret) {
        const row = clientRow(id);
        if (!row || id !== clientId) return null;
        if (!authorizing) {
          if (row.authentication === 'client_secret_post') {
            if (typeof secret !== 'string' || !timingSafeEqual(Buffer.from(digest('client', secret), 'hex'), Buffer.from(row.secret_hash, 'hex'))) return null;
          } else if (secret) return null;
        }
        return clientView(row);
      },
      generateAuthorizationCode: () => credential('cloc_'),
      generateAccessToken: () => credential('cloa_'),
      generateRefreshToken: () => credential('clor_'),
      validateScope(user, client, requested) {
        const grant = live(grantRow(user.grantId)), selected = scopes(requested);
        return grant.client_id === client.id && selected.every(s => JSON.parse(grant.scopes).includes(s)) ? selected : false;
      },
      saveAuthorizationCode(code, client, user) {
        const grant = live(grantRow(user.grantId));
        if (grant.id !== grantId || grant.client_id !== client.id || code.codeChallengeMethod !== 'S256') reject();
        const expiresAt = new Date(Math.min(clock() + 60000, grant.expires_at));
        db.prepare('INSERT INTO oauth_codes(digest,grant_id,redirect_uri,challenge,expires_at) VALUES(?,?,?,?,?)')
          .run(digest('code', code.authorizationCode), grant.id, code.redirectUri, code.codeChallenge, expiresAt.getTime());
        return {...code, expiresAt, client, user};
      },
      getAuthorizationCode(raw) {
        const row = db.prepare('SELECT * FROM oauth_codes WHERE digest=?').get(digest('code', raw));
        if (!row || row.used_at !== null || row.expires_at <= clock()) return null;
        const grant = live(grantRow(row.grant_id));
        if (grant.client_id !== clientId) return null;
        return {authorizationCode: raw, expiresAt: new Date(row.expires_at), redirectUri: row.redirect_uri,
          scope: JSON.parse(grant.scopes), codeChallenge: row.challenge, codeChallengeMethod: 'S256',
          client: clientView(clientRow(clientId)), user: {id: grant.user_id, grantId: grant.id}};
      },
      revokeAuthorizationCode(code) {
        const hash = digest('code', code.authorizationCode);
        const changed = db.prepare('UPDATE oauth_codes SET used_at=? WHERE digest=? AND used_at IS NULL AND expires_at>?')
          .run(clock(), hash, clock()).changes === 1;
        if (changed) consumed = {grantId: code.user.grantId, scope: code.scope};
        return changed;
      },
      getRefreshToken(raw) {
        const row = db.prepare("SELECT * FROM oauth_tokens WHERE digest=? AND kind='refresh'").get(digest('refresh', raw));
        if (!row) return null;
        const grant = grantRow(row.grant_id);
        // Check client before replay handling: another client cannot revoke it.
        if (!grant || grant.client_id !== clientId) return null;
        if (row.used_at !== null) {revoke(grant.id); return null;}
        live(grant);
        if (!grant.allow_refresh || row.expires_at <= clock()) return null;
        return {refreshToken: raw, refreshTokenExpiresAt: new Date(row.expires_at), scope: JSON.parse(row.scopes),
          client: clientView(clientRow(clientId)), user: {id: grant.user_id, grantId: grant.id}};
      },
      revokeToken(token) {
        const hash = digest('refresh', token.refreshToken);
        const changed = db.prepare("UPDATE oauth_tokens SET used_at=? WHERE digest=? AND kind='refresh' AND used_at IS NULL AND expires_at>?")
          .run(clock(), hash, clock()).changes === 1;
        if (!changed) {revoke(token.user.grantId); return false;}
        consumed = {grantId: token.user.grantId, scope: token.scope};
        return true;
      },
      saveToken(token, client, user) {
        if (!consumed || consumed.grantId !== user.grantId) reject();
        const ticket = consumed; consumed = null;
        return db.transaction(() => {
          const grant = live(grantRow(user.grantId)), selected = scopes(token.scope);
          if (grant.client_id !== client.id || !selected.every(s => ticket.scope.includes(s))) reject('invalid_scope');
          const refresh = grant.allow_refresh === 1;
          if (db.prepare('SELECT COUNT(*) AS n FROM oauth_tokens').get().n + (refresh ? 2 : 1) > 8192) reject('temporarily_unavailable', 429);
          const accessTokenExpiresAt = new Date(Math.min(clock() + 300000, grant.expires_at));
          const refreshTokenExpiresAt = new Date(Math.min(clock() + 7 * DAY, grant.expires_at));
          const insert = db.prepare('INSERT INTO oauth_tokens(digest,kind,grant_id,scopes,expires_at) VALUES(?,?,?,?,?)');
          insert.run(digest('access', token.accessToken), 'access', grant.id, JSON.stringify(selected), accessTokenExpiresAt.getTime());
          if (refresh) insert.run(digest('refresh', token.refreshToken), 'refresh', grant.id, JSON.stringify(selected), refreshTokenExpiresAt.getTime());
          return {accessToken: token.accessToken, accessTokenExpiresAt, scope: selected, client, user,
            ...(refresh ? {refreshToken: token.refreshToken, refreshTokenExpiresAt} : {})};
        }).immediate();
      }
    };
  }
  const engine = model => new OAuth({model, authorizationCodeLifetime: 60, accessTokenLifetime: 300,
    refreshTokenLifetime: 7 * 86400, allowEmptyState: false, enablePlainPKCE: false,
    allowExtendedTokenAttributes: false, alwaysIssueNewRefreshToken: true,
    requireClientAuthentication: {authorization_code: false, refresh_token: false}});

  return Object.freeze({
    registerClient({id, redirectUris, authentication}) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{3,128}$/.test(id) ||
          !['none', 'client_secret_post'].includes(authentication) || !Array.isArray(redirectUris) ||
          !redirectUris.length || redirectUris.length > 8 || new Set(redirectUris).size !== redirectUris.length) reject('invalid_client');
      for (const uri of redirectUris) httpsUrl(uri);
      return db.transaction(() => {
        if (clientRow(id) || db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get().n >= 32) reject('invalid_client');
        const secret = authentication === 'none' ? null : credential('clocs_');
        db.prepare('INSERT INTO oauth_clients(id,authentication,secret_hash,redirects) VALUES(?,?,?,?)')
          .run(id, authentication, secret ? digest('client', secret) : null, JSON.stringify(redirectUris));
        return Object.freeze({id, ...(secret ? {secret} : {})});
      }).immediate();
    },
    async authorize({actor, nodeId, query, allowRefresh = false}) {
      const q = fields(query, AUTHORIZE_FIELDS), requested = scopes(q.scope);
      if (q.response_type !== 'code' || q.resource !== resource || q.code_challenge_method !== 'S256' ||
          !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge || '') || !q.state || q.state.length > 512 ||
          typeof nodeId !== 'string' || nodeId.length > 128 || typeof allowRefresh !== 'boolean') reject('invalid_request');
      const row = clientRow(q.client_id);
      if (!row || !JSON.parse(row.redirects).includes(q.redirect_uri)) reject('invalid_client');
      const current = ownedActor(actor);
      return bounded(row.id, 'authorize', async () => {
        const grant = db.transaction(() => {
          if (db.prepare('SELECT COUNT(*) AS n FROM oauth_grants').get().n >= 1024 ||
              db.prepare('SELECT COUNT(*) AS n FROM oauth_grants WHERE workspace_id=?').get(current.workspaceId).n >= 128 ||
              db.prepare('SELECT COUNT(*) AS n FROM oauth_codes WHERE used_at IS NULL AND expires_at>?').get(clock()).n >= 256) reject('temporarily_unavailable', 429);
          const value = {id: randomUUID(), client_id: row.id, user_id: current.userId,
            workspace_id: current.workspaceId, membership_version: current.version, node_id: nodeId,
            scopes: JSON.stringify(requested), allow_refresh: allowRefresh ? 1 : 0,
            created_at: clock(), expires_at: clock() + 30 * DAY, revoked_at: null};
          live(value);
          db.prepare(`INSERT INTO oauth_grants(id,client_id,user_id,workspace_id,membership_version,node_id,scopes,allow_refresh,created_at,expires_at)
            VALUES(@id,@client_id,@user_id,@workspace_id,@membership_version,@node_id,@scopes,@allow_refresh,@created_at,@expires_at)`).run(value);
          return value;
        }).immediate();
        try {
          const response = new OAuth.Response();
          const result = await engine(modelFor({clientId: row.id, authorizing: true, grantId: grant.id})).authorize(
            new OAuth.Request({method: 'GET', headers: {}, query: q}), response,
            {authenticateHandler: {handle: () => ({id: current.userId, grantId: grant.id})}});
          const location = new URL(q.redirect_uri);
          location.searchParams.set('code', result.authorizationCode);
          location.searchParams.set('state', q.state);
          location.searchParams.set('iss', issuer);
          return {code: result.authorizationCode, location: location.href, grantId: grant.id};
        } catch (error) {revoke(grant.id); throw error;}
      });
    },
    async exchange(body) {
      const b = fields(body, TOKEN_FIELDS);
      if (!['authorization_code', 'refresh_token'].includes(b.grant_type) || b.resource !== resource) reject('invalid_request');
      if (b.grant_type === 'authorization_code' && (!/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier || '') ||
          !/^cloc_[A-Za-z0-9_-]{43}$/.test(b.code || '') || !b.redirect_uri || b.refresh_token)) reject('invalid_request');
      if (b.grant_type === 'refresh_token' && (!/^clor_[A-Za-z0-9_-]{43}$/.test(b.refresh_token || '') ||
          b.code || b.code_verifier || b.redirect_uri)) reject('invalid_request');
      if (b.scope !== undefined) scopes(b.scope);
      return bounded(b.client_id, 'token', async () => {
        const response = new OAuth.Response();
        const token = await engine(modelFor({clientId: b.client_id})).token(new OAuth.Request({method: 'POST', query: {}, body: b,
          headers: {'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(new URLSearchParams(b).toString()))}}), response);
        // The injected clock belongs to persistence; never advertise lifetime
        // beyond the actual stored cap, even if the protocol engine uses wall time.
        return {...response.body, expires_in: Math.max(0, Math.floor((token.accessTokenExpiresAt.getTime() - clock()) / 1000))};
      });
    },
    verify(raw, {resource: audience, scope}) {
      if (audience !== resource || !SCOPES.includes(scope) || typeof raw !== 'string' || !/^cloa_[A-Za-z0-9_-]{43}$/.test(raw)) reject('invalid_token', 401);
      try {
        const token = db.prepare("SELECT * FROM oauth_tokens WHERE digest=? AND kind='access'").get(digest('access', raw));
        if (!token || token.expires_at <= clock() || !JSON.parse(token.scopes).includes(scope)) reject();
        const grant = live(grantRow(token.grant_id));
        return Object.freeze({grantId: grant.id, userId: grant.user_id, workspaceId: grant.workspace_id,
          membershipVersion: grant.membership_version, nodeId: grant.node_id, clientId: grant.client_id,
          taskTypes: Object.freeze(['browser.public_read']), scopes: Object.freeze(JSON.parse(token.scopes))});
      } catch {reject('invalid_token', 401);}
    },
    revokeGrant(actor, id) {
      const current = ownedActor(actor), grant = typeof id === 'string' ? grantRow(id) : null;
      if (!grant || grant.workspace_id !== current.workspaceId) reject('access_denied', 403);
      revoke(id);
      return {revoked: true};
    },
    // Restore operator must call BEFORE opening ingress; never a public route.
    invalidateAll() {return db.prepare('UPDATE oauth_grants SET revoked_at=? WHERE revoked_at IS NULL').run(clock()).changes;},
    pruneExpired(limit = 128) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) reject('invalid_request');
      return db.transaction(() => {
        const result = {};
        result.grants = db.prepare('DELETE FROM oauth_grants WHERE id IN (SELECT id FROM oauth_grants WHERE expires_at<=? LIMIT ?)').run(clock(), limit).changes;
        result.codes = db.prepare('DELETE FROM oauth_codes WHERE digest IN (SELECT digest FROM oauth_codes WHERE expires_at<=? LIMIT ?)').run(clock(), limit).changes;
        result.access = db.prepare("DELETE FROM oauth_tokens WHERE digest IN (SELECT digest FROM oauth_tokens WHERE kind='access' AND expires_at<=? LIMIT ?)").run(clock(), limit).changes;
        return result;
      }).immediate();
    }
  });
}

module.exports = {createOAuthCore, SCOPES};
