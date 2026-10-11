'use strict';
const {IdentityError} = require('./policy.cjs');
const {readSessionCookie} = require('./sessions.cjs');
const cookieName = '__Host-chunlack_oidc';
const cookieOptions = {secure: true, httpOnly: true, sameSite: 'lax', path: '/'};
function browserCookie(header, optional = false) {
  if (optional && (header === undefined || header === null)) return null;
  if (typeof header !== 'string' || header.length > 8192) throw new IdentityError('unauthorized', 401);
  const values = header.split(';').map(p => p.trim()).filter(p => p.startsWith(cookieName + '='));
  if (optional && !values.length) return null;
  if (values.length !== 1) throw new IdentityError('unauthorized', 401);
  const value = values[0].slice(cookieName.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new IdentityError('unauthorized', 401);
  return value;
}
function mountOidcRoutes({router, oidc, sessions, webOrigin, mutation, json, wrap}) {
  // The local recovery login remains separate, not an automatic failure fallback.
  router.get('/auth/oidc/login', (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>ChunLACK SSO</title><h1>ChunLACK SSO</h1>' +
      (oidc ? '<button id="start" type="button">Continue to identity provider</button><p id="status"></p><script src="/auth/oidc/login-script"></script>' : '<p>Single sign-on is not configured. Contact the administrator.</p>') + '<a href="/login">Back to login</a></html>');
  });
  if (!oidc) return;
  router.get('/auth/oidc/login-script', (req, res) => res.type('application/javascript').send(`'use strict';document.getElementById('start').onclick=async function(){this.disabled=true;try{const r=await fetch('/auth/oidc/begin',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin'});if(!r.ok)throw Error();const b=await r.json();window.location.assign(b.url);}catch{document.getElementById('status').textContent='Sign-in unavailable. Please return and retry.';this.disabled=false;}};`));
  function rejectActiveSession(req) {
    const token = readSessionCookie(req.headers.cookie);
    if (!token) return;
    try {sessions.authenticate(token);} catch (error) {if (error.code === 'unauthorized') return; throw error;}
    throw new IdentityError('logout_before_identity_switch', 409);
  }
  router.post('/auth/oidc/begin', mutation, json, wrap(async (req, res) => {
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length) throw new IdentityError('invalid_request', 400);
    rejectActiveSession(req);
    const result = await oidc.begin({source: req.socket.remoteAddress || 'local', browserToken: browserCookie(req.headers.cookie, true)});
    res.cookie(cookieName, result.browserToken, {...cookieOptions, maxAge: 12 * 60 * 60 * 1000});
    res.json({url: result.url});
  }));
  router.get('/auth/oidc/callback', wrap(async (req, res) => {
    rejectActiveSession(req);
    const browserToken = browserCookie(req.headers.cookie);
    const proof = await oidc.finish({url: new URL(req.originalUrl, webOrigin), browserToken});
    const auth = sessions.loginOidc({proof});
    sessions.browserAuthenticationChanged(browserToken, auth.sessionId);
    res.cookie('__Host-chunlack_session', auth.token, {...cookieOptions, maxAge: 12 * 60 * 60 * 1000});
    res.redirect(303, '/');
  }));
}
module.exports = {mountOidcRoutes, browserCookie};
