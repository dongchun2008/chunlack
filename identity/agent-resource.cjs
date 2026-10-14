'use strict';
const operations = Object.freeze(['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe']);
const failure = code => Object.assign(new Error(code), {code});

// Public metadata only. This module neither creates clients nor grants authority.
function createAgentResource(config) {
  if (config?.enabled !== true) return null;
  let issuer, resource;
  try {
    issuer = new URL(config.issuer); resource = new URL(config.resource);
    if (issuer.protocol !== 'https:' || issuer.origin !== config.issuer ||
        resource.protocol !== 'https:' || resource.href !== config.resource ||
        resource.username || resource.password || resource.search || resource.hash ||
        resource.pathname !== '/mcp') throw Error();
  } catch {throw failure('invalid_agent_resource_config');}
  const paths = Object.freeze(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']);
  const metadataUrl = resource.origin + paths[0];
  const metadata = Object.freeze({resource: resource.href,
    authorization_servers: Object.freeze([issuer.origin]),
    bearer_methods_supported: Object.freeze(['header']),
    scopes_supported: Object.freeze(['openid', ...operations])});
  function challenge({scope = 'task.read', error} = {}) {
    if (!operations.includes(scope) || error !== undefined && !['invalid_token', 'insufficient_scope'].includes(error)) {
      throw failure('invalid_agent_resource_challenge');
    }
    return 'Bearer resource_metadata="' + metadataUrl + '", scope="openid ' + scope + '"' +
      (error ? ', error="' + error + '"' : '');
  }
  return Object.freeze({metadata, metadataUrl, paths, challenge});
}
module.exports = {createAgentResource};
