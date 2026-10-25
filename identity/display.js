(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else Object.defineProperty(root, 'ChunLackDisplay', {value: factory(root)});
})(typeof globalThis === 'object' ? globalThis : this, function(root) {
  'use strict';
  function createDisplay(options = {}) {
    const document = options.document, window = options.window || root;
    const engine = options.engine || root.ChunLackI18n;
    const helpModule = options.help || root.ChunLackHelp;
    const profile = options.profile || 'workspace';
    if (!['workspace', 'legacy', 'login'].includes(profile) || !document || !engine?.createI18n) throw new TypeError('invalid_display_environment');
    const catalogs = {'zh-CN': Object.create(null), en: Object.create(null)};
    for (const pack of [options.messages || root.ChunLackMessages, options.chatMessages || root.ChunLackChatMessages, helpModule?.catalogs]) {
      if (!pack) continue;
      for (const locale of Object.keys(catalogs)) Object.assign(catalogs[locale], pack[locale] || {});
    }
    let storage = null;
    try {storage = options.storage === undefined ? window.localStorage : options.storage;} catch (_) {}
    const i18n = engine.createI18n({catalogs, document, storage, navigator: options.navigator || window.navigator, events: window});
    const view = i18n.createView();
    let disposed = false, help = null;
    const fetch = options.fetch;
    if (helpModule?.createHelp && typeof fetch === 'function') help = helpModule.createHelp({document, i18n, fetch});
    const picker = document.getElementById('interfaceLanguage');
    const change = () => {if (!disposed && picker) i18n.setLocale(picker.value);};
    if (picker) {picker.value = i18n.getLocale(); picker.hidden = profile !== 'legacy'; picker.addEventListener('change', change);}
    const unsubscribe = i18n.subscribe(() => {if (!disposed && picker) picker.value = i18n.getLocale();});
    function set(node, property, value) {
      if (!disposed && node) view.setProperty(node, property, value);
      return value;
    }
    function attribute(node, name, value) {if (!disposed && node) view.setAttribute(node, name, value); return value;}
    function bind(container) {
      if (disposed || !container) return;
      const nodes = [container, ...Array.from(container.querySelectorAll?.('[data-i18n],[data-i18n-nodes],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label],[data-i18n-alt]') || [])];
      for (const node of nodes) {
        const get = name => node.getAttribute?.(name);
        const id = get('data-i18n');
        let params = {};
        try {
          const encoded = get('data-i18n-params');
          if (encoded) {
            const parsed = JSON.parse(encoded);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.values(parsed).every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value))) params = parsed;
          }
        } catch (_) {}
        if (id) set(node, 'textContent', i18n.ui(id, params));
        for (const name of ['title', 'placeholder', 'aria-label', 'alt']) {
          const label = get('data-i18n-' + name);
          if (label) attribute(node, name, i18n.ui(label, params));
        }
        const textNodes = get('data-i18n-nodes');
        if (textNodes) {
          try {
            const entries = JSON.parse(textNodes);
            if (Array.isArray(entries)) for (const entry of entries) {
              if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 0 || typeof entry[1] !== 'string') continue;
              const child = node.childNodes?.[entry[0]];
              if (child?.nodeType === 3) view.setText(child, i18n.ui(entry[1]));
            }
          } catch (_) {}
        }
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true; help?.dispose(); unsubscribe();
      picker?.removeEventListener('change', change); view.close(); i18n.close();
    }
    return Object.freeze({i18n, view, ui: (id, params) => i18n.ui(id, params), text: value => i18n.text(value), set, attribute, bind,
      release: node => {if (!disposed && node) view.release(node);},
      setUser: user => !disposed && i18n.setUser(user),
      openHelp: () => !disposed && !!help && help.open({profile}), closeHelp: () => help?.close(), dispose});
  }
  return Object.freeze({createDisplay});
});
