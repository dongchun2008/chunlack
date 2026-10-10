(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, 'ChunLackWorkspace', {value: Object.freeze(api)});
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const workspaceKey = 'chunlack.workspaceId';
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
  function error(code, status = 400) {return Object.assign(new Error(code), {code, status});}
  function safeReturnPath(value, origin) {
    try {
      const url = new URL(value, origin);
      if (url.origin === origin && !url.username && !url.password && !url.search && !url.hash && ['/', '/login'].includes(url.pathname)) return url.pathname;
    } catch {}
    return '/';
  }
  function createWorkspaceClient({fetch: fetchRequest, storage, legacyStorage, WebSocket: Socket, location,
    onReset = () => {}, onIdentity = () => {}, onWorkspace = () => {}, onError = () => {}, onReconnect = () => {},
    clock = {setTimeout, clearTimeout, now: Date.now}}) {
    if (typeof fetchRequest !== 'function' || typeof Socket !== 'function' || !location || new URL(location.origin).protocol !== 'https:') throw error('invalid_client_configuration');
    let status = 'initializing', user = null, csrf = '', workspaces = [], workspace = null, generation = 0, closed = false;
    let controller = new AbortController(), socket = null, retryTimer = null, retryCount = 0, retryWindow = clock.now(), pendingLogoutCsrf = '';
    const saved = key => {try {return storage?.getItem(key);} catch {return null;}};
    const save = value => {try {value === null ? storage?.removeItem(workspaceKey) : storage?.setItem(workspaceKey, value);} catch { /* selection can remain in this tab's memory */ }};
    function clearOwnedStorage(target) {
      if (!target) return;
      try {for (let i = target.length - 1; i >= 0; i--) {const key = target.key(i); if (key && /^(lack_|chunlack\.)/.test(key) && ![workspaceKey, 'lack_theme'].includes(key)) target.removeItem(key);}} catch {}
    }
    clearOwnedStorage(storage); clearOwnedStorage(legacyStorage);
    function snapshot() {return Object.freeze({status, user, workspace, workspaces: Object.freeze([...workspaces]), generation});}
    function publish() {onIdentity(snapshot());}
    function reset(reason, {forget = true} = {}) {
      generation++; controller.abort(error('workspace_changed', 409)); controller = new AbortController();
      if (retryTimer !== null) {clock.clearTimeout(retryTimer); retryTimer = null;}
      const previous = socket; socket = null; previous?.close();
      workspace = null; if (forget) save(null); onReset(reason);
    }
    function urlFor(value) {
      let url; try {url = new URL(value, location.origin);} catch {throw error('unsafe_url');}
      if (url.origin !== location.origin || url.username || url.password || url.hash || !/^\/(api|auth)\//.test(url.pathname) || (url.pathname.startsWith('/auth/') && url.search)) throw error('unsafe_url');
      return url;
    }
    const codeFor = (body, fallback) => typeof body?.error === 'string' && /^[a-z_]{1,64}$/.test(body.error) ? body.error : fallback;
    async function plain(path, {method = 'GET', body, csrfToken, signal} = {}) {
      const headers = new Headers(); if (body !== undefined) headers.set('Content-Type', 'application/json');
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
      let response;
      try {response = await fetchRequest(urlFor(path).href, {method, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body), signal});}
      catch (cause) {if (signal?.aborted) throw signal.reason; throw error('request_failed', 503);}
      let result; try {result = await response.json();} catch {throw error('invalid_response', 503);}
      if (!response.ok) throw error(codeFor(result, response.status === 401 ? 'unauthorized' : 'service_unavailable'), response.status);
      return result;
    }
    function normalizeIdentity(result) {
      if (!identifier(result?.user?.id) || typeof result.user.login !== 'string' || result.user.login.length > 256 || typeof result.csrfToken !== 'string' || !result.csrfToken || result.csrfToken.length > 256) throw error('invalid_response', 503);
      user = Object.freeze({id: result.user.id, login: result.user.login}); csrf = result.csrfToken;
    }
    function normalizeWorkspaces(result) {
      if (!Array.isArray(result?.workspaces) || result.workspaces.length > 100) throw error('invalid_response', 503);
      const normalized = result.workspaces.map(item => {
        const id = item.id || item.workspaceId;
        if (!identifier(id) || typeof item.name !== 'string' || item.name.length > 256 || !['owner', 'member', 'viewer'].includes(item.role)) throw error('invalid_response', 503);
        return Object.freeze({id, name: item.name, role: item.role});
      });
      if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw error('invalid_response', 503);
      workspaces = normalized;
    }
    async function loadIdentity(epoch) {
      const me = await plain('/auth/me', {signal: controller.signal}); if (epoch !== generation || closed) throw error('workspace_changed', 409);
      normalizeIdentity(me);
      const list = await plain('/api/workspaces', {signal: controller.signal}); if (epoch !== generation || closed) throw error('workspace_changed', 409);
      normalizeWorkspaces(list);
    }
    async function boot() {
      if (closed) throw error('client_closed', 503);
      if (status === 'logout_pending') throw error('logout_not_confirmed', 503);
      const remembered = saved(workspaceKey); reset('bootstrap', {forget: false}); user = null; csrf = ''; workspaces = []; status = 'initializing'; publish();
      const epoch = generation;
      try {
        await loadIdentity(epoch); status = workspaces.length ? 'selection' : 'no_access'; publish();
        if (workspaces.length) await selectWorkspace(workspaces.some(item => item.id === remembered) ? remembered : workspaces[0].id);
      } catch (cause) {
        if (epoch !== generation || closed) throw cause;
        user = null; csrf = ''; workspaces = []; save(null); status = cause.status === 401 ? 'login' : 'unavailable'; publish();
        if (cause.status !== 401) onError(cause);
      }
      return snapshot();
    }
    async function selectWorkspace(id) {
      if (closed) throw error('client_closed', 503);
      const selected = workspaces.find(item => item.id === id); if (!user || !selected) throw error('workspace_not_found', 404);
      if (workspace?.id === id && status === 'ready') return snapshot();
      reset('workspace_changed'); workspace = selected; save(id); status = 'ready'; publish(); onWorkspace(selected); return snapshot();
    }
    async function login(login, password) {
      if (closed) throw error('client_closed', 503);
      if (status === 'logout_pending') throw error('logout_not_confirmed', 503);
      reset('login'); user = null; csrf = ''; workspaces = []; status = 'login'; publish();
      const epoch = generation;
      await plain('/auth/login', {method: 'POST', body: {login, password}, signal: controller.signal});
      if (closed || epoch !== generation) throw error('workspace_changed', 409);
      return boot();
    }
    async function acceptInvite(token, password) {
      if (closed) throw error('client_closed', 503);
      if (status === 'logout_pending') throw error('logout_not_confirmed', 503);
      const epoch = generation, currentUser = user;
      const body = currentUser ? {token} : {token, password};
      const result = await plain('/auth/invites/accept', {method: 'POST', body, csrfToken: currentUser ? csrf : undefined, signal: controller.signal});
      if (closed || epoch !== generation) throw error('workspace_changed', 409);
      if (!identifier(result?.user?.id) || typeof result.user.login !== 'string') throw error('invalid_response', 503);
      if (currentUser) {
        if (result.user.id !== currentUser.id) throw error('invalid_response', 503);
        return boot();
      }
      return login(result.user.login, password);
    }
    async function recover(statusCode) {
      reset(statusCode === 401 ? 'unauthorized' : 'permission_changed');
      if (statusCode === 401) {user = null; csrf = ''; workspaces = []; status = 'login'; publish(); return;}
      const epoch = generation;
      try {await loadIdentity(epoch); status = workspaces.length ? 'selection' : 'no_access';}
      catch (cause) {if (epoch !== generation || closed) return; user = null; csrf = ''; workspaces = []; status = cause.status === 401 ? 'login' : 'unavailable';}
      if (!closed && epoch === generation) publish();
    }
    async function scopedFetch(path, options = {}) {
      if (closed) throw error('client_closed', 503);
      const url = urlFor(path), unscoped = url.pathname.startsWith('/auth/') || url.pathname === '/api/workspaces';
      if (!unscoped && (status !== 'ready' || !workspace)) throw error('workspace_required', 401);
      const epoch = generation, selected = workspace, signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
      const headers = new Headers(options.headers); headers.delete('Authorization'); headers.delete('Cookie'); headers.delete('X-CSRF-Token'); headers.delete('X-Workspace-Id');
      if (!unscoped) headers.set('X-Workspace-Id', selected.id);
      const method = (options.method || 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method)) {
        if (!csrf) throw error('unauthorized', 401); headers.set('X-CSRF-Token', csrf);
        if (options.body !== undefined) headers.set('Content-Type', 'application/json');
      }
      let response;
      try {response = await fetchRequest(url.href, {...options, method, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal});}
      catch (cause) {if (epoch !== generation) throw error('workspace_changed', 409); if (signal.aborted) throw signal.reason; throw error('request_failed', 503);}
      const fresh = () => {if (closed || epoch !== generation || (!unscoped && workspace?.id !== selected.id)) throw error('workspace_changed', 409);};
      fresh();
      if (!response.ok) {
        let body; try {body = await response.json();} catch {} fresh();
        const failure = error(codeFor(body, response.status === 401 ? 'unauthorized' : 'service_unavailable'), response.status);
        if (response.status === 401 || response.status === 403) await recover(response.status);
        onError(failure); throw failure;
      }
      const consume = async method => {fresh(); const value = await response[method](); fresh(); return value;};
      return Object.freeze({status: response.status, ok: response.ok, headers: response.headers, json: () => consume('json'), text: () => consume('text')});
    }
    async function request(path, {method = 'GET', body} = {}) {return (await scopedFetch(path, {method, body: body === undefined ? undefined : JSON.stringify(body)})).json();}
    async function logout() {
      pendingLogoutCsrf = csrf || pendingLogoutCsrf;
      reset('logout'); user = null; csrf = ''; workspaces = []; status = 'logout_pending'; publish();
      try {await plain('/auth/logout', {method: 'POST', body: {}, csrfToken: pendingLogoutCsrf}); pendingLogoutCsrf = ''; status = 'login'; publish();}
      catch (cause) {
        if (cause.status === 401) {pendingLogoutCsrf = ''; status = 'login'; publish(); return;}
        onError(error('logout_not_confirmed', 503)); throw error('logout_not_confirmed', 503);
      }
    }
    function can(action, createdBy = null) {
      if (status !== 'ready' || !workspace) return false;
      if (action === 'read') return true;
      if (action === 'execute') return workspace.role !== 'viewer';
      if (action === 'manage') return workspace.role === 'owner';
      if (action === 'cancel') return workspace.role === 'owner' || (workspace.role === 'member' && createdBy === user.id);
      return false;
    }
    function createSocket() {
      if (closed || status !== 'ready' || !workspace) throw error('workspace_required', 401);
      const epoch = generation, selected = workspace;
      const previous = socket; socket = null; previous?.close();
      const raw = new Socket('wss://' + location.host + '/ws/workspaces/' + encodeURIComponent(selected.id));
      const facade = {onopen: null, onmessage: null, onclose: null,
        get readyState() {return raw.readyState;},
        send(value) {if (!fresh()) throw error('workspace_changed', 409); if (raw.readyState !== 1) throw error('socket_not_ready', 409); raw.send(value);},
        close() {raw.close(1000);}};
      const fresh = () => !closed && epoch === generation && workspace?.id === selected.id && socket === facade;
      socket = facade;
      raw.onopen = event => {if (fresh()) facade.onopen?.(event);};
      raw.onmessage = event => {
        if (!fresh()) return;
        if (typeof event.data !== 'string' || event.data.length > 65536) {raw.close(1009); return;}
        try {const frame = JSON.parse(event.data); if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw error('invalid_frame');}
        catch {raw.close(1009); return;}
        facade.onmessage?.(event);
      };
      raw.onclose = event => {
        if (!fresh()) return; facade.onclose?.(event);
        if (event.code === 1008 || event.code === 1009) {void recover(403); return;}
        if (event.code === 1000) return;
        if (clock.now() - retryWindow >= 60000) {retryWindow = clock.now(); retryCount = 0;}
        if (++retryCount > 3) {reset('connection_unavailable'); status = 'selection'; publish(); onError(error('connection_unavailable', 503)); return;}
        retryTimer = clock.setTimeout(async () => {
          retryTimer = null; if (!fresh()) return;
          try {
            await loadIdentity(epoch); if (!fresh()) return;
            if (!workspaces.some(item => item.id === selected.id && item.role === selected.role)) {await recover(403); return;}
            onReconnect();
          } catch (cause) {if (fresh()) await recover(cause.status === 401 ? 401 : 403);}
        }, Math.min(6000, retryCount * 1500));
      };
      raw.onerror = () => {}; // close drives the one bounded reconnection path.
      return facade;
    }
    function close() {if (closed) return; closed = true; reset('closed', {forget: false}); user = null; csrf = ''; workspaces = []; pendingLogoutCsrf = ''; status = 'closed';}
    return Object.freeze({boot, login, acceptInvite, logout, selectWorkspace, fetch: scopedFetch, request, createSocket, can, snapshot, close});
  }
  return {createWorkspaceClient, safeReturnPath};
});
