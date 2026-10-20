'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const cheerio = require('cheerio');
const {normalizeSearchResultUrl} = require('../gateway/research-search.cjs');
const root = path.resolve(__dirname, '..');
const base = 'https://html.duckduckgo.com/html/?q=fixture';
const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c',
  'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()["SERVER_JS"]))'
], {cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024}));
function block(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'Generated search source boundaries');
  return source.slice(from, to);
}
const searchSource = block('// ==================== SEARCH PROVIDERS ====================', '// ==================== REVERSE');
function parser(html, lite = '', fail = false) {
  const requests = [];
  const context = vm.createContext({
    config: {searchProvider: 'duckduckgo'}, cheerio,
    async axiosWithRetry(options) {
      requests.push(options.url);
      if (fail) throw new Error('Fixture transport unavailable');
      return {data: options.url.includes('html.duckduckgo.com') ? html : lite};
    },
    require(name) {
      assert.equal(name, './gateway/research-search.cjs');
      return {normalizeSearchResultUrl};
    },
    logError() {}
  });
  return {search: vm.runInContext(searchSource + '\nperformSearch', context), requests};
}
const accepted = [
  ['protocol-relative redirect', '//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.iana.org%2Fhelp%2Fexample-domains&rut=tracking', 'https://www.iana.org/help/example-domains'],
  ['root-relative redirect', '/l/?uddg=https%3A%2F%2Fexample.org%2Fa%3Fq%3Done%26lang%3Den', 'https://example.org/a?q=one&lang=en'],
  ['absolute redirect', 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa', 'https://example.org/a'],
  ['one decoding step', '/l/?uddg=https%3A%2F%2Fexample.org%2Fa%253Fb', 'https://example.org/a%3Fb'],
  ['query is preserved', 'https://example.org/a?q=a%2Fb&lang=en#section', 'https://example.org/a?q=a%2Fb&lang=en#section'],
  ['direct protocol-relative source', '//example.org/article', 'https://example.org/article'],
  ['direct HTTP compatibility', 'http://example.org/article', 'http://example.org/article'],
  ['public IPv4', 'https://9.9.9.9/article', 'https://9.9.9.9/article'],
  ['public IPv6', 'https://[2606:4700:4700::1111]/article', 'https://[2606:4700:4700::1111]/article'],
  ['lookalike host is not unwrapped', 'https://duckduckgo.com.example.org/l/?uddg=https%3A%2F%2Fexample.org%2Fa', 'https://duckduckgo.com.example.org/l/?uddg=https%3A%2F%2Fexample.org%2Fa']
];
for (const [name, value, expected] of accepted) test('search URL preserves ' + name, () => {
  assert.equal(normalizeSearchResultUrl(value, base), expected);
});
const denied = [
  null, '', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/plain,fixture',
  'https://user:password@example.org/a', 'https://example.org/a\nb',
  'https://duckduckgo.com/', '/settings', '/l/', '/l/?uddg=',
  '/l/?uddg=https%3A%2F%2Fexample.org%2Fa&uddg=https%3A%2F%2Fexample.net%2Fb',
  '/l/?uddg=%25', '/l/?uddg=%2F%2Fexample.org%2Fa',
  '/l/?uddg=javascript%3Aalert(1)', '/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fl%2F%3Fuddg%3Dx',
  'http://localhost/a', 'http://LOCALHOST./a', 'http://sub.localhost/a', 'http://printer.local/a',
  'http://intranet/a', 'http://127.1/a', 'http://2130706433/a', 'http://0x7f000001/a',
  'http://10.1.2.3/a', 'http://172.16.0.1/a', 'http://192.168.1.1/a',
  'http://169.254.169.254/a', 'http://100.64.0.1/a', 'http://0.0.0.0/a',
  'http://[::1]/a', 'http://[fc00::1]/a', 'http://[fe80::1]/a', 'http://[::ffff:127.0.0.1]/a',
  '/l/?uddg=http%3A%2F%2F127.0.0.1%2Fa', '/l/?uddg=https%3A%2F%2Fuser%3Apassword%40example.org%2Fa'
];
for (const [index, value] of denied.entries()) test('search URL rejects unsafe or non-source candidate ' + index, () => {
  assert.equal(normalizeSearchResultUrl(value, base), null);
});
const first = '<a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.iana.org%2Fhelp%2Fexample-domains%3Fa&amp;rut=one">IANA</a>';
const second = '<a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.iana.org%2Fhelp%2Fexample-domains&amp;rut=two">IANA</a>';
test('actual generated HTML search returns original sources rather than duplicated DuckDuckGo origins', async () => {
  const p = parser(first + second);
  assert.deepEqual(Array.from(await p.search('IANA example domains', 3)), [
    'https://www.iana.org/help/example-domains?a', 'https://www.iana.org/help/example-domains'
  ]);
  assert.equal(p.requests.length, 1);
});
test('actual generated search deduplicates decoded destinations before enforcing the result limit', async () => {
  const p = parser(first + first.replace('rut=one', 'rut=other') + second);
  assert.deepEqual(Array.from(await p.search('fixture', 2)), [
    'https://www.iana.org/help/example-domains?a', 'https://www.iana.org/help/example-domains'
  ]);
});
test('actual generated lite fallback normalizes relative redirects and ignores navigation and private targets', async () => {
  const p = parser('<html><body>No results</body></html>',
    '<a href="https://duckduckgo.com/">home</a><a href="http://127.0.0.1/a">private</a>' +
    '<a href="/l/?uddg=https%3A%2F%2Fexample.org%2Fa">source</a><a href="//example.net/b">source two</a>');
  assert.deepEqual(Array.from(await p.search('fixture', 3)), ['https://example.org/a', 'https://example.net/b']);
  assert.equal(p.requests.length, 2);
});
test('HTML rejects a wrapped private destination before returning valid public sources', async () => {
  const p = parser('<a class="result__url" href="/l/?uddg=http%3A%2F%2F169.254.169.254%2Fa">private</a>' + second);
  assert.deepEqual(Array.from(await p.search('fixture', 3)), ['https://www.iana.org/help/example-domains']);
});
test('empty HTML and lite results remain empty without invented sources', async () => {
  const p = parser('<html>No results</html>', '<html>No results</html>');
  assert.deepEqual(Array.from(await p.search('fixture', 3)), []);
  assert.equal(p.requests.length, 2);
});
test('transport errors remain empty rather than manufacturing sources', async () => {
  const p = parser('', '', true);
  assert.deepEqual(Array.from(await p.search('fixture', 3)), []);
  assert.equal(p.requests.length, 2);
});
test('materialized runtime includes the source parser and its existing address validator', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-search-package-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  execFileSync(process.env.PYTHON || 'python', [path.join(root, 'scripts/materialize.py'), '--output', dir], {cwd: root, stdio: 'pipe'});
  const copy = require(path.join(dir, 'gateway/research-search.cjs'));
  assert.equal(copy.normalizeSearchResultUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa', base), 'https://example.org/a');
  assert.equal(copy.normalizeSearchResultUrl('http://127.0.0.1/a', base), null);
});
