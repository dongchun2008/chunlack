'use strict';
// A unit DOM deliberately forbids HTML parsing. Real browser/layout acceptance
// is a separate gate; this checks text rendering and menu behavior, not pixels.
class Element {
  constructor(tag) {this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.attributes = {};}
  set innerHTML(value) {throw new Error('Dynamic HTML must not be used by the workspace shell');}
  append(...nodes) {for (const node of nodes) {this.children.push(node); node.parentNode = this;}}
  prepend(node) {this.children.unshift(node); node.parentNode = this;}
  replaceChildren(...nodes) {this.children = []; this.append(...nodes); this.textContent = '';}
  setAttribute(key, value) {this.attributes[key] = String(value);}
  remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);}
  focus() {}
}
function documentFixture() {
  const body = new Element('body'), head = new Element('head');
  const walk = root => [root, ...root.children.flatMap(walk)];
  const document = {body, head, createElement: tag => new Element(tag), getElementById: id => walk(body).find(node => node.id === id), defaultView: {confirm: () => true, navigator: {clipboard: {writeText: async () => {}}}}};
  for (const id of ['messageInput', 'sendBtn', 'studioSpawnBtn', 'groundBtn', 'moderatorBtn', 'fileInput', 'sendThreadReply']) {const node = new Element('button'); node.id = id; body.append(node);}
  return {document, walk: () => walk(body)};
}

module.exports = {documentFixture};
