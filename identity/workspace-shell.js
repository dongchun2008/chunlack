(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.defineProperty(root, 'ChunLackWorkspaceShell', {value: factory()});
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  function mountWorkspaceShell({client, document, i18n = null}) {
    if (!client || !document) throw new TypeError('Workspace client and document required');
    const view = i18n ? i18n.createView() : null;
    const ui = (id, params = {}) => i18n ? i18n.ui(id, params) : id.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => Object.hasOwn(params, name) ? String(params[name]) : whole);
    const setText = (element, value) => view ? view.setText(element, value) : (element.textContent = String(value == null ? '' : value));
    const attribute = (element, name, value) => view ? view.setAttribute(element, name, value) : element.setAttribute(name, String(value));
    const data = (value, fallback = '') => value ? String(value) : fallback;
    const roles = {owner: ui('所有者'), member: i18n ? ui('成员角色') : ui('成员'), viewer: ui('只读成员')};
    // These mappings affect captions only. Requests, datasets and stored codes remain raw.
    const statuses = {pending: ui('等待中'), queued: ui('已排队'), running: ui('运行中'), completed: ui('已完成'), complete: ui('已完成'), succeeded: ui('已成功'), failed: ui('已失败'), cancelled: ui('已取消'), expired: ui('已过期'), paused: ui('已暂停'), revoked: ui('已撤销'), registered: ui('已登记'), retrieved: ui('已获取'), fetch_failed: ui('获取失败'), supported: ui('模型认为支持'), partially_supported: ui('模型认为部分支持'), conflicting: ui('存在冲突'), insufficient_evidence: ui('证据不足'), unverified: ui('未核验'), received: ui('尚未收到完整证据'), evidence_checked: ui('字段与文件已校验，尚未人工验收'), accepted: ui('已人工验收'), reviewed_with_gaps: ui('已复核，仍有缺证'), not_started: ui('尚未开始'), retrieving: ui('正在获取'), verifying: ui('正在核验'), summarizing: ui('正在汇总')};
    const displayStatus = value => i18n && Object.hasOwn(statuses, String(value)) ? statuses[String(value)] : String(value);
    let state = null, closed = false, panelGeneration = 0, timer = null, copySecret = null, copyButton = null, pendingConfirmation = null;
    const imageUrls = new Map();
    const node = (tag, text, id) => {
      const element = document.createElement(tag);
      if (text !== undefined) setText(element, text);
      if (id) element.id = id;
      return element;
    };
    const style = node('style');
    style.textContent = `
      .workspace-bar{position:fixed;inset:0 0 auto;z-index:1001;min-height:48px;display:flex;align-items:center;gap:10px;padding:8px 16px;background:var(--bg,#f7f8ee);color:var(--text,#29391f);border-bottom:1px solid var(--border,#bdcba6);font:13px Georgia,serif;box-sizing:border-box}
      .workspace-bar strong{font-weight:700}.workspace-bar select{max-width:220px}.workspace-bar button,.workspace-dialog button,.workspace-dialog input,.workspace-dialog select{font:inherit;border:1px solid #8c9d73;border-radius:8px;padding:8px 10px;background:#f7f8ee;color:#29391f;box-sizing:border-box}
      .workspace-bar button:disabled,.workspace-dialog button:disabled{opacity:.45;cursor:not-allowed}.workspace-spacer{flex:1}.workspace-account{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .workspace-cover{position:fixed;inset:48px 0 0;z-index:1000;background:radial-gradient(ellipse at top left,#dce8bc,transparent 65%),#f3f5e8;display:grid;place-items:center;padding:24px}.workspace-cover[hidden],.workspace-panel[hidden]{display:none}
      .workspace-dialog{width:min(760px,100%);max-height:calc(100vh - 100px);overflow:auto;padding:24px;background:#fcfdf7;border:1px solid #9aaa81;border-radius:18px;box-shadow:0 12px 40px #34432120;color:#29391f;font:15px Georgia,serif;box-sizing:border-box}.workspace-dialog h2{margin:0 0 16px;font-size:24px}.workspace-dialog p{line-height:1.7;overflow-wrap:anywhere}.workspace-dialog label{display:grid;gap:6px;margin:12px 0}.workspace-dialog input{width:100%}.workspace-dialog input[type=checkbox]{width:auto}.workspace-dialog form{max-width:420px}.workspace-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #dce3cd}.workspace-row span{overflow-wrap:anywhere}.workspace-row strong{flex:1}.workspace-error{color:#833b25;white-space:pre-wrap}.workspace-panel{position:fixed;inset:48px 0 0;z-index:1002;background:#26371b50;padding:24px;display:grid;place-items:center}.workspace-dialog a{color:#37591f;overflow-wrap:anywhere}.workspace-dialog blockquote{border-left:3px solid #8eac61;margin:12px 0;padding:8px 16px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5e6}.workspace-source{padding:12px 0;border-bottom:1px solid #dce3cd}
      @media(max-width:700px){.workspace-bar{gap:5px;padding:6px;flex-wrap:wrap}.workspace-bar select{max-width:150px}.workspace-bar button{padding:6px}.workspace-account{max-width:95px}.workspace-cover,.workspace-panel{inset:92px 0 0;padding:12px}.workspace-dialog{padding:18px;max-height:calc(100dvh - 116px)}}`;
    document.head.append(style);
    const bar = node('header'); bar.className = 'workspace-bar';
    const brand = node('strong', 'ChunLACK');
    const selector = node('select', undefined, 'workspaceSelector'); attribute(selector, 'aria-label', ui('当前工作区'));
    const role = node('span', '', 'workspaceRole'), spacer = node('span'); spacer.className = 'workspace-spacer';
    const account = node('span', '', 'workspaceAccount'); account.className = 'workspace-account';
    const button = (text, fn, parent) => {
      const element = node('button', text); element.type = 'button'; element.onclick = fn;
      if (parent) parent.append(element); return element;
    };
    const members = button(ui('成员'), () => openMembers()), nodes = button(ui('节点'), () => openNodes()), tasks = button(ui('任务'), () => openTasks());
    const agentGrants = button(ui('Agent 授权'), () => openAgentGrants()); agentGrants.id = 'workspaceAgentGrants';
    const logout = button(ui('退出'), () => act(() => client.logout())); logout.id = 'workspaceLogout';
    const language = i18n ? node('select', undefined, 'workspaceLanguage') : null;
    if (language) {
      attribute(language, 'aria-label', ui('界面语言')); attribute(language, 'title', ui('界面语言'));
      for (const [value, name] of [['zh-CN', '中文'], ['en', 'English']]) {const option = node('option', name); option.value = value; language.append(option);}
      language.value = i18n.getLocale();
      language.onchange = () => {if (!closed) i18n.setLocale(language.value);};
    }
    const unsubscribeLocale = i18n ? i18n.subscribe(() => {if (!closed) language.value = i18n.getLocale();}) : () => {};
    bar.append(brand, selector, role, spacer, members, nodes, tasks, agentGrants, account);
    if (language) bar.append(language);
    bar.append(logout); document.body.prepend(bar);
    const cover = node('section'); cover.className = 'workspace-cover'; cover.hidden = true; document.body.append(cover);
    const panel = node('section'); panel.className = 'workspace-panel'; panel.hidden = true; document.body.append(panel);
    const notice = node('p', '', 'workspaceNotice'); notice.className = 'workspace-error'; notice.setAttribute('role', 'status');
    const errorText = error => ({unauthorized: ui('登录失效，请重新登录。'), forbidden: ui('当前账号没有这项权限。'), membership_revoked: ui('工作区成员资格已失效。'), invalid_credentials: ui('账号或密码不正确。'), invalid_invite: ui('邀请码无效或已失效。'), rate_limited: ui('请求过于频繁，请稍后重试。'), logout_pending: ui('退出尚未确认，请重试退出。'), gateway_unavailable: ui('节点服务暂不可用。'), stale_workspace: ui('工作区已切换，请重新操作。')})[error && error.code] || ui('操作未完成，请检查权限和连接后重试。');
    function notify(error) {
      if (closed) return;
      setText(notice, errorText(error));
      const destination = panel.hidden ? cover : panel.children[0];
      if (destination) destination.append(notice);
    }
    async function act(fn) {const generation = panelGeneration; try {return await fn();} catch (error) {if (!closed && generation === panelGeneration) notify(error);}}
    function clearPanel() {
      if (pendingConfirmation) pendingConfirmation(false);
      for (const [url, api] of imageUrls) api.revokeObjectURL(url);
      imageUrls.clear();
      panelGeneration++; clearTimeout(timer); timer = null; copySecret = null;
      if (copyButton) copyButton.disabled = true; copyButton = null;
      if (view) view.release(panel);
      panel.replaceChildren(); panel.hidden = true; setText(notice, '');
    }
    function dialog(title) {
      clearPanel(); const body = node('section'); body.className = 'workspace-dialog'; body.setAttribute('role', 'dialog'); attribute(body, 'aria-label', title);
      const heading = node('div'); heading.className = 'workspace-row'; heading.append(node('h2', title));
      button(ui('关闭'), clearPanel, heading); body.append(heading); panel.append(body); panel.hidden = false;
      const generation = panelGeneration, workspaceId = state && state.workspace && state.workspace.id;
      return {body, live: () => !closed && !panel.hidden && generation === panelGeneration && workspaceId === (state && state.workspace && state.workspace.id)};
    }
    function field(form, title, id, type = 'text') {
      const label = node('label'), caption = node('span', title), input = node('input', undefined, id); input.type = type; input.required = true;
      label.append(caption, input); form.append(label); return input;
    }
    function roleOptions(selected) {
      const select = node('select'); attribute(select, 'aria-label', ui('成员权限'));
      for (const [value, text] of Object.entries(roles)) {const option = node('option', text); option.value = value; select.append(option);}
      select.value = selected; return select;
    }
    function confirm(text) {
      if (pendingConfirmation) pendingConfirmation(false);
      if (closed || panel.hidden || !panel.children[0]) return Promise.resolve(false);
      return new Promise(resolve => {
        const box = node('section'); box.setAttribute('role', 'alertdialog'); attribute(box, 'aria-label', ui('确认操作')); box.append(node('p', text));
        const finish = value => {if (pendingConfirmation !== finish) return; pendingConfirmation = null; if (view) view.release(box); box.remove(); resolve(value);};
        pendingConfirmation = finish;
        button(ui('确认操作'), () => finish(true), box); button(ui('取消操作'), () => finish(false), box);
        panel.children[0].append(box);
      });
    }
    function gatedControls() {
      const allowed = client.can('execute'), manage = client.can('manage');
      for (const id of ['messageInput', 'sendBtn', 'groundBtn', 'fileInput', 'sendThreadReply']) {const element = document.getElementById(id); if (element) element.disabled = !allowed;}
      for (const id of ['studioSpawnBtn', 'moderatorBtn']) {const element = document.getElementById(id); if (element) element.disabled = !manage;}
    }
    function render(next) {
      if (closed) return;
      if (i18n) i18n.setUser(next.user ? next.user.id : null);
      if (!state || state.generation !== next.generation || !next.workspace || (state.workspace && state.workspace.role !== next.workspace.role)) clearPanel();
      state = next; setText(account, next.user ? next.user.login : '');
      if (view) for (const option of selector.children) view.release(option);
      selector.replaceChildren();
      for (const workspace of next.workspaces || []) {const option = node('option', workspace.name); option.value = workspace.id; selector.append(option);}
      selector.value = next.workspace ? next.workspace.id : ''; selector.disabled = !next.user || !(next.workspaces || []).length;
      setText(role, next.workspace ? roles[next.workspace.role] || ui('无权限') : '');
      members.disabled = nodes.disabled = tasks.disabled = !next.workspace || next.status !== 'ready';
      agentGrants.hidden = !next.workspace || next.status !== 'ready' || !client.can('manage'); agentGrants.disabled = agentGrants.hidden;
      logout.hidden = !next.user && next.status !== 'logout_pending'; setText(logout, next.status === 'logout_pending' ? ui('重试退出') : ui('退出'));
      gatedControls(); if (view) view.release(cover); cover.replaceChildren(); cover.hidden = next.status === 'ready';
      if (cover.hidden) return;
      const body = node('section'); body.className = 'workspace-dialog'; cover.append(body);
      body.append(node('h2', next.status === 'login' ? ui('登录私有工作区') : 'ChunLACK'));
      if (next.status === 'login') {
        const form = node('form', undefined, 'workspaceLoginForm');
        const login = field(form, ui('账号'), 'workspaceLogin'); login.autocomplete = 'username';
        const password = field(form, ui('密码'), 'workspacePassword', 'password'); password.autocomplete = 'current-password';
        const submit = node('button', ui('登录')); submit.type = 'submit'; form.append(submit);
        form.onsubmit = async event => {
          event.preventDefault(); const value = password.value; password.value = ''; submit.disabled = true;
          await act(() => client.login(login.value.trim(), value)); if (!closed) submit.disabled = false;
        };
        body.append(form);
        const sso = node('a', ui('使用统一身份登录（Pocket ID）')); sso.href = '/auth/oidc/login'; body.append(sso);
        button(ui('使用邀请码'), () => openInvite(), body);
        body.append(node('p', ui('没有账号？请向工作区所有者申请邀请。此页面不会显示或保存模型密钥。')));
      } else if (next.status === 'no_access' || next.status === 'selection') {
        body.append(node('p', next.status === 'selection' ? ui('成员资格或权限已变化，请重新选择工作区。') : ui('当前账号没有可访问的工作区，请联系所有者。')));
        for (const workspace of next.workspaces || []) button(workspace.name, () => act(() => client.selectWorkspace(workspace.id)), body);
        button(ui('接受工作区邀请'), openInvite, body);
      } else {
        body.append(node('p', next.status === 'logout_pending' ? ui('连接中断，退出尚未确认。聊天和任务已停止，请重试退出。') : next.status === 'initializing' ? ui('正在核对登录和成员权限…') : ui('暂时无法连接，旧工作区内容已隐藏。')));
        if (next.status === 'logout_pending') button(ui('重试退出'), () => act(() => client.logout()), body);
      }
    }
    selector.onchange = () => act(() => client.selectWorkspace(selector.value));
    function openInvite() {
      const d = dialog(ui('接受工作区邀请')), form = node('form');
      const code = field(form, ui('一次性邀请码'), 'workspaceInviteCode', 'password'); code.autocomplete = 'off';
      const password = field(form, ui('新账号密码（已有账号无需填写）'), 'workspaceInvitePassword', 'password'); password.required = false; password.autocomplete = 'new-password';
      const submit = node('button', ui('接受邀请')); submit.type = 'submit'; form.append(submit); d.body.append(form);
      form.onsubmit = async event => {
        event.preventDefault(); const token = code.value.trim(), value = password.value; code.value = password.value = ''; submit.disabled = true;
        await act(() => client.acceptInvite(token, value)); if (d.live()) submit.disabled = false;
      };
    }
    function copyOnce(body, secret, label) {
      if (typeof secret !== 'string' || !secret) {body.append(node('p', ui('服务未返回一次性凭据，请勿重复操作。'))); return;}
      const generation = panelGeneration, live = () => !closed && generation === panelGeneration && !panel.hidden;
      copySecret = secret;
      if (copyButton) {copyButton.disabled = true; setText(copyButton, ui('已由新凭据替换'));}
      copyButton = button(label, () => act(async () => {
        const value = copySecret; if (!value || !live()) return;
        const clipboard = document.defaultView && document.defaultView.navigator && document.defaultView.navigator.clipboard;
        if (!clipboard) throw new Error('clipboard_unavailable');
        await clipboard.writeText(value); if (!live()) return;
        copySecret = null; if (copyButton) {copyButton.disabled = true; setText(copyButton, ui('已复制'));}
        body.append(node('p', ui('已复制。仅交给对应接入者，不发送到公共频道；关闭面板后不能再次复制。')));
      }), body);
    }
    async function openMembers() {
      if (!state || !state.workspace) return;
      const d = dialog(ui('工作区成员')), workspaceId = state.workspace.id;
      await act(async () => {
        const response = await client.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`);
        if (!d.live()) return;
        for (const member of response.members || []) {
          const row = node('div'); row.className = 'workspace-row'; row.append(node('strong', member.login || member.userId), node('span', roles[member.role] || member.role));
          if (client.can('manage')) {
            const select = roleOptions(member.role); row.append(select);
            button(ui('更新权限'), () => act(async () => {await client.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.userId)}`, {method: 'PATCH', body: {role: select.value}}); if (d.live()) await openMembers();}), row);
            button(ui('移除'), () => act(async () => {if (!await confirm(ui('移除该成员？正在进行的会话和后续操作将失去访问权限。'))) return; await client.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.userId)}`, {method: 'DELETE', body: {}}); if (d.live()) await openMembers();}), row);
          }
          d.body.append(row);
        }
        if (client.can('manage')) {
          const form = node('form'), login = field(form, ui('邀请账号'), 'workspaceNewMember'), select = roleOptions('member'); form.append(select);
          const submit = node('button', ui('创建一次性邀请')); submit.type = 'submit'; form.append(submit); d.body.append(form);
          form.onsubmit = async event => {event.preventDefault(); submit.disabled = true; await act(async () => {
            const result = await client.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, {method: 'POST', body: {login: login.value.trim(), role: select.value}});
            if (d.live()) copyOnce(d.body, result.token, ui('复制一次性邀请码'));
          }); if (d.live()) submit.disabled = false;};
        }
      });
    }
    async function openNodes() {
      if (!state || !state.workspace) return;
      const d = dialog(ui('协作节点')); d.body.append(node('p', ui('节点是执行者，不是模型服务。创建节点不代表已接入 Muse 或 dots 自身的 Agent 能力。')));
      await act(async () => {
        const response = await client.request('/api/nodes'); if (!d.live()) return;
        for (const item of response.nodes || []) {
          const row = node('div'); row.className = 'workspace-row'; row.append(node('strong', item.name || item.id), node('span', item.revoked ? ui('已撤销') : item.paused ? ui('已暂停') : ui('已登记')));
          if (client.can('execute') && !item.revoked && !item.paused && Array.isArray(item.capabilities) && item.capabilities.length === 1 && item.capabilities[0] === 'browser.public_read' && Array.isArray(item.scopes) && item.scopes.length === 1 && item.scopes[0] === 'public') {
            const start = button(ui('公开浏览试点'), () => act(async () => {
              if (!d.live() || start.disabled || !client.can('execute')) return;
              start.disabled = true;
              try {
                if (!await confirm(ui('向该节点发送 example.com 浏览与截图试点？任务期限五分钟；执行完成不代表已人工验收。')) || !d.live()) return;
                const result = await client.request('/api/tasks', {method: 'POST', body: {targetNodeId: item.id}});
                if (!d.live()) return;
                if (typeof result?.task?.taskId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(result.task.taskId)) throw new Error('invalid_task_receipt');
                d.body.append(node('p', ui('已创建公开浏览试点：{taskId}', {taskId: result.task.taskId})));
                button(ui('查看任务进度'), openTasks, d.body);
              } finally {if (d.live()) start.disabled = false;}
            }), row);
          }
          if (client.can('manage') && !item.revoked) {
            button(item.paused ? ui('恢复') : ui('暂停'), () => act(async () => {await client.request(`/api/nodes/${encodeURIComponent(item.id)}/pause`, {method: 'POST', body: {paused: !item.paused}}); if (d.live()) await openNodes();}), row);
            button(ui('撤销'), () => act(async () => {if (!await confirm(ui('撤销该节点的后续接入权限？'))) return; await client.request(`/api/nodes/${encodeURIComponent(item.id)}`, {method: 'DELETE', body: {}}); if (d.live()) await openNodes();}), row);
          }
          d.body.append(row);
        }
        if (!client.can('manage')) return;
        const form = node('form'), name = field(form, ui('节点名称'), 'workspaceNodeName'), selected = [];
        for (const capability of ['research.retrieve', 'research.verify', 'research.summarize', 'browser.public_read']) {
          const label = node('label', capability), checkbox = node('input'); checkbox.type = 'checkbox'; label.append(checkbox); form.append(label); selected.push({checkbox, capability});
        }
        const submit = node('button', ui('登记节点')); submit.type = 'submit'; form.append(submit); d.body.append(form);
        form.onsubmit = async event => {event.preventDefault(); submit.disabled = true; await act(async () => {
          const result = await client.request('/api/nodes', {method: 'POST', body: {name: name.value.trim(), capabilities: selected.filter(item => item.checkbox.checked).map(item => item.capability), scopes: ['public']}});
          if (d.live()) copyOnce(d.body, result.pairingCode, ui('复制一次性配对码'));
        }); if (d.live()) submit.disabled = false;};
      });
    }
    async function openAgentGrants() {
      if (closed || !state?.workspace || state.status !== 'ready' || !client.can('manage')) return;
      const d = dialog(ui('外部 Agent 授权')), workspaceId = state.workspace.id;
      const route = `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-grants`;
      const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
      const scopes = ['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe'];
      d.body.append(node('p', ui('授权只适用于当前工作区。客户端须先单独登记，账户须已绑定；这里不创建云端账号、不读取密钥，也不代表 Muse 或 dots 已接入成功。')));
      await act(async () => {
        const info = await client.request(route); if (!d.live()) return;
        if (info?.available === false) {
          const unavailable = node('p', ui('外部 Agent 授权管理尚未启用。此页面仅显示状态，不能创建或撤销授权；请由管理员完成接入配置后再试。'));
          unavailable.setAttribute('role', 'status'); d.body.append(unavailable); return;
        }
        if (!Array.isArray(info.grants) || info.grants.length > 2048 || !Array.isArray(info.clientIds) || info.clientIds.length > 32 ||
            info.clientIds.some(id => typeof id !== 'string' || !id || id.length > 256) ||
            info.grants.some(item => !uuid(item.id) || item.workspaceId !== workspaceId || !uuid(item.nodeId) ||
              typeof item.clientId !== 'string' || !Array.isArray(item.scopes) || item.scopes.some(scope => !scopes.includes(scope)) ||
              !Number.isSafeInteger(item.expiresAt))) throw new Error('invalid_response');
        d.body.append(node('p', ui('授权记录不等于当前可用权限：过期、成员变更、节点撤销或令牌范围不足，都可能使执行被拒绝。')));
        for (const item of info.grants) {
          const row = node('div'); row.className = 'workspace-row';
          row.append(node('strong', item.clientId), node('span', ui('节点：{nodeId}', {nodeId: item.nodeId})),
            node('span', item.scopes.join(', ')), node('span', item.expiresAt <= Date.now() ? ui('已过期') : ui('未过期，仍须实时校验')));
          const revoke = button(ui('撤销授权'), async () => {
            if (!d.live() || revoke.disabled || !client.can('manage')) return;
            revoke.disabled = true;
            try {await act(async () => {
              if (!await confirm(ui('撤销客户端 {clientId} 对节点 {nodeId} 的这项授权？后续任务和事件将重新校验权限；已发送的数据无法撤回。', {clientId: item.clientId, nodeId: item.nodeId}))) return;
              if (!d.live() || !client.can('manage')) return;
              await client.request(route + '/' + encodeURIComponent(item.id), {method: 'DELETE', body: {}});
              if (d.live()) await openAgentGrants();
            });} finally {if (d.live()) revoke.disabled = false;}
          }, row);
          d.body.append(row);
        }
        const response = await client.request('/api/nodes'); if (!d.live()) return;
        if (!Array.isArray(response.nodes) || response.nodes.length > 100 || response.nodes.some(item => !uuid(item.id) || item.workspaceId !== workspaceId)) throw new Error('invalid_response');
        const available = response.nodes.filter(item => !item.revoked);
        const form = node('form', undefined, 'agentGrantForm');
        form.append(node('h3', ui('创建明确授权')));
        const subject = field(form, ui('Pocket ID 账户 subject（UUID，不是用户名）'), 'agentGrantSubject'); subject.autocomplete = 'off';
        function selection(label, id, items) {
          const wrapper = node('label'), caption = node('span', label), select = node('select', undefined, id); select.required = true;
          for (const [value, text] of items) {const option = node('option', text); option.value = value; select.append(option);}
          wrapper.append(caption, select); form.append(wrapper); return select;
        }
        const clientId = selection(ui('已批准的 Agent 客户端'), 'agentGrantClient', [['', ui('请选择客户端')], ...info.clientIds.map(id => [id, id])]);
        const target = selection(ui('当前工作区的节点'), 'agentGrantNode', [['', ui('请选择节点')], ...available.map(item => [item.id, item.paused ? ui('{name}（已暂停）', {name: String(item.name || item.id)}) : String(item.name || item.id)])]);
        clientId.value = target.value = '';
        const checks = scopes.map(scope => {
          const label = node('label', scope), input = node('input', undefined, 'agentGrantScope_' + scope.replaceAll('.', '_'));
          input.type = 'checkbox'; input.checked = scope === 'task.read'; label.append(input); form.append(label); return {scope, input};
        });
        const duration = selection(ui('授权有效期'), 'agentGrantDuration', [['3600000', ui('1 小时')], ['86400000', ui('24 小时')], ['604800000', ui('7 天')]]); duration.value = '3600000';
        form.append(node('p', ui('默认只读。领取任务需要 task.claim，回传结果需要 task.result；事件订阅须按需勾选。账户必须拥有所选节点，后端会再次核验。')));
        const submit = node('button', ui('创建授权'), 'agentGrantSubmit'); submit.type = 'submit'; submit.disabled = !available.length || !info.clientIds.length;
        form.append(submit); d.body.append(form);
        if (submit.disabled) d.body.append(node('p', ui('尚无可选节点或已批准的 Agent 客户端，不能创建授权。')));
        form.onsubmit = async event => {
          event.preventDefault(); if (!d.live() || submit.disabled || !client.can('manage')) return;
          submit.disabled = true;
          try {await act(async () => {
            const selected = available.find(item => item.id === target.value), selectedScopes = checks.filter(item => item.input.checked).map(item => item.scope);
            if (!uuid(subject.value.trim()) || !info.clientIds.includes(clientId.value) || !selected || !selectedScopes.length ||
                !['3600000', '86400000', '604800000'].includes(duration.value)) throw new Error('invalid_agent_grant');
            const input = {subject: subject.value.trim(), clientId: clientId.value, nodeId: selected.id,
              scopes: selectedScopes, expiresAt: Date.now() + Number(duration.value)};
            if (!await confirm(ui('为账户 {subject} 的客户端 {clientId} 授权节点 {nodeName}？权限：{scopes}；到期：{expiresAt}。仅限当前工作区，不扩大节点本身的工具权限。', {subject: input.subject, clientId: input.clientId, nodeName: String(selected.name || selected.id), scopes: input.scopes.join(', '), expiresAt: new Date(input.expiresAt).toISOString()}))) return;
            if (!d.live() || !client.can('manage')) return;
            const result = await client.request(route, {method: 'POST', body: input});
            if (!d.live()) return;
            if (!uuid(result?.grant?.id)) throw new Error('invalid_response');
            await openAgentGrants();
          });} finally {if (d.live()) submit.disabled = !available.length || !info.clientIds.length;}
        };
      });
    }
    async function openTasks() {
      if (!state || !state.workspace) return;
      const d = dialog(ui('任务进度')), list = node('div'); d.body.append(node('p', ui('“完成”表示执行链已结束，不等于结论已核验或人工验收。取消后的远端任务仍须确认停止或等待租约到期。')), list);
      async function refresh() {
        await act(async () => {
          const response = await client.request('/api/tasks'); if (!d.live()) return; if (view) view.release(list); list.replaceChildren();
          for (const [kind, items] of [['local', response.localTasks || []], ['external', response.externalTasks || []]]) for (const task of items) {
            const row = node('div'); row.className = 'workspace-row'; row.append(node('strong', task.taskId), node('span', ui('{kind} · {status}', {kind: kind === 'local' ? ui('编排') : ui('外部节点'), status: task.state || task.status ? displayStatus(task.state || task.status) : ui('未知')})));
            if (kind === 'external' && task.taskType === 'browser.public_read') button(ui('查看证据'), () => openTaskEvidence(task.taskId), row);
            if (client.can('cancel', task.createdBy) && !['completed', 'succeeded', 'cancelled', 'failed', 'expired'].includes(task.state || task.status)) button(ui('取消'), () => act(async () => {
              if (!await confirm(ui('请求停止该任务及其后续执行？'))) return;
              await client.request(`/api/tasks/${encodeURIComponent(task.taskId)}/cancel`, {method: 'POST', body: {kind}}); if (d.live()) await refresh();
            }), row);
            list.append(row);
          }
        });
        if (d.live()) {clearTimeout(timer); timer = setTimeout(refresh, 5000); if (timer.unref) timer.unref();}
      }
      await refresh();
    }
    async function openTaskEvidence(id) {
      if (!state || !state.workspace || !client.can('read')) return;
      const d = dialog(ui('节点任务证据'));
      await act(async () => {
        const info = await client.request(`/api/tasks/${encodeURIComponent(id)}/evidence`);
        if (!d.live()) return;
        if (info.task?.taskId !== id || info.task?.taskType !== 'browser.public_read' || !info.acceptance) throw new Error('invalid_response');
        const labels = {received: ui('尚未收到完整证据'), evidence_checked: ui('字段与文件已校验，尚未人工验收'), accepted: ui('已人工验收')};
        const status = node('p', labels[info.acceptance.state] || ui('证据状态未知')); d.body.append(node('strong', id), status);
        d.body.append(node('p', ui('执行成功不等于结论可靠。活动记录是节点自述；截图格式和哈希校验不证明 Muse 或 dots 自身浏览器已执行任务。')));
        const output = info.output || {};
        d.body.append(node('h3', output.title || ui('未返回标题')), node('p', output.executedAt || ui('缺证：未返回执行时间')), node('blockquote', output.activityEvidence || ui('缺证：未返回活动记录')));
        let url; try {url = new URL(output.url);} catch (_) {}
        if (url && url.protocol === 'https:' && !url.username && !url.password) {
          const link = node('a', output.url); link.href = output.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; d.body.append(link);
        } else d.body.append(node('p', ui('缺证：未返回安全的原始网址。')));
        if (info.acceptance.acceptedAt) d.body.append(node('p', ui('验收时间：{time}', {time: new Date(info.acceptance.acceptedAt).toISOString()})));
        if (info.nodeRevoked) d.body.append(node('p', ui('节点已撤销：保留历史证据，不再允许新验收。')));
        button(ui('重新读取证据'), () => openTaskEvidence(id), d.body);
        if (!info.artifact) {d.body.append(node('p', ui('缺证：尚无可读取的截图，不能人工验收。'))); return;}
        d.body.append(node('p', ui('截图：{width} × {height}；SHA-256：{hash}', {width: String(info.artifact.width), height: String(info.artifact.height), hash: data(info.artifact.sha256, ui('缺失'))})));
        let loaded = false, accepted = info.acceptance.state === 'accepted', approve = null;
        if (client.can('manage') && !info.nodeRevoked && info.task.state === 'succeeded' && info.acceptance.state === 'evidence_checked') {
          approve = button(ui('确认人工验收'), async () => {
            if (!d.live() || !loaded || accepted || approve.disabled || !client.can('manage')) return;
            approve.disabled = true;
            try {await act(async () => {
              if (!await confirm(ui('确认已核对截图、活动记录及实际节点身份？仅记录本次人工验收，不扩大任何执行权限。'))) return;
              if (!d.live() || !loaded || !client.can('manage')) return;
              const result = await client.request(`/api/tasks/${encodeURIComponent(id)}/acceptance`, {method: 'POST', body: {confirm: true}});
              if (!d.live()) return;
              if (result.acceptance?.state !== 'accepted') throw new Error('invalid_response');
              accepted = true; setText(status, ui('已人工验收'));
            });} finally {if (d.live()) approve.disabled = accepted || !loaded || !client.can('manage');}
          }, d.body); approve.disabled = true;
        }
        const response = await client.fetch(`/api/tasks/${encodeURIComponent(id)}/artifact`);
        const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
        if (!['image/png', 'image/jpeg'].includes(type)) throw new Error('invalid_response');
        const blob = await response.blob(); if (!d.live()) return;
        const imageUrlApi = document.defaultView && document.defaultView.URL;
        if (blob.size < 1 || blob.size > 2097152 || blob.type.split(';')[0].toLowerCase() !== type || !imageUrlApi?.createObjectURL || !imageUrlApi?.revokeObjectURL) throw new Error('invalid_response');
        const ownedUrl = imageUrlApi.createObjectURL(blob); imageUrls.set(ownedUrl, imageUrlApi);
        const image = node('img'); attribute(image, 'alt', ui('任务截图（节点提交）')); image.style.maxWidth = '100%'; image.style.height = 'auto'; image.style.display = 'block'; image.style.marginTop = '16px';
        image.onload = () => {if (d.live()) {loaded = true; if (approve) approve.disabled = accepted || !client.can('manage');}};
        image.onerror = () => {if (d.live()) {loaded = false; if (approve) approve.disabled = true; d.body.append(node('p', ui('截图无法解码，不能人工验收。')));} imageUrlApi.revokeObjectURL(ownedUrl); imageUrls.delete(ownedUrl);};
        image.src = ownedUrl; d.body.append(image);
      });
    }
    async function openResearch(id) {
      if (!state || !state.workspace || !client.can('read')) return;
      const d = dialog(ui('研究来源与证据'));
      await act(async () => {
        const response = await client.request('/api/research/session/' + encodeURIComponent(id)); if (!d.live()) return;
        const session = response.session || response;
        const sources = (Array.isArray(session.sources) ? session.sources : []).filter(source => source && typeof source === 'object');
        const byId = new Map(sources.map(source => [source.sourceId, source]));
        const legacy = !Object.hasOwn(session, 'evidence');
        const claims = (Array.isArray(legacy ? session.claims : session.evidence) ? (legacy ? session.claims : session.evidence) : []).map(claim => claim || {});
        const labels = {supported: ui('模型认为支持'), partially_supported: ui('模型认为部分支持'), conflicting: ui('存在冲突'), insufficient_evidence: ui('证据不足'), unverified: ui('未核验')};
        const refs = claim => Array.isArray(claim.verification?.evidence) ? claim.verification.evidence : [];
        const validRef = ref => {
          const source = ref && byId.get(ref.sourceId);
          return !!(source && source.status === 'retrieved' && typeof source.excerpt === 'string' && typeof ref.quote === 'string' && ref.quote.trim() && source.excerpt.includes(ref.quote));
        };
        const fullySupported = claim => !legacy && claim.status === 'supported' && refs(claim).length > 0 && refs(claim).every(validRef) && refs(claim).some(ref => ref.sourceId === claim.sourceId);
        const sourceLink = (parent, source) => {
          let url; try {url = new URL(source?.url);} catch (_) {}
          if (url && url.protocol === 'https:' && !url.username && !url.password) {
            const link = node('a', source.url); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link);
          } else parent.append(node('p', ui('缺证：来源链接缺失或不安全，不提供可点击链接。')));
        };
        d.body.append(node('h3', session.topic || ui('研究结果')));
        d.body.append(node('p', ui('模型核验不等于事实已获人工确认；请核对原始来源、逐字引文和缺证提示。')));
        d.body.append(node('p', ui('研究状态：{phase} / {status}', {phase: session.phase ? displayStatus(session.phase) : ui('未知'), status: displayStatus(session.evidenceStatus || 'unverified')})));
        if (legacy) d.body.append(node('p', ui('旧数据：未重新核验，不沿用旧版 verified 标记认定事实成立。')));
        if (!sources.length) d.body.append(node('p', ui('缺证：没有原始来源。')));
        const summary = session.summary || {}, summaryPanel = node('section'); summaryPanel.className = 'workspace-research-summary';
        summaryPanel.append(node('h3', ui('证据摘要')), node('p', ui('摘要状态：{status}', {status: summary.status ? displayStatus(summary.status) : ui('缺证：尚未生成摘要')})));
        if (summary.summarizerId) summaryPanel.append(node('p', ui('汇总 Agent：{agentId}', {agentId: String(summary.summarizerId)})));
        for (const claimId of Array.isArray(summary.claimIds) ? summary.claimIds : []) {
          const claim = claims.find(item => item.claimId === claimId), item = node('p', ui('[{claimId}] {text}', {claimId: String(claimId), text: data(claim?.text, ui('缺证：摘要引用的陈述不存在'))}));
          item.className = 'workspace-summary-claim'; item.dataset.claimId = claimId; summaryPanel.append(item);
          if (!claim || !fullySupported(claim)) summaryPanel.append(node('p', ui('缺证：摘要条目未获完整模型支持或引用无效')));
        }
        d.body.append(summaryPanel, node('h3', ui('全部陈述与模型核验')));
        if (!claims.length) d.body.append(node('p', ui('缺证：没有可展示的陈述')));
        for (const claim of claims) {
          const section = node('section'); section.className = 'workspace-research-claim'; section.dataset.claimId = claim.claimId || ''; section.dataset.status = legacy ? 'unverified' : (claim.status || 'unverified');
          const status = section.dataset.status;
          section.append(node('strong', claim.claimId || ui('未编号陈述')), node('p', claim.text || claim.claim || ui('缺证：未提供陈述')), node('p', ui('模型核验：{label} ({status})', {label: labels[status] || ui('未知状态'), status: String(status)})));
          if (claim.sourceId) {section.append(node('p', ui('原始来源：{sourceId}', {sourceId: String(claim.sourceId)}))); sourceLink(section, byId.get(claim.sourceId));}
          if (claim.verification) {
            section.append(node('p', ui('核验 Agent：{agentId}', {agentId: data(claim.verification.verifierId, ui('未记录'))})), node('p', ui('核验时间：{time}', {time: data(claim.verification.reviewedAt, ui('未记录'))})), node('p', ui('模型核验理由：{reason}', {reason: data(claim.verification.reason, ui('未记录'))})));
          }
          if (legacy || !refs(claim).length || !['supported', 'partially_supported'].includes(status)) section.append(node('p', ui('缺证或尚未充分核验：不能仅凭 Agent 输出认定结论成立。')));
          if (legacy) {
            const ids = Array.isArray(claim.sourceIds) ? claim.sourceIds : claim.sourceId ? [claim.sourceId] : [];
            section.append(node('p', ui('旧版引用：{ids}', {ids: data(ids.join(', '), ui('缺失'))})));
          }
          for (const ref of refs(claim)) {
            section.append(node('p', ui('逐字引文来源：{sourceId}', {sourceId: data(ref?.sourceId, ui('缺失'))}))); sourceLink(section, byId.get(ref?.sourceId));
            section.append(node('blockquote', ref?.quote || ui('缺证：未提供逐字引文')));
            if (!validRef(ref)) section.append(node('p', ui('缺证：引用来源不存在或引文与原始摘录不匹配')));
          }
          d.body.append(section);
        }
        d.body.append(node('h3', ui('原始来源与摘录')));
        for (const source of sources) {
          const section = node('section'); section.className = 'workspace-source';
          section.append(node('strong', source.sourceId || ui('未编号来源'))); sourceLink(section, source);
          section.append(node('p', ui('获取状态：{status}', {status: source.status ? displayStatus(source.status) : ui('旧数据：状态未知')})));
          if (source.status !== 'retrieved') section.append(node('p', ui('缺证：来源尚未成功获取，或缺少获取状态。')));
          if (source.truncated) section.append(node('p', ui('摘录已截断：不能据此认定已覆盖原文全部内容。')));
          section.append(node('blockquote', source.excerpt || ui('缺证：未提供原始摘录。'))); d.body.append(section);
        }
        for (const note of Array.isArray(session.notes) ? session.notes : []) {
          if (!note) continue;
          const section = node('section'); section.className = 'workspace-research-note';
          section.append(node('h4', note.question || ui('研究子问题')), node('p', ui('子问题状态：{status}', {status: note.status ? displayStatus(note.status) : ui('未知')})));
          if (note.status !== 'supported') section.append(node('p', ui('缺证提示：该子问题未获完整模型支持。')));
          if (note.answer) section.append(node('p', ui('子问题记录（不是额外已核验结论）：{answer}', {answer: String(note.answer)})));
          d.body.append(section);
        }
      });
    }
    function clear() {clearPanel(); if (view) {view.release(cover); for (const option of selector.children) view.release(option);} cover.replaceChildren(); setText(account, ''); setText(role, ''); selector.replaceChildren(); selector.disabled = members.disabled = nodes.disabled = tasks.disabled = agentGrants.disabled = true; agentGrants.hidden = true; state = null; gatedControls();}
    function close() {if (closed) return; clear(); closed = true; unsubscribeLocale(); if (view) view.close(); bar.remove(); cover.remove(); panel.remove(); style.remove();}
    render(client.snapshot());
    return Object.freeze({render, clear, close, notify, openResearch, openMembers, openNodes, openTasks, openTaskEvidence, openAgentGrants});
  }
  return Object.freeze({mountWorkspaceShell});
});
