'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
function fail(code) {throw Object.assign(new Error(code), {code});}
function hostname(value) {
  let url; try {url = new URL(value);} catch {fail('ingress_invalid_origin');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || net.isIP(url.hostname) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname)) fail('ingress_invalid_origin');
  return url.hostname;
}
function port(value) {if (!Number.isInteger(value) || value < 1024 || value > 65535) fail('ingress_invalid_port'); return value;}
function renderPublicIngress(config, {fixture} = {}) {
  const web = hostname(config?.publicRuntime?.webOrigin), agents = hostname(config?.publicRuntime?.agentsOrigin);
  const webPort = port(config?.httpPort), gatewayPort = port(config?.agentGateway?.port), mcpPort = port(config?.publicRuntime?.mcpPort);
  if (web === agents || new Set([webPort, gatewayPort, mcpPort]).size !== 3) fail('ingress_conflicting_routes');
  let publicPort = 443, bind = '', tls = 'tls {\n        issuer acme {\n            disable_http_challenge\n        }\n    }';
  // Only in-process tests can supply a local certificate and a loopback port.
  // The CLI has no fixture flag and never emits an insecure TLS configuration.
  if (fixture !== undefined) {
    if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture) || Object.keys(fixture).some(key => !['listenPort', 'certFile', 'keyFile'].includes(key))) fail('ingress_invalid_fixture');
    publicPort = port(fixture.listenPort);
    if ([webPort, gatewayPort, mcpPort].includes(publicPort)) fail('ingress_conflicting_routes');
    for (const file of [fixture.certFile, fixture.keyFile]) if (typeof file !== 'string' || !path.isAbsolute(file) || /[\r\n\0]/.test(file)) fail('ingress_invalid_certificate_path');
    bind = 'default_bind 127.0.0.1';
    tls = 'tls ' + JSON.stringify(fixture.certFile.replace(/\\/g, '/')) + ' ' + JSON.stringify(fixture.keyFile.replace(/\\/g, '/'));
  }
  const values = {WEB_HOST: web, AGENTS_HOST: agents, WEB_PORT: webPort, GATEWAY_PORT: gatewayPort, MCP_PORT: mcpPort, PUBLIC_PORT: publicPort, BIND: bind, TLS: tls};
  return fs.readFileSync(path.join(__dirname, 'Caddyfile.template'), 'utf8').replace(/@@([A-Z_]+)@@/g, (_, name) => {
    if (!Object.hasOwn(values, name)) fail('ingress_unknown_template_field'); return String(values[name]);
  });
}
module.exports = {renderPublicIngress};
if (require.main === module) {
  try {
    const [input, output, ...extra] = process.argv.slice(2);
    if (extra.length || !input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) fail('ingress_absolute_paths_required');
    const result = renderPublicIngress(JSON.parse(fs.readFileSync(input, 'utf8')));
    fs.writeFileSync(output, result, {flag: 'wx', mode: 0o600});
    process.stdout.write('INGRESS_CANDIDATE_RENDERED_NOT_ACTIVATED\n');
  } catch (error) {console.error(/^ingress_[a-z_]+$/.test(error.code || '') ? error.code : 'ingress_render_failed'); process.exitCode = 1;}
}
