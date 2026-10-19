/**
 * Zero-dependency verification for dsh-quick-fork.
 *
 * Run with `node scripts/check.mjs`. The browser module is loaded with a
 * DOM-shaped sandbox; tests cover the factories, parameter parsing, transcript
 * mapping and the selection gate.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const manifest = JSON.parse(read('package.json'))
const clientSource = read('client.js')

let checks = 0
async function check(name, body) {
  try { await body(); checks += 1; console.log('ok ' + name) }
  catch (error) { console.error('FAIL ' + name); console.error('     ' + (error?.message ?? error)); process.exitCode = 1 }
}

/** Load the factory with a minimal DOM/localStorage sandbox. */
function load() {
  const storage = new Map()
  let loaded
  const sandbox = {
    window: { __ModuleLoader__: { load(definition) { loaded = definition } }, addEventListener() {}, removeEventListener() {} },
    document: {
      addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] },
      createElement() { return { dataset: {}, appendChild() {}, remove() {} } }, head: { appendChild() {} },
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    console,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  const plugin = loaded.factory((id) => {
    if (id === 'react') return { createElement: () => null, useEffect() {}, useMemo: (fn) => fn(), useRef: () => ({}), useState: (value) => [value, () => {}] }
    if (id === 'react-dom') return { createPortal: (element) => element }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null }
    throw new Error('unexpected require ' + id)
  })
  return { plugin, storage }
}

await check('manifest declares a DSH bundle and web client half', () => {
  assert.equal(manifest.name, 'dsh-quick-fork')
  assert.equal(manifest.version, '0.2.0')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'))
  assert.equal(manifest.scripts.check, 'node scripts/check.mjs')
})

await check('all manifest files exist on disk', () => {
  for (const relative of [
    manifest.main, 'client.js', manifest.dsh.bundle.patch,
    'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'README.en.md',
    'CHANGELOG.md', 'LICENSE',
  ]) assert(fs.existsSync(path.join(ROOT, relative)), relative + ' exists')
})

await check('bundle patch inserts exactly one quick-fork row', () => {
  const patch = read('cordis.patch.yml')
  assert(patch.includes('- insert:'))
  assert(patch.includes('id: quick-fork'))
  assert(patch.includes("name: 'dsh-quick-fork'"))
  assert.equal((patch.match(/- insert:/g) ?? []).length, 1)
})

await check('client requires only frozen React modules', () => {
  const requires = [...clientSource.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1])
  assert.deepEqual(requires.sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react-dom'].sort())
})

await check('locale files carry title and description', () => {
  for (const locale of ['zh', 'en']) {
    const value = JSON.parse(read('locale/' + locale + '.json'))
    assert.equal(typeof value.meta.title, 'string')
    assert.equal(typeof value.meta.description, 'string')
  }
})

await check('icon is a valid accent SVG', () => {
  const icon = read('icon.svg')
  assert(icon.includes('<svg'))
  assert(icon.includes('#4D6BFE'))
})

await check('sidebar tab params are parsed defensively', () => {
  const { plugin } = load()
  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.__test.parseForkParams({ parentSessionId: 's1', quote: 'why?' }))),
    { parentSessionId: 's1', quote: 'why?' },
  )
  assert.equal(plugin.__test.parseForkParams(null), null)
  assert.equal(plugin.__test.parseForkParams({ quote: 'x' }), null)
  assert.equal(plugin.__test.parseForkParams({ parentSessionId: '' }), null)
})

await check('durable nodes become simple side-chat rows', () => {
  const { plugin } = load()
  const rows = plugin.__test.nodesToMessages({
    nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'hello' }] },
      { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: 'hi' }, { kind: 'reasoning', text: 'think' }] },
      { kind: 'tool-result', seq: 3, content: [{ type: 'text', text: 'tool output' }] },
      { kind: 'turn-error', seq: 4, message: 'boom' },
    ],
  })
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { key: 'u1', role: 'user', text: 'hello' },
    { key: 'a2', role: 'assistant', text: 'hi' },
    { key: 't3', role: 'tool', text: 'tool output' },
    { key: 'e4', role: 'error', text: 'boom' },
  ])
})

await check('tab definition is multi-instance and has a title', () => {
  const { plugin } = load()
  const definition = plugin.__test.tabDefinitionFor((key) => key)
  assert.equal(definition.id, 'dsh-quick-fork')
  assert.equal(definition.kind, 'quick-fork')
  assert.equal(definition.multiple, true)
  assert.equal(definition.title(), 'tab.title')
})

await check('the selected passage is included in the first prompt only', () => {
  const { plugin } = load()
  assert.equal(plugin.__test.composePrompt('why?', 'line one\nline two', false), '> line one\n> line two\n\nwhy?')
  assert.equal(plugin.__test.composePrompt('why?', 'line one', true), 'why?')
  assert.equal(plugin.__test.composePrompt('why?', '   ', false), 'why?')
})

await check('selection gate rejects panel selections and temp children', () => {
  const { plugin, storage } = load()
  storage.set('dsh.quickFork.children', JSON.stringify(['child-1']))
  assert.equal(plugin.__test.canOfferFork({ text: 'x', parentSessionId: 'parent', inPanel: false }), true)
  assert.equal(plugin.__test.canOfferFork({ text: '   ', parentSessionId: 'parent', inPanel: false }), false)
  assert.equal(plugin.__test.canOfferFork({ text: 'x', parentSessionId: 'child-1', inPanel: false }), false)
  assert.equal(plugin.__test.canOfferFork({ text: 'x', parentSessionId: 'parent', inPanel: true }), false)
})

await check('factory exposes apply and the expected injected services', () => {
  const { plugin } = load()
  assert.equal(typeof plugin.apply, 'function')
  assert(plugin.inject.includes('sessions'))
  assert(plugin.inject.includes('slots'))
  assert(plugin.inject.includes('locale'))
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
