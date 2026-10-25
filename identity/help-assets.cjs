'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Both URLs and disk components are constants. Request data never becomes a
// filesystem path, and this middleware does not mount a static directory.
const JAVASCRIPT = 'application/javascript; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const ASSETS = new Map([
  ['/identity/i18n.js', {parts: ['identity', 'i18n.js'], type: JAVASCRIPT}],
  ['/identity/display.js', {parts: ['identity', 'display.js'], type: JAVASCRIPT}],
  ['/identity/messages.js', {parts: ['identity', 'messages.js'], type: JAVASCRIPT}],
  ['/identity/chat-messages.js', {parts: ['identity', 'chat-messages.js'], type: JAVASCRIPT}],
  ['/identity/help.js', {parts: ['identity', 'help.js'], type: JAVASCRIPT}],
  ['/identity/help/zh-CN.md', {parts: ['identity', 'help', 'zh-CN.md'], type: TEXT}],
  ['/identity/help/en.md', {parts: ['identity', 'help', 'en.md'], type: TEXT}]
]);

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function reserved(urlPath) {
  if (urlPath === '/identity/help' || urlPath.startsWith('/identity/help/')) return true;
  for (const url of ASSETS.keys()) {
    if (urlPath === url || urlPath.startsWith(url + '/') || urlPath.startsWith(url + '#')) return true;
  }
  return false;
}

function assetRequest(urlPath) {
  if (reserved(urlPath)) return true;
  let decoded;
  try {decoded = decodeURIComponent(urlPath);} catch (_) {return /^\/identity(?:\/|$)/i.test(urlPath);}
  const slashes = decoded.replace(/\\/g, '/');
  if (reserved(slashes) || reserved(path.posix.normalize(slashes))) return true;
  // Noncanonical encoded/traversal identity paths are rejected, never rewritten
  // into an asset or forwarded to a more permissive static-file middleware.
  return /^\/identity(?:\/|$)/i.test(slashes) &&
    (urlPath.includes('%') || decoded.includes('\\') || slashes.split('/').includes('..'));
}

function secureHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function finish(req, res, status, text) {
  const body = Buffer.from(text, 'utf8');
  secureHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', TEXT);
  res.setHeader('Content-Length', String(body.length));
  if (status === 405) res.setHeader('Allow', 'GET, HEAD');
  res.end(req.method === 'HEAD' ? undefined : body);
}

function createDisplayAssetHandler({codeRoot} = {}) {
  let root, rootStat;
  try {
    if (typeof codeRoot !== 'string' || !codeRoot || !path.isAbsolute(codeRoot)) throw new Error();
    const candidate = path.resolve(codeRoot);
    rootStat = fs.lstatSync(candidate);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error();
    root = fs.realpathSync(candidate);
    // Preserve the caller's root path to detect replacement with a symlink.
    codeRoot = candidate;
  } catch (_) {throw new TypeError('invalid_display_asset_root');}

  function checkedFile(asset) {
    const currentRoot = fs.lstatSync(codeRoot);
    if (currentRoot.isSymbolicLink() || !currentRoot.isDirectory() ||
        currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino || fs.realpathSync(codeRoot) !== root) throw new Error();
    let target = root, stat;
    for (let index = 0; index < asset.parts.length; index++) {
      target = path.join(target, asset.parts[index]);
      if (!contained(root, target)) throw new Error();
      stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || (index === asset.parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error();
      if (!contained(root, fs.realpathSync(target))) throw new Error();
    }
    return {target, stat};
  }

  return function displayAssetHandler(req, res, next) {
    if (typeof req.url !== 'string') return next();
    const queryAt = req.url.indexOf('?');
    const urlPath = queryAt < 0 ? req.url : req.url.slice(0, queryAt);
    if (!assetRequest(urlPath)) return next();
    const asset = ASSETS.get(urlPath);
    if (!asset || queryAt >= 0) return finish(req, res, 404, 'Not found\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') return finish(req, res, 405, 'Method not allowed\n');
    let descriptor, body, length;
    try {
      const checked = checkedFile(asset);
      descriptor = fs.openSync(checked.target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== checked.stat.dev || opened.ino !== checked.stat.ino) throw new Error();
      // Check the complete directory chain again after opening the descriptor.
      // Reject replacements instead of following links introduced since lookup.
      const confirmed = checkedFile(asset);
      if (confirmed.stat.dev !== opened.dev || confirmed.stat.ino !== opened.ino) throw new Error();
      if (req.method === 'GET') body = fs.readFileSync(descriptor);
      length = body ? body.length : opened.size;
    } catch (_) {
      return finish(req, res, 404, 'Not found\n');
    } finally {
      if (descriptor !== undefined) {try {fs.closeSync(descriptor);} catch (_) {}}
    }
    secureHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', asset.type);
    res.setHeader('Content-Length', String(length));
    res.end(body);
  };
}

module.exports = {createDisplayAssetHandler};
