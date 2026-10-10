(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.defineProperty(root, 'ChunLackWorkspaceShell', {value: factory()});
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  function mountWorkspaceShell({client, document}) {
    if (!client || !document) throw new TypeError('Workspace client and document required');
    const roles = {owner: '所有者', member: '成员', viewer: '只读成员'};
    let state = null, closed = false, panelGeneration = 0, timer = null, copySecret = null, copyButton = null, pendingConfirmation = null;
    const node = (tag, text, id) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = String(text == null ? '' : text);
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
    const selector = node('select', undefined, 'workspaceSelector'); selector.setAttribute('aria-label', '当前工作区');
    const role = node('span', '', 'workspaceRole'), spacer = node('span'); spacer.className = 'workspace-spacer';
    const account = node('span', '', 'workspaceAccount'); account.className = 'workspace-account';
    const button = (text, fn, parent) => {
      const element = node('button', text); element.type = 'button'; element.onclick = fn;
      if (parent) parent.append(element); return element;
    };
    const members = button('成员', () => openMembers()), nodes = button('节点', () => openNodes()), tasks = button('任务', () => openTasks());
    const logout = button('退出', () => act(() => client.logout())); logout.id = 'workspaceLogout';
    bar.append(brand, selector, role, spacer, members, nodes, tasks, account, logout); document.body.prepend(bar);
    const cover = node('section'); cover.className = 'workspace-cover'; cover.hidden = true; document.body.append(cover);
    const panel = node('section'); panel.className = 'workspace-panel'; panel.hidden = true; document.body.append(panel);
    const notice = node('p', '', 'workspaceNotice'); notice.className = 'workspace-error'; notice.setAttribute('role', 'status');
    const errorText = error => ({unauthorized: '登录失效，请重新登录。', forbidden: '当前账号没有这项权限。', membership_revoked: '工作区成员资格已失效。', invalid_credentials: '账号或密码不正确。', invalid_invite: '邀请码无效或已失效。', rate_limited: '请求过于频繁，请稍后重试。', logout_pending: '退出尚未确认，请重试退出。', gateway_unavailable: '节点服务暂不可用。', stale_workspace: '工作区已切换，请重新操作。'})[error && error.code] || '操作未完成，请检查权限和连接后重试。';
    function notify(error) {
      notice.textContent = errorText(error);
      const destination = panel.hidden ? cover : panel.children[0];
      if (destination) destination.append(notice);
    }
    async function act(fn) {try {return await fn();} catch (error) {if (!closed) notify(error);}}
    function clearPanel() {
      if (pendingConfirmation) pendingConfirmation(false);
      panelGeneration++; clearTimeout(timer); timer = null; copySecret = null;
      if (copyButton) copyButton.disabled = true; copyButton = null;
      panel.replaceChildren(); panel.hidden = true; notice.textContent = '';
    }
    function dialog(title) {
      clearPanel(); const body = node('section'); body.className = 'workspace-dialog'; body.setAttribute('role', 'dialog'); body.setAttribute('aria-label', title);
      const heading = node('div'); heading.className = 'workspace-row'; heading.append(node('h2', title));
      button('关闭', clearPanel, heading); body.append(heading); panel.append(body); panel.hidden = false;
      const generation = panelGeneration, workspaceId = state && state.workspace && state.workspace.id;
      return {body, live: () => !closed && !panel.hidden && generation === panelGeneration && workspaceId === (state && state.workspace && state.workspace.id)};
    }
    function field(form, title, id, type = 'text') {
      const label = node('label', title), input = node('input', undefined, id); input.type = type; input.required = true;
      label.append(input); form.append(label); return input;
    }
    function roleOptions(selected) {
      const select = node('select'); select.setAttribute('aria-label', '成员权限');
      for (const [value, text] of Object.entries(roles)) {const option = node('option', text); option.value = value; select.append(option);}
      select.value = selected; return select;
    }
    function confirm(text) {
      if (pendingConfirmation) pendingConfirmation(false);
      if (closed || panel.hidden || !panel.children[0]) return Promise.resolve(false);
      return new Promise(resolve => {
        const box = node('section'); box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-label', '确认操作'); box.append(node('p', text));
        const finish = value => {if (pendingConfirmation !== finish) return; pendingConfirmation = null; box.remove(); resolve(value);};
        pendingConfirmation = finish;
        button('确认操作', () => finish(true), box); button('取消操作', () => finish(false), box);
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
      if (!state || state.generation !== next.generation || !next.workspace || (state.workspace && state.workspace.role !== next.workspace.role)) clearPanel();
      state = next; account.textContent = next.user ? next.user.login : '';
      selector.replaceChildren();
      for (const workspace of next.workspaces || []) {const option = node('option', workspace.name); option.value = workspace.id; selector.append(option);}
      selector.value = next.workspace ? next.workspace.id : ''; selector.disabled = !next.user || !(next.workspaces || []).length;
      role.textContent = next.workspace ? roles[next.workspace.role] || '无权限' : '';
      members.disabled = nodes.disabled = tasks.disabled = !next.workspace || next.status !== 'ready';
      logout.hidden = !next.user && next.status !== 'logout_pending'; logout.textContent = next.status === 'logout_pending' ? '重试退出' : '退出';
      gatedControls(); cover.replaceChildren(); cover.hidden = next.status === 'ready';
      if (cover.hidden) return;
      const body = node('section'); body.className = 'workspace-dialog'; cover.append(body);
      body.append(node('h2', next.status === 'login' ? '登录私有工作区' : 'ChunLACK'));
      if (next.status === 'login') {
        const form = node('form', undefined, 'workspaceLoginForm');
        const login = field(form, '账号', 'workspaceLogin'); login.autocomplete = 'username';
        const password = field(form, '密码', 'workspacePassword', 'password'); password.autocomplete = 'current-password';
        const submit = node('button', '登录'); submit.type = 'submit'; form.append(submit);
        form.onsubmit = async event => {
          event.preventDefault(); const value = password.value; password.value = ''; submit.disabled = true;
          await act(() => client.login(login.value.trim(), value)); if (!closed) submit.disabled = false;
        };
        body.append(form);
        button('使用邀请码', () => openInvite(), body);
        body.append(node('p', '没有账号？请向工作区所有者申请邀请。此页面不会显示或保存模型密钥。'));
      } else if (next.status === 'no_access' || next.status === 'selection') {
        body.append(node('p', next.status === 'selection' ? '成员资格或权限已变化，请重新选择工作区。' : '当前账号没有可访问的工作区，请联系所有者。'));
        for (const workspace of next.workspaces || []) button(workspace.name, () => act(() => client.selectWorkspace(workspace.id)), body);
        button('接受工作区邀请', openInvite, body);
      } else {
        body.append(node('p', next.status === 'logout_pending' ? '连接中断，退出尚未确认。聊天和任务已停止，请重试退出。' : next.status === 'initializing' ? '正在核对登录和成员权限…' : '暂时无法连接，旧工作区内容已隐藏。'));
        if (next.status === 'logout_pending') button('重试退出', () => act(() => client.logout()), body);
      }
    }
    selector.onchange = () => act(() => client.selectWorkspace(selector.value));
    function openInvite() {
      const d = dialog('接受工作区邀请'), form = node('form');
      const code = field(form, '一次性邀请码', 'workspaceInviteCode', 'password'); code.autocomplete = 'off';
      const password = field(form, '新账号密码（已有账号无需填写）', 'workspaceInvitePassword', 'password'); password.required = false; password.autocomplete = 'new-password';
      const submit = node('button', '接受邀请'); submit.type = 'submit'; form.append(submit); d.body.append(form);
      form.onsubmit = async event => {
        event.preventDefault(); const token = code.value.trim(), value = password.value; code.value = password.value = ''; submit.disabled = true;
        await act(() => client.acceptInvite(token, value)); if (d.live()) submit.disabled = false;
      };
    }
    function copyOnce(body, secret, label) {
      if (typeof secret !== 'string' || !secret) {body.append(node('p', '服务未返回一次性凭据，请勿重复操作。')); return;}
      copySecret = secret;
      if (copyButton) {copyButton.disabled = true; copyButton.textContent = '已由新凭据替换';}
      copyButton = button(label, () => act(async () => {
        const value = copySecret; if (!value) return;
        const clipboard = document.defaultView && document.defaultView.navigator && document.defaultView.navigator.clipboard;
        if (!clipboard) throw new Error('clipboard_unavailable');
        await clipboard.writeText(value); copySecret = null; if (copyButton) {copyButton.disabled = true; copyButton.textContent = '已复制';}
        body.append(node('p', '已复制。仅交给对应接入者，不发送到公共频道；关闭面板后不能再次复制。'));
      }), body);
    }
    async function openMembers() {
      if (!state || !state.workspace) return;
      const d = dialog('工作区成员'), workspaceId = state.workspace.id;
      await act(async () => {
        const response = await client.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`);
        if (!d.live()) return;
        for (const member of response.members || []) {
          const row = node('div'); row.className = 'workspace-row'; row.append(node('strong', member.login || member.userId), node('span', roles[member.role] || member.role));
          if (client.can('manage')) {
            const select = roleOptions(member.role); row.append(select);
            button('更新权限', () => act(async () => {await client.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.userId)}`, {method: 'PATCH', body: {role: select.value}}); if (d.live()) await openMembers();}), row);
            button('移除', () => act(async () => {if (!await confirm('移除该成员？正在进行的会话和后续操作将失去访问权限。')) return; await client.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.userId)}`, {method: 'DELETE', body: {}}); if (d.live()) await openMembers();}), row);
          }
          d.body.append(row);
        }
        if (client.can('manage')) {
          const form = node('form'), login = field(form, '邀请账号', 'workspaceNewMember'), select = roleOptions('member'); form.append(select);
          const submit = node('button', '创建一次性邀请'); submit.type = 'submit'; form.append(submit); d.body.append(form);
          form.onsubmit = async event => {event.preventDefault(); submit.disabled = true; await act(async () => {
            const result = await client.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, {method: 'POST', body: {login: login.value.trim(), role: select.value}});
            if (d.live()) copyOnce(d.body, result.token, '复制一次性邀请码');
          }); if (d.live()) submit.disabled = false;};
        }
      });
    }
    async function openNodes() {
      if (!state || !state.workspace) return;
      const d = dialog('协作节点'); d.body.append(node('p', '节点是执行者，不是模型服务。创建节点不代表已接入 Muse 或 dots 自身的 Agent 能力。'));
      await act(async () => {
        const response = await client.request('/api/nodes'); if (!d.live()) return;
        for (const item of response.nodes || []) {
          const row = node('div'); row.className = 'workspace-row'; row.append(node('strong', item.name || item.id), node('span', item.revoked ? '已撤销' : item.paused ? '已暂停' : '已登记'));
          if (client.can('execute') && !item.revoked && !item.paused && Array.isArray(item.capabilities) && item.capabilities.length === 1 && item.capabilities[0] === 'browser.public_read' && Array.isArray(item.scopes) && item.scopes.length === 1 && item.scopes[0] === 'public') {
            const start = button('公开浏览试点', () => act(async () => {
              if (!d.live() || start.disabled || !client.can('execute')) return;
              start.disabled = true;
              try {
                if (!await confirm('向该节点发送 example.com 浏览与截图试点？任务期限五分钟；执行完成不代表已人工验收。') || !d.live()) return;
                const result = await client.request('/api/tasks', {method: 'POST', body: {targetNodeId: item.id}});
                if (!d.live()) return;
                if (typeof result?.task?.taskId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(result.task.taskId)) throw new Error('invalid_task_receipt');
                d.body.append(node('p', '已创建公开浏览试点：' + result.task.taskId));
                button('查看任务进度', openTasks, d.body);
              } finally {if (d.live()) start.disabled = false;}
            }), row);
          }
          if (client.can('manage') && !item.revoked) {
            button(item.paused ? '恢复' : '暂停', () => act(async () => {await client.request(`/api/nodes/${encodeURIComponent(item.id)}/pause`, {method: 'POST', body: {paused: !item.paused}}); if (d.live()) await openNodes();}), row);
            button('撤销', () => act(async () => {if (!await confirm('撤销该节点的后续接入权限？')) return; await client.request(`/api/nodes/${encodeURIComponent(item.id)}`, {method: 'DELETE', body: {}}); if (d.live()) await openNodes();}), row);
          }
          d.body.append(row);
        }
        if (!client.can('manage')) return;
        const form = node('form'), name = field(form, '节点名称', 'workspaceNodeName'), selected = [];
        for (const capability of ['research.retrieve', 'research.verify', 'research.summarize', 'browser.public_read']) {
          const label = node('label', capability), checkbox = node('input'); checkbox.type = 'checkbox'; label.append(checkbox); form.append(label); selected.push({checkbox, capability});
        }
        const submit = node('button', '登记节点'); submit.type = 'submit'; form.append(submit); d.body.append(form);
        form.onsubmit = async event => {event.preventDefault(); submit.disabled = true; await act(async () => {
          const result = await client.request('/api/nodes', {method: 'POST', body: {name: name.value.trim(), capabilities: selected.filter(item => item.checkbox.checked).map(item => item.capability), scopes: ['public']}});
          if (d.live()) copyOnce(d.body, result.pairingCode, '复制一次性配对码');
        }); if (d.live()) submit.disabled = false;};
      });
    }
    async function openTasks() {
      if (!state || !state.workspace) return;
      const d = dialog('任务进度'), list = node('div'); d.body.append(node('p', '“完成”表示执行链已结束，不等于结论已核验或人工验收。取消后的远端任务仍须确认停止或等待租约到期。'), list);
      async function refresh() {
        await act(async () => {
          const response = await client.request('/api/tasks'); if (!d.live()) return; list.replaceChildren();
          for (const [kind, items] of [['local', response.localTasks || []], ['external', response.externalTasks || []]]) for (const task of items) {
            const row = node('div'); row.className = 'workspace-row'; row.append(node('strong', task.taskId), node('span', `${kind === 'local' ? '编排' : '外部节点'} · ${task.state || task.status || '未知'}`));
            if (client.can('cancel', task.createdBy) && !['completed', 'succeeded', 'cancelled', 'failed', 'expired'].includes(task.state || task.status)) button('取消', () => act(async () => {
              if (!await confirm('请求停止该任务及其后续执行？')) return;
              await client.request(`/api/tasks/${encodeURIComponent(task.taskId)}/cancel`, {method: 'POST', body: {kind}}); if (d.live()) await refresh();
            }), row);
            list.append(row);
          }
        });
        if (d.live()) {clearTimeout(timer); timer = setTimeout(refresh, 5000); if (timer.unref) timer.unref();}
      }
      await refresh();
    }
    async function openResearch(id) {
      if (!state || !state.workspace || !client.can('read')) return;
      const d = dialog('研究来源与证据');
      await act(async () => {
        const response = await client.request(`/api/research/session/${encodeURIComponent(id)}`); if (!d.live()) return;
        const session = response.session || response, sources = Array.isArray(session.sources) ? session.sources : [], ids = new Set();
        d.body.append(node('h3', session.topic || '研究结果'));
        if (!sources.length || session.evidenceStatus !== 'verified') d.body.append(node('p', '缺证或尚未核验：不能仅凭 Agent 输出认定结论成立。'));
        for (const source of sources) {
          const section = node('section'); section.className = 'workspace-source'; ids.add(source.sourceId);
          section.append(node('strong', source.sourceId || '未编号来源'));
          let url; try {url = new URL(source.url);} catch (_) {}
          if (url && url.protocol === 'https:' && !url.username && !url.password) {
            const link = node('a', source.url); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; section.append(link);
          } else section.append(node('p', '缺证：来源链接缺失或不安全，不提供可点击链接。'));
          section.append(node('blockquote', source.excerpt || '缺证：未提供原始摘录。')); d.body.append(section);
        }
        for (const claim of Array.isArray(session.claims) ? session.claims : []) {
          const referenced = Array.isArray(claim.sourceIds) ? claim.sourceIds : claim.sourceId ? [claim.sourceId] : [];
          const supported = referenced.length && referenced.every(sourceId => ids.has(sourceId));
          d.body.append(node('p', `${supported ? '待核验' : '缺证'}：${claim.text || claim.claim || '未提供结论'}${referenced.length ? ' [' + referenced.join(', ') + ']' : ''}`));
        }
      });
    }
    function clear() {clearPanel(); cover.replaceChildren(); account.textContent = ''; role.textContent = ''; selector.replaceChildren(); selector.disabled = members.disabled = nodes.disabled = tasks.disabled = true; state = null; gatedControls();}
    function close() {if (closed) return; clear(); closed = true; bar.remove(); cover.remove(); panel.remove(); style.remove();}
    render(client.snapshot());
    return Object.freeze({render, clear, close, notify, openResearch, openMembers, openNodes, openTasks});
  }
  return Object.freeze({mountWorkspaceShell});
});
