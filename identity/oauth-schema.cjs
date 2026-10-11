'use strict';

const oauthTableScopes = Object.freeze({oauth_meta: 'platform', oauth_clients: 'platform',
  oauth_grants: 'workspace', oauth_codes: 'workspace', oauth_tokens: 'workspace'});

// Deliberately NOT a production identity migration. The public runtime does
// not invoke this installer. A later reviewed schema/inventory upgrade must
// integrate these tables before mounting the OAuth routes.
function installIsolatedOAuthSchema(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all().map(row => row.name);
  if (tables.some(name => !Object.hasOwn(oauthTableScopes, name))) throw new Error('oauth_isolated_database_required');
  if (tables.includes('oauth_meta')) {
    const rows = db.prepare('SELECT version FROM oauth_meta').all();
    if (rows.length !== 1 || rows[0].version !== 1) throw new Error('oauth_unsupported_schema');
    if (tables.length !== Object.keys(oauthTableScopes).length) throw new Error('oauth_incomplete_schema');
    return;
  }
  if (tables.length) throw new Error('oauth_incomplete_schema');
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE oauth_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL,
        issuer TEXT, resource TEXT);
      INSERT INTO oauth_meta(id,version) VALUES(1,1);
      CREATE TABLE oauth_clients (id TEXT PRIMARY KEY, authentication TEXT NOT NULL,
        secret_hash TEXT, redirects TEXT NOT NULL);
      CREATE TABLE oauth_grants (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES oauth_clients(id),
        user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, membership_version INTEGER NOT NULL,
        node_id TEXT NOT NULL, scopes TEXT NOT NULL, allow_refresh INTEGER NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE INDEX oauth_grant_workspace ON oauth_grants(workspace_id,revoked_at,expires_at);
      CREATE INDEX oauth_grant_expiry ON oauth_grants(expires_at);
      CREATE TABLE oauth_codes (digest TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
        redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE INDEX oauth_code_expiry ON oauth_codes(expires_at);
      CREATE INDEX oauth_code_grant ON oauth_codes(grant_id);
      CREATE TABLE oauth_tokens (digest TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
        grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE, scopes TEXT NOT NULL,
        expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE INDEX oauth_token_expiry ON oauth_tokens(kind,expires_at);
      CREATE INDEX oauth_token_grant ON oauth_tokens(grant_id);
    `);
  }).immediate();
}

module.exports = {installIsolatedOAuthSchema, oauthTableScopes};
