(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else if (!Object.prototype.hasOwnProperty.call(root, 'ChunLackHelp')) {
    Object.defineProperty(root, 'ChunLackHelp', {value: factory(root)});
  }
})(typeof globalThis === 'object' ? globalThis : this, function(root) {
  'use strict';
  const translations = {
    'Workspace help': '工作区帮助',
    'Legacy help': '旧版模式帮助',
    'Sign-in help': '登录帮助',
    'Close help': '关闭帮助',
    'This help is private. It never sends channel messages or invokes a model or tool.': '这是私有帮助，不发送频道消息，也不调用模型或工具。',
    'Sign in with Pocket ID using your own account. Follow the sign-in page to complete authentication.': '请使用本人的 Pocket ID 账号登录，并按照登录页面的指引完成身份验证。',
    'After signing in, an existing membership or an approved invitation is required to enter a workspace. Contact its owner if you need access.': '登录后，仍需已有成员身份或获批邀请才能进入工作区。如需访问，请联系工作区所有者。',
    'Signing in does not grant Events or Agent permissions.': '登录不会自动授予 Events 或 Agent 权限。',
    'Commands are described here for reference. This panel never executes commands.': '以下命令仅作使用说明，本面板不会执行命令。',
    'Every request remains subject to actual workspace membership and permissions, and to server policy.': '所有请求仍须符合实际工作区成员身份、权限和服务端策略。',
    'Public multi-user mode does not expose /bash, /pull, host files, cron, or reset paths.': '公开多用户模式不开放 /bash、/pull、主机文件、cron 或 reset 路径。',
    'Changing the interface language does not translate user messages, model output, or evidence, and does not grant Events or Agent permissions.': '切换界面语言不会翻译用户消息、模型输出或证据，也不会自动授予 Events 或 Agent 权限。',
    'Address an Agent by its existing name; access and model use still require permission.': '使用现有名称提及 Agent；访问和模型使用仍需相应权限。',
    'Open private local help without broadcasting a channel message.': '打开本地私有帮助，不向频道广播消息。',
    'Open the existing form to create an Agent, subject to your permissions.': '打开现有的 Agent 创建表单，能否创建取决于你的权限。',
    'Request collaboration or review; this may incur additional model costs.': '请求协作或复核，可能产生额外的模型调用费用。',
    'Request research on the supplied topic, within the configured task and access limits.': '针对给定主题请求研究，受已配置的任务及访问限制约束。',
    'Request cancellation of the relevant work; this is not a global emergency stop.': '请求取消相关工作；这不是全局紧急停止。',
    'Inspect the existing tree view where server policy permits it.': '在服务端策略允许的情况下查看现有树状视图。',
    'Inspect the existing graph view where server policy permits it.': '在服务端策略允许的情况下查看现有关系图视图。',
    'Complete user guide': '完整使用手册',
    'Loading the guide...': '正在加载使用手册……',
    'Unable to load the guide. Please try again later.': '无法加载使用手册，请稍后重试。'
  };
  const english = Object.fromEntries(Object.keys(translations).map(id => [id, id]));
  const catalogs = Object.freeze({'zh-CN': Object.freeze(translations), en: Object.freeze(english)});
  const GUIDE_PATHS = Object.freeze({'zh-CN': '/identity/help/zh-CN.md', en: '/identity/help/en.md'});
  const LIMIT = 256 * 1024;
  const STYLE = '.chunlack-help-backdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:clamp(8px,3vw,28px);background:rgba(20,34,12,.66);box-sizing:border-box}.chunlack-help-dialog{box-sizing:border-box;width:100%;max-width:820px;max-height:90vh;max-height:90dvh;overflow:auto;overscroll-behavior:contain;background:var(--avocado-surface,#f5f4df);color:var(--avocado-ink,#24351b);border:1px solid var(--avocado-border,#9ba96d);border-radius:18px;box-shadow:0 18px 70px #10200866;padding:clamp(16px,4vw,30px);font-family:inherit;line-height:1.6;overflow-wrap:anywhere}.chunlack-help-dialog h2{margin:0;font-size:1.45rem}.chunlack-help-header{display:flex;align-items:center;justify-content:space-between;gap:16px}.chunlack-help-close{font:inherit;flex-shrink:0;color:#fff;background:var(--avocado-accent,#526d2e);border:1px solid #425a25;border-radius:9px;padding:7px 12px;cursor:pointer}.chunlack-help-close:focus-visible{outline:3px solid #9b6b17;outline-offset:3px}.chunlack-help-dialog dt{font-weight:bold;margin-top:12px}.chunlack-help-dialog dd{margin:3px 0 0}.chunlack-help-guide{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.7;border-top:1px solid #acb68c;padding-top:16px}.chunlack-help-status{color:#5b663c}@media(max-width:480px){.chunlack-help-dialog{border-radius:12px;max-height:94vh;max-height:94dvh}.chunlack-help-header{align-items:flex-start}}';
  let nextId = 0;

  function createHelp(options = {}) {
    const document = options.document, i18n = options.i18n, fetch = options.fetch;
    if (!i18n || !['ui', 'getLocale', 'subscribe', 'createView'].every(name => typeof i18n[name] === 'function')) {
      throw new TypeError('help_controller_required');
    }
    if (!document || typeof document.createElement !== 'function' || !document.body || !document.head ||
        typeof document.addEventListener !== 'function' || typeof document.removeEventListener !== 'function' ||
        typeof fetch !== 'function' || typeof root.AbortController !== 'function' || typeof root.TextDecoder !== 'function') {
      throw new TypeError('help_environment_required');
    }
    const maxBytes = options.maxBytes === undefined ? LIMIT : options.maxBytes;
    const timeoutMs = options.timeoutMs === undefined ? 10000 : options.timeoutMs;
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > LIMIT ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new RangeError('invalid_help_bounds');
    let disposed = false, generation = 0, panel = null, style = null, view = null, unsubscribe = null;
    let closeButton = null, guide = null, status = null, previousFocus = null, request = null;
    function inside(container, node) {
      while (node) {if (node === container) return true; node = node.parentNode;}
      return false;
    }
    function safelyCancel(target) {
      try {if (typeof target?.cancel === 'function') Promise.resolve(target.cancel()).catch(() => {});} catch (_) {}
    }
    function cancelReader(job) {
      if (job.reader && !job.readerCanceled) {job.readerCanceled = true; safelyCancel(job.reader);}
      else if (!job.reader && job.response) safelyCancel(job.response.body);
    }
    function stopRequest(job) {
      if (!job) return;
      root.clearTimeout(job.timer);
      job.controller.abort();
      cancelReader(job);
    }
    function current(job) {
      return !disposed && panel === job.panel && request === job && generation === job.generation && i18n.getLocale() === job.locale;
    }
    function loadGuide() {
      if (!panel || !guide || disposed) return;
      generation++;
      stopRequest(request);
      const locale = i18n.getLocale();
      const job = {controller: new root.AbortController(), locale, panel, generation, reader: null, response: null};
      request = job;
      view.setText(guide, '');
      view.setText(status, i18n.ui('Loading the guide...'));
      const signal = job.controller.signal;
      let abortListener;
      const aborted = new Promise((resolve, reject) => {
        abortListener = () => reject(new Error('guide_canceled'));
        signal.addEventListener('abort', abortListener, {once: true});
      });
      job.timer = root.setTimeout(() => stopRequest(job), timeoutMs);
      let transport;
      try {
        if (!Object.prototype.hasOwnProperty.call(GUIDE_PATHS, locale)) throw new Error('guide_locale');
        transport = Promise.resolve(fetch(GUIDE_PATHS[locale], {method: 'GET', credentials: 'omit', redirect: 'error', signal}));
      } catch (_) {transport = Promise.reject(new Error('guide_fetch'));}
      const arriving = transport.then(result => {
        if (!current(job) || signal.aborted) {safelyCancel(result?.body); throw new Error('guide_stale');}
        job.response = result;
        return result;
      });
      // Race each asynchronous boundary, including transports which ignore abort.
      // Late transport results are canceled above and cannot reach a retired view.
      (async () => {
        let success = false;
        try {
          const result = await Promise.race([arriving, aborted]);
          if (!result || result.ok !== true || result.redirected === true || typeof result.headers?.get !== 'function') throw new Error('guide_response');
          const mime = (result.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (!['text/plain', 'text/markdown'].includes(mime)) throw new Error('guide_type');
          const length = result.headers.get('content-length');
          if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)) throw new Error('guide_size');
          // A text() fallback would permit an unbounded allocation for unknown lengths.
          if (typeof result.body?.getReader !== 'function') throw new Error('guide_stream');
          job.reader = result.body.getReader();
          if (typeof job.reader?.read !== 'function') throw new Error('guide_reader');
          const decoder = new root.TextDecoder('utf-8', {fatal: true});
          let size = 0, text = '';
          while (true) {
            if (!current(job) || signal.aborted) throw new Error('guide_stale');
            const chunk = await Promise.race([job.reader.read(), aborted]);
            if (!chunk || typeof chunk.done !== 'boolean') throw new Error('guide_chunk');
            if (chunk.done) break;
            if (!(chunk.value instanceof Uint8Array)) throw new Error('guide_chunk');
            size += chunk.value.byteLength;
            if (size > maxBytes) throw new Error('guide_size');
            text += decoder.decode(chunk.value, {stream: true});
          }
          text += decoder.decode();
          if (!text.trim() || text.includes('\u0000')) throw new Error('guide_empty');
          if (!current(job) || signal.aborted) return;
          view.setText(guide, text);
          view.setText(status, '');
          success = true;
        } catch (_) {
          if (current(job)) {
            view.setText(guide, '');
            view.setText(status, i18n.ui('Unable to load the guide. Please try again later.'));
          }
        } finally {
          root.clearTimeout(job.timer);
          signal.removeEventListener('abort', abortListener);
          if (!success) cancelReader(job);
          try {job.reader?.releaseLock();} catch (_) {}
          if (request === job) request = null;
        }
      })();
    }
    function onClose() {close();}
    function onKey(event) {
      if (!panel) return;
      if (event.key === 'Escape') {event.preventDefault(); close();}
      else if (event.key === 'Tab') {event.preventDefault(); closeButton.focus();}
    }
    function close() {
      if (!panel) return;
      generation++;
      const oldPanel = panel, oldFocus = previousFocus;
      const restore = !document.activeElement || document.activeElement === document.body || inside(oldPanel, document.activeElement);
      panel = null;
      stopRequest(request); request = null;
      unsubscribe?.(); unsubscribe = null;
      document.removeEventListener('keydown', onKey);
      closeButton.removeEventListener('click', onClose);
      view.release(oldPanel); view.close(); view = null;
      oldPanel.remove(); style.remove();
      style = null; closeButton = null; guide = null; status = null; previousFocus = null;
      if (restore && oldFocus && typeof oldFocus.focus === 'function' && !oldFocus.disabled && !oldFocus.hidden &&
          oldFocus.isConnected !== false && inside(document.body, oldFocus)) {
        try {oldFocus.focus({preventScroll: true});} catch (_) {}
      }
    }
    function element(tag, parent, id) {
      const node = document.createElement(tag);
      if (id) view.setText(node, i18n.ui(id));
      if (parent) parent.append(node);
      return node;
    }
    function open({profile = 'workspace'} = {}) {
      if (!['workspace', 'legacy', 'login'].includes(profile)) throw new TypeError('invalid_help_profile');
      if (disposed) return false;
      close();
      previousFocus = document.activeElement;
      view = i18n.createView();
      style = element('style'); style.textContent = STYLE; document.head.append(style);
      panel = element('div'); panel.className = 'chunlack-help-backdrop';
      const dialog = element('section', panel); dialog.className = 'chunlack-help-dialog';
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      const header = element('div', dialog); header.className = 'chunlack-help-header';
      const title = element('h2', header, profile === 'login' ? 'Sign-in help' : profile === 'legacy' ? 'Legacy help' : 'Workspace help');
      title.id = 'chunlack-help-title-' + (++nextId); dialog.setAttribute('aria-labelledby', title.id);
      closeButton = element('button', header, 'Close help'); closeButton.type = 'button'; closeButton.className = 'chunlack-help-close';
      view.setAttribute(closeButton, 'aria-label', i18n.ui('Close help'));
      element('p', dialog, 'This help is private. It never sends channel messages or invokes a model or tool.');
      if (profile === 'login') {
        element('p', dialog, 'Sign in with Pocket ID using your own account. Follow the sign-in page to complete authentication.');
        element('p', dialog, 'After signing in, an existing membership or an approved invitation is required to enter a workspace. Contact its owner if you need access.');
        element('p', dialog, 'Signing in does not grant Events or Agent permissions.');
      } else {
        element('p', dialog, 'Commands are described here for reference. This panel never executes commands.');
        element('p', dialog, 'Every request remains subject to actual workspace membership and permissions, and to server policy.');
        const commands = element('dl', dialog);
        const rows = [
          ['@Agent', 'Address an Agent by its existing name; access and model use still require permission.'],
          ['/help', 'Open private local help without broadcasting a channel message.'],
          ['/spawn', 'Open the existing form to create an Agent, subject to your permissions.'],
          ['/ground', 'Request collaboration or review; this may incur additional model costs.'],
          ['/siphon <topic>', 'Request research on the supplied topic, within the configured task and access limits.'],
          ['/stop', 'Request cancellation of the relevant work; this is not a global emergency stop.']
        ];
        if (profile === 'legacy') rows.push(
          ['/tree', 'Inspect the existing tree view where server policy permits it.'],
          ['/graph', 'Inspect the existing graph view where server policy permits it.']
        );
        for (const [command, description] of rows) {
          element('code', element('dt', commands)).textContent = command;
          element('dd', commands, description);
        }
        element('p', dialog, 'Public multi-user mode does not expose /bash, /pull, host files, cron, or reset paths.');
        element('p', dialog, 'Changing the interface language does not translate user messages, model output, or evidence, and does not grant Events or Agent permissions.');
        const guideTitle = element('h3', dialog, 'Complete user guide');
        guideTitle.id = title.id + '-guide';
        status = element('p', dialog); status.className = 'chunlack-help-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        guide = element('pre', dialog); guide.className = 'chunlack-help-guide'; guide.setAttribute('aria-labelledby', guideTitle.id);
      }
      document.body.append(panel);
      closeButton.addEventListener('click', onClose);
      document.addEventListener('keydown', onKey);
      unsubscribe = i18n.subscribe(() => {if (panel && !disposed) loadGuide();});
      closeButton.focus({preventScroll: true});
      loadGuide();
      return true;
    }
    function dispose() {if (disposed) return; close(); disposed = true;}
    return Object.freeze({open, close, dispose});
  }
  return Object.freeze({catalogs, createHelp});
});
