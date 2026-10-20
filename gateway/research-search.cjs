'use strict';
const net = require('node:net');
const {isPublicAddress} = require('../integrations/mcp/webhook-transport.cjs');
const searchHosts = new Set(['duckduckgo.com', 'www.duckduckgo.com', 'html.duckduckgo.com', 'lite.duckduckgo.com']);
function host(url) { return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase(); }
function webUrl(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f]/.test(value)) return null;
  try {
    const url = base === undefined ? new URL(value) : new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}
// This is syntax/literal-address validation, not DNS or redirect SSRF protection.
function normalizeSearchResultUrl(value, baseUrl) {
  let url = webUrl(value, baseUrl);
  if (!url) return null;
  if (searchHosts.has(host(url))) {
    const targets = url.searchParams.getAll('uddg');
    if (!/^\/l\/?$/.test(url.pathname) || targets.length !== 1) return null;
    url = webUrl(targets[0]);
    if (!url || searchHosts.has(host(url))) return null;
  }
  const name = host(url);
  if (!name || name === 'localhost' || name.endsWith('.localhost') || name === 'local' || name.endsWith('.local')) return null;
  if (net.isIP(name) ? !isPublicAddress(name) : !name.includes('.')) return null;
  return url.href;
}
module.exports = {normalizeSearchResultUrl};
