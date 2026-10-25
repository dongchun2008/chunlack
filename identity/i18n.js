(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else if (!Object.prototype.hasOwnProperty.call(root, 'ChunLackI18n')) {
    Object.defineProperty(root, 'ChunLackI18n', {value: factory(root)});
  }
})(typeof globalThis === 'object' ? globalThis : this, function(root) {
  'use strict';
  const PREFIX = 'chunlack.ui.locale.v1.';
  const ATTRIBUTES = new Set(['title', 'placeholder', 'aria-label', 'aria-description', 'alt']);
  const PROPERTIES = new Set(['textContent', 'innerText', 'title', 'placeholder']);
  const placeholders = value => Array.from(new Set(Array.from(value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g), match => match[1]))).sort();
  function createI18n(options = {}) {
    const catalogs = Object.create(null), source = options.catalogs || {'zh-CN': {}, en: {}};
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('invalid_locale_catalogs');
    for (const [locale, messages] of Object.entries(source)) {
      if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || !messages || typeof messages !== 'object' || Array.isArray(messages)) {
        throw new TypeError('invalid_locale_catalog');
      }
      const copy = Object.create(null);
      if (Object.keys(messages).length > 8192) throw new RangeError('locale_catalog_too_large');
      for (const [id, text] of Object.entries(messages)) {
        if (!id || id.length > 8192 || typeof text !== 'string' || !text || text.length > 32768) throw new TypeError('invalid_locale_message');
        if (JSON.stringify(placeholders(id)) !== JSON.stringify(placeholders(text))) throw new TypeError('translation_placeholder_mismatch');
        copy[id] = text;
      }
      catalogs[locale] = Object.freeze(copy);
    }
    const supported = Object.freeze(Object.keys(catalogs));
    if (!supported.includes('zh-CN') || !supported.includes('en')) throw new TypeError('required_locales_missing');
    Object.freeze(catalogs);
    const listeners = new Set(), views = new Set(), labels = new WeakMap(), remembered = new Map();
    let userId = null, closed = false;
    function diagnostic(code) {try {if (typeof options.onError === 'function') options.onError(Object.freeze({code}));} catch (_) {}}
    let storage = options.storage;
    if (storage === undefined) {try {storage = root.localStorage || null;} catch (_) {storage = null; diagnostic('locale_storage_unavailable');}}
    const document = options.document || null;
    const events = options.events === undefined ? root : options.events;
    const navigator = options.navigator === undefined ? root.navigator : options.navigator;
    function normalize(value) {
      if (typeof value !== 'string' || value.length > 80) return null;
      const name = value.replace(/_/g, '-').toLowerCase();
      return supported.find(item => item.toLowerCase() === name) ||
        supported.find(item => item.split('-')[0].toLowerCase() === name.split('-')[0]) || null;
    }
    function browserLocale() {
      let preferences = [];
      try {preferences = Array.isArray(navigator?.languages) ? navigator.languages : [navigator?.language];} catch (_) {}
      for (const preference of preferences.slice(0, 20)) {const value = normalize(preference); if (value) return value;}
      return 'zh-CN';
    }
    function key() {return PREFIX + (userId === null ? 'anonymous' : 'user:' + encodeURIComponent(userId));}
    function storedLocale() {
      if (remembered.has(key())) return remembered.get(key());
      try {
        const value = storage?.getItem(key());
        // Only canonical values written by this implementation are persisted preferences.
        if (supported.includes(value)) return value;
      } catch (_) {diagnostic('locale_storage_unavailable');}
      return browserLocale();
    }
    let locale = storedLocale();
    function documentLanguage() {
      try {if (document?.documentElement) document.documentElement.lang = locale;} catch (_) {diagnostic('locale_document_unavailable');}
    }
    function change(value, reason) {
      const previousLocale = locale;
      locale = value; documentLanguage();
      if (previousLocale === locale) return;
      const event = Object.freeze({locale, previousLocale, reason});
      for (const listener of Array.from(listeners)) {
        try {listener(event);} catch (_) {diagnostic('locale_listener_failed');}
      }
    }
    function setLocale(value) {
      const next = normalize(value);
      if (closed || !next) return false;
      remembered.delete(key()); remembered.set(key(), next);
      if (remembered.size > 128) remembered.delete(remembered.keys().next().value);
      try {storage?.setItem(key(), next);} catch (_) {diagnostic('locale_storage_unavailable');}
      change(next, 'selection'); return true;
    }
    function setUser(value) {
      if (closed) return false;
      if (value !== null && (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value))) {
        throw new TypeError('invalid_locale_user');
      }
      if (value === userId) return true;
      userId = value; change(storedLocale(), 'identity'); return true;
    }
    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('locale_listener_required');
      if (!closed) listeners.add(listener);
      return () => listeners.delete(listener);
    }
    function render(value, depth = 0) {
      const descriptor = value && typeof value === 'object' ? labels.get(value) : null;
      if (!descriptor) return String(value == null ? '' : value);
      if (depth > 32) {diagnostic('locale_format_depth'); return descriptor.id;}
      const current = catalogs[locale], fallback = catalogs['zh-CN'];
      const template = Object.hasOwn(current, descriptor.id) ? current[descriptor.id] :
        Object.hasOwn(fallback, descriptor.id) ? fallback[descriptor.id] : descriptor.id;
      return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) =>
        Object.hasOwn(descriptor.params, name) ? render(descriptor.params[name], depth + 1) : whole);
    }
    function ui(id, params = {}) {
      if (typeof id !== 'string' || !id || id.length > 8192 || !params || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('invalid_locale_label');
      const copy = Object.create(null);
      for (const [name, value] of Object.entries(params)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
            (value !== null && typeof value === 'object' && !labels.has(value)) ||
            !['string', 'number', 'boolean', 'object'].includes(typeof value)) throw new TypeError('invalid_locale_parameter');
        copy[name] = value;
      }
      const label = {};
      Object.defineProperties(label, {toString: {value: () => render(label)}, toJSON: {value: () => render(label)}});
      labels.set(label, Object.freeze({id, params: Object.freeze(copy)}));
      return Object.freeze(label);
    }
    function createView() {
      if (closed) throw new Error('locale_controller_closed');
      const bindings = new Set(), slots = new WeakMap();
      let disposed = false;
      function forget(entry) {
        bindings.delete(entry);
        const element = entry.reference.deref();
        if (element) slots.get(element)?.delete(entry.slot);
      }
      function write(element, name, value, attribute) {
        if (attribute) element.setAttribute(name, render(value));
        else element[name] = render(value);
      }
      function assign(element, name, value, attribute) {
        if (disposed) return false;
        if (!element || typeof element !== 'object') throw new TypeError('locale_element_required');
        const slot = (attribute ? 'attribute:' : 'property:') + name;
        const previous = slots.get(element)?.get(slot);
        if (previous) forget(previous);
        for (const entry of bindings) {if (!entry.reference.deref()) forget(entry);}
        if (value && typeof value === 'object' && labels.has(value)) {
          const reference = typeof WeakRef === 'function' ? new WeakRef(element) : {deref: () => element};
          const entry = {reference, name, value, attribute, slot};
          if (!slots.has(element)) slots.set(element, new Map());
          slots.get(element).set(slot, entry); bindings.add(entry);
        }
        write(element, name, value, attribute); return true;
      }
      const unsubscribe = subscribe(() => {
        if (disposed) return;
        for (const entry of bindings) {
          const element = entry.reference.deref();
          if (!element) forget(entry); else write(element, entry.name, entry.value, entry.attribute);
        }
      });
      function release(container) {
        for (const entry of bindings) {
          const element = entry.reference.deref();
          let child = element;
          while (child && child !== container) child = child.parentNode;
          if (!element || child === container) forget(entry);
        }
      }
      function closeView() {if (disposed) return; disposed = true; unsubscribe(); bindings.clear(); views.delete(closeView);}
      views.add(closeView);
      return Object.freeze({
        setText: (element, value) => assign(element, 'textContent', value, false),
        setProperty(element, name, value) {if (!PROPERTIES.has(name)) throw new TypeError('unsafe_locale_property'); return assign(element, name, value, false);},
        setAttribute(element, name, value) {if (!ATTRIBUTES.has(name)) throw new TypeError('unsafe_locale_attribute'); return assign(element, name, value, true);},
        release, close: closeView
      });
    }
    function onStorage(event) {
      if (closed || !event || event.key !== key() || (event.storageArea && event.storageArea !== storage)) return;
      if (event.newValue === null) {remembered.delete(key()); change(browserLocale(), 'storage');}
      else if (supported.includes(event.newValue)) {remembered.set(key(), event.newValue); change(event.newValue, 'storage');}
    }
    let listening = false;
    try {
      if (typeof events?.addEventListener === 'function' && typeof events?.removeEventListener === 'function') {
        events.addEventListener('storage', onStorage); listening = true;
      }
    } catch (_) {diagnostic('locale_event_target_unavailable');}
    documentLanguage();
    function close() {
      if (closed) return;
      closed = true;
      if (listening) {try {events.removeEventListener('storage', onStorage);} catch (_) {}}
      for (const closeView of Array.from(views)) closeView();
      listeners.clear(); remembered.clear();
    }
    return Object.freeze({getLocale: () => locale, supportedLocales: () => supported,
      setLocale, setUser, subscribe, ui, text: render, createView, close});
  }
  return Object.freeze({createI18n});
});
