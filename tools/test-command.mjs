// End-to-end test of the quit command handler over a real IPC channel, plus the
// configurable-command-name behaviour (default name, custom name, format
// refusal, global conflict refusal, and volatile hot-swap).
//
// Forks a child that loads the real plugin, registers the command and invokes
// the handler. In "desktop" mode the child must send exactly one
// `{ type: "quit-request" }` to its parent and report success; without the shell
// marker it must send nothing and report a clear error.
//
// The plugin imports `@deepseek-ai/schemastery`, a platform package DSH
// resolves for plugins at runtime. Outside DSH nothing resolves it, so when the
// plugin has no local copy the test extracts the two vendored packages from the
// desktop `app.asar` and resolves them for the child only. Point DSH_APP_ASAR at
// your install (see tools/dsh-paths.mjs) if discovery cannot find it.
import { fork } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire, registerHooks } from 'node:module'

const pluginPath = fileURLToPath(new URL('../lib/index.js', import.meta.url))

// ---------------------------------------------------------------------------
// Vendored platform packages, so this test also runs outside a DSH process.
// ---------------------------------------------------------------------------
const VENDORED = {
  '@deepseek-ai/schemastery': 'lib/index.mjs',
  '@deepseek-ai/cosmokit': 'lib/index.js'
}

/** The resolver this process and the child install, mapping platform packages to extracted files. */
function makeVendorHook(files) {
  return {
    resolve(specifier, context, nextResolve) {
      const target = files[specifier]
      if (target === undefined) return nextResolve(specifier, context)
      return { url: pathToFileURL(target).href, shortCircuit: true }
    }
  }
}

/** Whether the plugin resolves a package the ordinary way. */
function resolvesNatively(name) {
  try {
    createRequire(pluginPath).resolve(name)
    return true
  } catch {
    return false
  }
}

/** Read one entry's bytes out of an Electron ASAR archive. */
function asarEntry(archive, entryPath) {
  const fd = fs.openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const raw = Buffer.alloc(headerSize)
    fs.readSync(fd, raw, 0, headerSize, 16)
    const text = raw.toString('utf8')
    const header = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    let node = header
    for (const part of entryPath.split('/')) {
      node = node?.files?.[part]
      if (node === undefined) throw new Error(`app.asar has no entry ${entryPath}`)
    }
    const size = Number(node.size ?? 0)
    const offset = Number(node.offset ?? 0)
    const content = Buffer.alloc(size)
    fs.readSync(fd, content, 0, size, 8 + headerSize + offset)
    return content
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Materialize the platform packages the plugin needs, unless it already has them.
 * @returns `{ root, files }`; both empty when the plugin resolves them itself.
 */
async function prepareVendored() {
  const names = Object.keys(VENDORED)
  if (names.every(resolvesNatively)) return { root: '', files: {} }
  let archive
  try {
    const { resolveAppAsar } = await import('./dsh-paths.mjs')
    archive = resolveAppAsar()
  } catch (error) {
    throw new Error(
      `this test loads the plugin, which needs ${names.join(' and ')}, but neither is installed beside the plugin and the desktop app.asar could not be found automatically (${error instanceof Error ? error.message : String(error)}).\n` +
        'Point DSH_APP_ASAR at your installation\'s resources/app.asar, then run this test again. For example:\n' +
        '  PowerShell:  $env:DSH_APP_ASAR = \'C:\\path\\to\\DeepSeek Harness\\resources\\app.asar\'; node tools\\test-command.mjs\n' +
        '  cmd.exe:     set DSH_APP_ASAR=C:\\path\\to\\DeepSeek Harness\\resources\\app.asar && node tools\\test-command.mjs'
    )
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-vendor-'))
  const files = {}
  for (const [name, entry] of Object.entries(VENDORED)) {
    for (const file of ['package.json', entry]) {
      const relative = `${name}/${file}`
      const target = path.join(root, 'node_modules', ...relative.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, asarEntry(archive, `dsh/node_modules/${relative}`))
    }
    files[name] = path.join(root, 'node_modules', ...`${name}/${entry}`.split('/'))
  }
  return { root, files }
}

const vendor = await prepareVendored()

// The parent imports the same plugin for the pure-helper checks, so it installs
// the same resolution the child gets.
if (vendor.root !== '') registerHooks(makeVendorHook(vendor.files))

const childSource = `
import { pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The terminal half of the plugin keeps its state under the user's home unless
// it is told otherwise, and would otherwise start a real listener here. Both
// are redirected into a scratch directory, and the transport is pinned to the
// loopback fallback because a confined environment cannot create a named pipe.
process.env.DSH_COMMAND_QUIT_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-cmd-state-'))
process.env.DSH_COMMAND_QUIT_TRANSPORT = 'tcp'
const stateDir = process.env.DSH_COMMAND_QUIT_STATE

const [pluginPath, scenarioJson, filesJson] = process.argv.slice(2)
const scenario = JSON.parse(scenarioJson)
const makeVendorHook = ${makeVendorHook.toString()}

const files = JSON.parse(filesJson)
if (Object.keys(files).length > 0) registerHooks(makeVendorHook(files))

if (scenario.desktop) process.env.DSH_DESKTOP_QUIT_REQUEST = '1'
else delete process.env.DSH_DESKTOP_QUIT_REQUEST

const plugin = await import(pathToFileURL(pluginPath).href)

const listeners = new Map()
const warnings = []
const errors = []
const notices = []
const registered = new Map()
const disposals = []
const taken = new Map((scenario.taken === undefined ? [] : scenario.taken).map((item) => [item.name, item]))
// Commands DSH keeps in an agent scope: invisible to a global-only lookup, and
// shadowing a global registration of the same name inside that scope.
const scopedTaken = new Map()
for (const item of scenario.scopedTaken === undefined ? [] : scenario.scopedTaken) {
  const layer = scopedTaken.get(item.scope) === undefined ? new Map() : scopedTaken.get(item.scope)
  layer.set(item.name, item)
  scopedTaken.set(item.scope, layer)
}

let currentName = scenario.name

const commands = {
  // The registry own layers, the way dsh-scope exposes them.
  layers: { scoped: new Map([...scopedTaken.keys()].map((key) => [key, {}])) },
  register(definition) {
    if (taken.has(definition.name)) {
      throw new Error('command "' + definition.name + '" is already registered (for a per-agent variant, mount a command-injected plugin under that agent\\'s \\\`agent.ctx\\\`)')
    }
    if (registered.has(definition.name)) throw new Error('duplicate registration in the fake registry')
    registered.set(definition.name, definition)
    return () => { registered.delete(definition.name) }
  },
  find(agent, name) {
    if (agent !== undefined) {
      const layer = scopedTaken.get(agent)
      if (layer !== undefined && layer.has(name)) return layer.get(name)
    }
    const other = taken.get(name)
    if (other !== undefined) return other
    // DSH's lookup falls back to the global layer, and the global layer holds
    // this plugin's own registration: the plugin recognises itself by its
    // description, which is what keeps its own name from reading as a conflict.
    const mine = registered.get(name)
    return mine === undefined ? undefined : { name: mine.name, description: mine.description }
  },
  list(agent) {
    const merged = new Map(taken)
    if (agent !== undefined) for (const [name, item] of scopedTaken.get(agent) === undefined ? [] : scopedTaken.get(agent)) merged.set(name, item)
    for (const definition of registered.values()) merged.set(definition.name, { name: definition.name, description: definition.description })
    return [...merged.values()]
  }
}

const ctx = {
  commands,
  fiber: {},
  logger: {
    warn: (message) => warnings.push(String(message)),
    error: (message) => errors.push(String(message)),
    info() {},
    debug() {}
  },
  on(name, listener) {
    const list = listeners.get(name) === undefined ? [] : listeners.get(name)
    list.push(listener)
    listeners.set(name, list)
    return () => {
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    }
  },
  effect(callback) {
    if (typeof callback === 'function' && callback.length === 0 && !callback.constructor.name.includes('Generator')) {
      const dispose = callback()
      if (typeof dispose === 'function') disposals.push(dispose)
      return dispose === undefined ? () => {} : dispose
    }
    return () => {}
  },
  inject(_deps, callback) {
    callback({
      effect: (inner) => { inner(); return () => {} },
      settings: {
        configure: () => () => {},
        update: (ns, patch) => {
          notices.push({ ns, patch })
          return Promise.resolve()
        }
      }
    })
  }
}

let currentNotice = scenario.notice === undefined ? '' : scenario.notice
let currentTerminalName = scenario.terminalName === undefined ? 'quit-dsh' : scenario.terminalName
let currentTerminalEnabled = scenario.terminalEnabled === undefined ? true : scenario.terminalEnabled
const config = {
  commandName: {
    get: () => currentName
  },
  terminalName: {
    get: () => currentTerminalName
  },
  terminalEnabled: {
    get: () => currentTerminalEnabled
  },
  notice: {
    get: () => currentNotice
  }
}

plugin.apply(ctx, config)

const definitionOfCurrent = registered.get(currentName) === undefined ? [...registered.values()][0] : registered.get(currentName)
const command = definitionOfCurrent === undefined ? undefined : definitionOfCurrent.name

let result
if (definitionOfCurrent !== undefined) {
  result = await definitionOfCurrent.handler({
    commandId: 'test',
    agent: { id: 'session-test' },
    rawInput: '',
    attachments: [],
    signal: new AbortController().signal
  })
}

const report = {
  name: plugin.name,
  inject: plugin.inject,
  stateDir,
  command,
  registrations: [...registered.keys()],
  description: definitionOfCurrent === undefined ? undefined : definitionOfCurrent.description,
  definitionId: definitionOfCurrent === undefined ? undefined : definitionOfCurrent.definitionId,
  hasInputDescriptor: definitionOfCurrent === undefined ? undefined : 'input' in definitionOfCurrent,
  warnings,
  errors,
  notices,
  result
}

if (scenario.hotSwap !== undefined) {
  const before = [...registered.keys()]
  currentName = scenario.hotSwap
  for (const listener of listeners.get('loader/volatile-update') === undefined ? [] : listeners.get('loader/volatile-update')) listener()
  report.hotSwapFrom = before
  report.hotSwapTo = [...registered.keys()]
}

if (scenario.guard !== undefined) {
  const guards = listeners.get('internal/config') === undefined ? [] : listeners.get('internal/config')
  report.guardCount = guards.length
  try {
    guards[0].call(ctx.fiber, scenario.guard, () => scenario.guard)
    report.guardVerdict = 'accepted'
  } catch (error) {
    report.guardVerdict = 'blocked'
    report.guardMessage = error.message
  }
  report.foreignFiberVerdict = (() => {
    try {
      guards[0].call({}, scenario.guard, () => scenario.guard)
      return 'accepted'
    } catch (error) {
      return 'blocked'
    }
  })()
  report.ownEntryVerdict = (() => {
    try {
      guards[0].call({ entry: { options: { id: 'command-quit' } } }, scenario.guard, () => scenario.guard)
      return 'accepted'
    } catch (error) {
      return 'blocked'
    }
  })()
  const foreign = { commandName: 'Quit!' }
  report.otherEntryVerdict = (() => {
    try {
      guards[0].call({ entry: { options: { id: 'some-other-entry' } } }, foreign, () => foreign)
      return 'accepted'
    } catch (error) {
      return 'blocked'
    }
  })()
}

// A rival that only appears while a session runs: the scope did not exist when
// the name was saved, so only the registry's own change signal can see it.
if (scenario.shadowAfter !== undefined) {
  const before = [...registered.keys()]
  for (const item of scenario.shadowAfter) {
    const layer = scopedTaken.get(item.scope) === undefined ? new Map() : scopedTaken.get(item.scope)
    layer.set(item.name, item)
    scopedTaken.set(item.scope, layer)
    commands.layers.scoped.set(item.scope, {})
  }
  for (const listener of listeners.get('commands/change') === undefined ? [] : listeners.get('commands/change')) listener()
  report.beforeShadow = before
  report.afterShadow = [...registered.keys()]
  report.shadowNotices = notices.slice()
  report.shadowErrors = errors.slice()
}

process.send?.(report)
`

const childPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-test-')), 'child.mjs')
fs.writeFileSync(childPath, childSource)

function run(scenario) {
  return new Promise((resolve, reject) => {
    // `pathPrefix` lets one scenario put a directory in front of the child's
    // PATH, which is how a name that collides with someone else's command is
    // reproduced without depending on what happens to be installed.
    const env = { ...process.env }
    if (typeof scenario.pathPrefix === 'string' && scenario.pathPrefix.length > 0) {
      env.PATH = scenario.pathPrefix + path.delimiter + (env.PATH ?? '')
      env.Path = env.PATH
    }
    const child = fork(childPath, [pluginPath, JSON.stringify(scenario), JSON.stringify(vendor.files)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env })
    const messages = []
    child.on('message', (message) => messages.push(message))
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, messages }))
  })
}

let failures = 0
function check(label, condition, detail) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label + (detail === undefined ? '' : '  -> ' + detail))
  if (!condition) failures++
}

// ---------------------------------------------------------------------------
// Desktop shell: default name, one IPC quit-request, success.
// ---------------------------------------------------------------------------
const desktop = await run({ desktop: true })
const desktopReport = desktop.messages.find((m) => m && m.command !== undefined)
const desktopControl = desktop.messages.filter((m) => m && m.type === 'quit-request')
console.log('desktop report:', JSON.stringify(desktopReport))
check('desktop child exits 0', desktop.code === 0, String(desktop.code))
check('desktop sent exactly one quit-request', desktopControl.length === 1, JSON.stringify(desktopControl))
check('quit-request has no extra fields', JSON.stringify(desktopControl[0]) === '{"type":"quit-request"}', JSON.stringify(desktopControl[0]))
check('default command name is quit-dsh', desktopReport?.command === 'quit-dsh', String(desktopReport?.command))
check('handler reports success', desktopReport?.result?.kind === 'success', JSON.stringify(desktopReport?.result))
check('plugin injects the commands service', JSON.stringify(desktopReport?.inject) === '["commands"]', JSON.stringify(desktopReport?.inject))
check('bare command has no input descriptor', desktopReport?.hasInputDescriptor === false, String(desktopReport?.hasInputDescriptor))
check(
  'registration carries the stable definition identity',
  desktopReport?.definitionId === 'dsh-command-quit',
  String(desktopReport?.definitionId)
)

// ---------------------------------------------------------------------------
// No shell channel: no IPC traffic, a clear error instead.
// ---------------------------------------------------------------------------
const web = await run({})
const webReport = web.messages.find((m) => m && m.command !== undefined)
const webControl = web.messages.filter((m) => m && m.type !== undefined)
console.log('web report    :', JSON.stringify(webReport))
check('web child exits 0', web.code === 0, String(web.code))
check('web sends no quit-request', webControl.length === 0, JSON.stringify(webControl))
check('web handler reports a clear error', webReport?.result?.kind === 'error', JSON.stringify(webReport?.result))
check('web error names the active command', typeof webReport?.result?.text === 'string' && webReport.result.text.includes('/quit-dsh'), String(webReport?.result?.text))

// ---------------------------------------------------------------------------
// A configured name replaces the default; only that one command is registered.
// ---------------------------------------------------------------------------
const custom = await run({ name: 'qd' })
const customReport = custom.messages.find((m) => m && m.command !== undefined)
check('configured name is registered', customReport?.command === 'qd', String(customReport?.command))
check('exactly one command is registered', JSON.stringify(customReport?.registrations) === '["qd"]', JSON.stringify(customReport?.registrations))

// ---------------------------------------------------------------------------
// A conflicting name is refused: the default takes over, the clash is logged.
// ---------------------------------------------------------------------------
const conflict = await run({ name: 'compact', taken: [{ name: 'compact', description: 'Compact older conversation history' }] })
const conflictReport = conflict.messages.find((m) => m && m.registrations !== undefined)
check('a globally taken name falls back to the default', JSON.stringify(conflictReport?.registrations) === '["quit-dsh"]', JSON.stringify(conflictReport?.registrations))
check('conflict is reported with the other owner', (conflictReport?.errors ?? []).some((line) => line.includes('compact') && line.includes('占用')), JSON.stringify(conflictReport?.errors))

// A name DSH keeps inside an agent scope is taken too, even though the global
// layer does not know it.
const scoped = [{ scope: 'session-1', name: 'compact', description: 'Compact older conversation history' }]
const scopedConflict = await run({ name: 'compact', scopedTaken: scoped })
const scopedReport = scopedConflict.messages.find((m) => m && m.registrations !== undefined)
check('a scope-only taken name falls back to the default', JSON.stringify(scopedReport?.registrations) === '["quit-dsh"]', JSON.stringify(scopedReport?.registrations))
check('scope collision is reported', (scopedReport?.errors ?? []).some((line) => line.includes('compact') && line.includes('占用')), JSON.stringify(scopedReport?.errors))

// ---------------------------------------------------------------------------
// The save guard: invalid names and taken names are blocked before a write.
// ---------------------------------------------------------------------------
const formatGuard = await run({ guard: { commandName: 'Quit!' } })
const formatReport = formatGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard blocks an illegal name', formatReport?.guardVerdict === 'blocked', String(formatReport?.guardMessage))
check('save guard ignores other fibers', formatReport?.foreignFiberVerdict === 'accepted', String(formatReport?.foreignFiberVerdict))

const illegalGuard = await run({ guard: { commandName: '2fast' } })
const illegalReport = illegalGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard blocks a leading digit', illegalReport?.guardVerdict === 'blocked', String(illegalReport?.guardMessage))

const chineseGuard = await run({ guard: { commandName: '退出' } })
const chineseReport = chineseGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard blocks a chinese name', chineseReport?.guardVerdict === 'blocked', String(chineseReport?.guardMessage))

const upperGuard = await run({ guard: { commandName: 'Quit' } })
const upperReport = upperGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard blocks an uppercase name', upperReport?.guardVerdict === 'blocked', String(upperReport?.guardMessage))

const freeGuard = await run({ guard: { commandName: 'quit-dsh' } })
const freeReport = freeGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard accepts a free legal name', freeReport?.guardVerdict === 'accepted', String(freeReport?.guardVerdict))

const takenGuard = await run({ guard: { commandName: 'compact' }, name: 'qd', taken: [{ name: 'compact', description: 'Compact older conversation history' }] })
const takenReport = takenGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard blocks a globally taken name', takenReport?.guardVerdict === 'blocked', String(takenReport?.guardMessage))
check('save guard recognises its own entry id', takenReport?.ownEntryVerdict === 'blocked', String(takenReport?.ownEntryVerdict))
check('save guard ignores another entry id', takenReport?.otherEntryVerdict === 'accepted', String(takenReport?.otherEntryVerdict))
check('free name is accepted through the entry-id reading', freeReport?.ownEntryVerdict === 'accepted', String(freeReport?.ownEntryVerdict))

// DSH's own `/compact` lives in an agent scope, not the global layer: the guard
// must still refuse it, because a global registration it shadows is registered
// but unreachable.
const scopedGuard = await run({ guard: { commandName: 'compact' }, scopedTaken: scoped })
const scopedGuardReport = scopedGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard blocks a scope-only taken name', scopedGuardReport?.guardVerdict === 'blocked', String(scopedGuardReport?.guardMessage))
check('scope refusal explains the shadowing', String(scopedGuardReport?.guardMessage ?? '').includes('作用域'), String(scopedGuardReport?.guardMessage))

const scopedFreeGuard = await run({ guard: { commandName: 'bye' }, scopedTaken: scoped })
const scopedFreeReport = scopedFreeGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard accepts a name free in every scope', scopedFreeReport?.guardVerdict === 'accepted', String(scopedFreeReport?.guardMessage))

// ---------------------------------------------------------------------------
// The runtime notice: a resolved conflict is reported, a clean name is silent.
// ---------------------------------------------------------------------------
const noticeOf = (report) =>
  (report?.notices ?? [])
    .map((entry) => entry.patch?.notice)
    .filter((text) => typeof text === 'string' && text.length > 0)
    .pop()

check('a name taken at startup is reported to the interface',
  (() => {
    const text = noticeOf(conflictReport)
    return typeof text === 'string' && text.includes('"kind":"shadowed"') &&
      text.includes('"configured":"compact"') && text.includes('"active":"quit-dsh"')
  })(),
  String(noticeOf(conflictReport)))
check('the conflict notice names the other owner',
  String(noticeOf(conflictReport) ?? '').includes('Compact older conversation history'),
  String(noticeOf(conflictReport)))
check('every notice goes to this plugin own settings entry',
  (conflictReport?.notices ?? []).every((entry) => entry.ns === 'command-quit'),
  JSON.stringify((conflictReport?.notices ?? []).map((entry) => entry.ns)))

const quiet = await run({ name: 'qd' })
const quietReport = quiet.messages.find((m) => m && m.command !== undefined)
// Only the shadow notice is meant to be silent here; the terminal feature
// publishes its own status through a different field of the same entry.
check('no shadow notice is written while the configured name is in force',
  (quietReport?.notices ?? []).filter((entry) => entry.patch?.notice !== undefined && entry.patch.notice !== '').length === 0,
  JSON.stringify(quietReport?.notices))

// A rival that appears only once a session exists: the save could not see it.
const late = await run({
  name: 'quit',
  shadowAfter: [{ scope: 'session-9', name: 'quit', description: '另一个插件的退出命令' }]
})
const lateReport = late.messages.find((m) => m && m.afterShadow !== undefined)
check('a late scoped rival moves the plugin back to the default name',
  JSON.stringify(lateReport?.afterShadow) === '["quit-dsh"]', JSON.stringify(lateReport?.afterShadow))
check('the late rival is logged',
  (lateReport?.shadowErrors ?? []).some((line) => line.includes('quit') && line.includes('占用')),
  JSON.stringify(lateReport?.shadowErrors))
check('the late rival is reported to the interface',
  (() => {
    const text = noticeOf(lateReport)
    return typeof text === 'string' && text.includes('"configured":"quit"') && text.includes('"active":"quit-dsh"')
  })(),
  String(noticeOf(lateReport)))

// ---------------------------------------------------------------------------
// Volatile hot-swap: the old command is released, the new one registers.
// ---------------------------------------------------------------------------
const swapped = await run({ name: 'quit', hotSwap: 'quitdsh' })
const swappedReport = swapped.messages.find((m) => m && m.hotSwapTo !== undefined)
check('hot swap starts on the configured name', JSON.stringify(swappedReport?.hotSwapFrom) === '["quit"]', JSON.stringify(swappedReport?.hotSwapFrom))
check('hot swap leaves exactly the new name', JSON.stringify(swappedReport?.hotSwapTo) === '["quitdsh"]', JSON.stringify(swappedReport?.hotSwapTo))

// ---------------------------------------------------------------------------
// Pure helpers, exercised directly.
// ---------------------------------------------------------------------------
const helpers = await import(new URL('../lib/index.js', import.meta.url).href)
check('default command name constant', helpers.DEFAULT_COMMAND_NAME === 'quit-dsh', helpers.DEFAULT_COMMAND_NAME)
check('preset list', JSON.stringify(helpers.PRESET_COMMAND_NAMES) === '["quit","quit-dsh","quitdsh","qd"]', JSON.stringify(helpers.PRESET_COMMAND_NAMES))
check('config schema declares the volatile command name', helpers.Config?.dict?.commandName?.meta?.volatile === true, String(helpers.Config?.dict?.commandName?.meta?.volatile))
check('config default is quit-dsh', helpers.Config?.dict?.commandName?.meta?.default === 'quit-dsh', String(helpers.Config?.dict?.commandName?.meta?.default))
check('settings namespace is the profile entry id', helpers.SETTINGS_NAMESPACE === 'command-quit', String(helpers.SETTINGS_NAMESPACE))
check('config schema declares the host-written notice', helpers.Config?.dict?.notice?.meta?.volatile === true, String(helpers.Config?.dict?.notice?.meta?.volatile))
check('notice defaults to empty', helpers.Config?.dict?.notice?.meta?.default === '', String(helpers.Config?.dict?.notice?.meta?.default))
check('this plugin registers under one stable description', typeof helpers.COMMAND_DESCRIPTION === 'string' && helpers.COMMAND_DESCRIPTION.length > 0, String(helpers.COMMAND_DESCRIPTION))
for (const good of ['quit', 'quit-dsh', 'quitdsh', 'qd', 'a', 'q1_-2']) {
  check('accepts legal name ' + good, helpers.validateCommandName(good).ok === true, JSON.stringify(helpers.validateCommandName(good)))
}
for (const bad of ['', 'Quit', 'quit dsh', '退出', '2fast', '-quit', 'quit.dsh']) {
  check('refuses illegal name ' + JSON.stringify(bad), helpers.validateCommandName(bad).ok === false, JSON.stringify(helpers.validateCommandName(bad)))
}

// The guard's ownership test: the plugin's own fiber, or its own entry id.
const ownerFiber = {}
const ownerCtx = { fiber: ownerFiber }
check('guard owns its own fiber', helpers.guardsOwnEntry(ownerFiber, ownerCtx) === true, String(helpers.guardsOwnEntry(ownerFiber, ownerCtx)))
check(
  'guard owns its own entry id',
  helpers.guardsOwnEntry({ entry: { options: { id: 'command-quit' } } }, ownerCtx) === true,
  'command-quit'
)
check(
  'guard disclaims another entry id',
  helpers.guardsOwnEntry({ entry: { options: { id: 'ui-settings' } } }, ownerCtx) === false,
  'ui-settings'
)
check('guard disclaims a fiberless dispatch', helpers.guardsOwnEntry(undefined, ownerCtx) === false, 'undefined')
check('guard disclaims a bare object', helpers.guardsOwnEntry({}, ownerCtx) === false, '{}')

// The collision check itself, over registries of different shapes.
const registry = (scoped) => ({
  layers: { scoped: new Map(scoped.map((key) => [key, {}])) },
  find: (agent, name) => (agent !== undefined && scoped.includes(agent) && name === 'compact' ? { description: 'Compact older conversation history' } : undefined)
})
function refuses(commands, candidate, ownName) {
  try {
    helpers.assertCommandNameAvailable(commands, candidate, ownName)
    return false
  } catch {
    return true
  }
}
check('a scope-only name is refused', refuses(registry(['session-1']), 'compact', undefined) === true, 'compact')
check('the plugin own name is never refused', refuses(registry([]), 'quit-dsh', 'quit-dsh') === false, 'quit-dsh')
check('a free name is accepted', refuses(registry(['session-1']), 'bye', undefined) === false, 'bye')
check('an empty registry accepts anything', refuses(registry([]), 'compact', undefined) === false, 'compact')
check(
  'a registry without layers still checks the global layer',
  refuses({ find: (_agent, name) => (name === 'compact' ? { description: 'x' } : undefined) }, 'compact', undefined) === true,
  'compact'
)
check('a guarded registry accepts a free name', refuses({ find: () => undefined }, 'bye', undefined) === false, 'bye')
check(
  'this plugin own name is never refused inside a scope either',
  refuses({ layers: { scoped: new Map([['s', {}]]) }, find: () => ({ description: helpers.COMMAND_DESCRIPTION }) }, 'quit-dsh', undefined) === false,
  'own-in-scope'
)

// The delayed-registration check, exercised directly.
check('findShadowingScope sees a scope-only rival', helpers.findShadowingScope(registry(['session-1']), 'compact') !== undefined, 'compact')
check('findShadowingScope ignores a free name', helpers.findShadowingScope(registry(['session-1']), 'bye') === undefined, 'bye')
check('findShadowingScope ignores an empty name', helpers.findShadowingScope(registry(['session-1']), '') === undefined, 'empty')
check(
  'findShadowingScope ignores this plugin own registration',
  helpers.findShadowingScope({ layers: { scoped: new Map([['s', {}]]) }, find: () => ({ description: helpers.COMMAND_DESCRIPTION }) }, 'quit-dsh') === undefined,
  'own'
)
check('findShadowingScope survives a registry without layers', helpers.findShadowingScope({ find: () => ({ description: 'x' }) }, 'compact') === undefined, 'no-layers')
check('findOwner names a globally taken name',
  helpers.findOwner({ find: (_agent, name) => (name === 'compact' ? { description: 'Compact older conversation history' } : undefined) }, 'compact')?.description === 'Compact older conversation history',
  'compact')
check('findOwner ignores this plugin own registration', helpers.findOwner({ find: () => ({ description: helpers.COMMAND_DESCRIPTION }) }, 'quit-dsh') === undefined, 'own')
check('findOwner ignores a free name', helpers.findOwner(registry(['session-1']), 'bye') === undefined, 'bye')
check('isOwnDefinition recognises this plugin', helpers.isOwnDefinition({ description: helpers.COMMAND_DESCRIPTION }) === true, 'own')
check('isOwnDefinition rejects another command', helpers.isOwnDefinition({ description: 'Compact older conversation history' }) === false, 'other')
check('isOwnDefinition rejects nothing', helpers.isOwnDefinition(undefined) === false, 'undefined')
// Identity beats copy in both directions: the same definition stays ours even
// when its description is rewritten, and a foreign definition that somehow
// carries this plugin's description is still refused because its identity says
// otherwise. This is the case the old strict description comparison got wrong.
check(
  'isOwnDefinition trusts the definition identity over the copy',
  helpers.isOwnDefinition({ definitionId: helpers.COMMAND_DEFINITION_ID, description: '  被改写过的说明  ' }) === true,
  'own-by-id'
)
check(
  'isOwnDefinition never claims a foreign definition that carries our copy',
  helpers.isOwnDefinition({ definitionId: '@deepseek-ai/dsh-command-compact', description: helpers.COMMAND_DESCRIPTION }) === false,
  'foreign-by-id'
)
check(
  'isOwnDefinition accepts a whitespace-normalized description as the fallback',
  helpers.isOwnDefinition({ description: '  ' + helpers.COMMAND_DESCRIPTION + '\n' }) === true,
  'own-by-trimmed-copy'
)
check(
  'isOwnDefinition ignores a definition with no identity and no description',
  helpers.isOwnDefinition({ name: 'quit-dsh' }) === false,
  'no-copy'
)
check('encodeNotice round-trips a shadow notice', JSON.parse(helpers.encodeNotice({ kind: 'shadowed' })).kind === 'shadowed', helpers.encodeNotice({ kind: 'shadowed' }))
check('encodeNotice clears the notice for nothing', helpers.encodeNotice(undefined) === '', JSON.stringify(helpers.encodeNotice(undefined)))

// ---------------------------------------------------------------------------
// The terminal feature's own configuration
// ---------------------------------------------------------------------------
check('config declares the terminal switch', helpers.Config?.dict?.terminalEnabled?.meta?.volatile === true && helpers.Config.dict.terminalEnabled.meta.default === true, JSON.stringify(helpers.Config?.dict?.terminalEnabled?.meta))
check('config declares the confirmation switch', helpers.Config?.dict?.terminalConfirm?.meta?.volatile === true && helpers.Config.dict.terminalConfirm.meta.default === true, JSON.stringify(helpers.Config?.dict?.terminalConfirm?.meta))
check('config declares the terminal command name', helpers.Config?.dict?.terminalName?.meta?.volatile === true && helpers.Config.dict.terminalName.meta.default === 'quit-dsh', JSON.stringify(helpers.Config?.dict?.terminalName?.meta))
check('config declares the terminal status field', helpers.Config?.dict?.terminalNotice?.meta?.volatile === true && helpers.Config.dict.terminalNotice.meta.default === '', JSON.stringify(helpers.Config?.dict?.terminalNotice?.meta))
check('terminal name presets', JSON.stringify(helpers.PRESET_TERMINAL_NAMES) === '["quit-dsh","dsh-quit","dshq","dsq"]', JSON.stringify(helpers.PRESET_TERMINAL_NAMES))
check('terminal name default constant', helpers.DEFAULT_TERMINAL_NAME === 'quit-dsh', helpers.DEFAULT_TERMINAL_NAME)
check('the terminal default matches the composer default', helpers.DEFAULT_TERMINAL_NAME === helpers.DEFAULT_COMMAND_NAME, `${helpers.DEFAULT_TERMINAL_NAME}/${helpers.DEFAULT_COMMAND_NAME}`)
check('terminal status notice kind', helpers.NOTICE_TERMINAL === 'terminal', helpers.NOTICE_TERMINAL)

// Every field falls back to "on and asking", which is the safe direction for a
// configuration that lost a field.
check(
  'an empty configuration keeps the terminal command on and asking',
  JSON.stringify(helpers.resolveTerminalConfig({})) === JSON.stringify({ enabled: true, confirm: true, name: 'quit-dsh' }),
  JSON.stringify(helpers.resolveTerminalConfig({}))
)
check(
  'a switch read as false turns the feature off',
  helpers.resolveTerminalConfig({ terminalEnabled: { get: () => false } }).enabled === false,
  'enabled'
)
check(
  'a confirmation read as false is honoured',
  helpers.resolveTerminalConfig({ terminalConfirm: { get: () => false } }).confirm === false,
  'confirm'
)
check(
  'an illegal terminal name falls back to the default and is reported',
  (() => {
    const resolved = helpers.resolveTerminalConfig({ terminalName: { get: () => 'Bad!' } })
    return resolved.name === 'quit-dsh' && resolved.refused === 'Bad!'
  })(),
  JSON.stringify(helpers.resolveTerminalConfig({ terminalName: { get: () => 'Bad!' } }))
)
check(
  'a legal terminal name is used as configured',
  helpers.resolveTerminalConfig({ terminalName: { get: () => 'dshq' } }).name === 'dshq',
  'dshq'
)

function terminalNameRefused(candidate) {
  try {
    helpers.checkCandidateTerminalName(candidate)
    return false
  } catch {
    return true
  }
}
check('the save check refuses an illegal terminal name', terminalNameRefused({ terminalName: 'Bad!' }) === true, 'Bad!')
check('the save check refuses a reserved terminal name', terminalNameRefused({ terminalName: 'con' }) === true, 'con')
check('the save check accepts the default terminal name', terminalNameRefused({ terminalName: 'quit-dsh' }) === false, 'quit-dsh')
check('the save check skips an unchanged empty name', terminalNameRefused({}) === false, 'no name')
check('the save check stands down while the feature is off', terminalNameRefused({ terminalName: 'Bad!', terminalEnabled: false }) === false, 'off')

// A save that only moves the terminal name is checked, and one that leaves it
// alone is not: this plugin writes its own status fields through the same
// document, and re-checking those would refuse a status update.
const terminalGuard = await run({ guard: { terminalName: 'Bad!' } })
const terminalGuardReport = terminalGuard.messages.find((m) => m && m.guardCount !== undefined)
check('save guard blocks an illegal terminal name', terminalGuardReport?.guardVerdict === 'blocked', String(terminalGuardReport?.guardMessage))
const terminalFree = await run({ guard: { terminalName: 'quit-dsh' } })
const terminalFreeReport = terminalFree.messages.find((m) => m && m.guardCount !== undefined)
check('save guard accepts the default terminal name', terminalFreeReport?.guardVerdict === 'accepted', String(terminalFreeReport?.guardMessage))
const terminalUnchanged = await run({ terminalName: 'quit-dsh', guard: { terminalName: 'quit-dsh' } })
const terminalUnchangedReport = terminalUnchanged.messages.find((m) => m && m.guardCount !== undefined)
check('save guard passes an unchanged terminal name through', terminalUnchangedReport?.guardVerdict === 'accepted', String(terminalUnchangedReport?.guardMessage))
// A name saved while the feature was off was let through on purpose, so the save
// that switches the feature on is the last chance to catch it. The case that
// matters is a name that never moved: an illegal one is caught by the "the name
// changed" rule alone, while a legal name that belongs to another command on the
// PATH is what only this second look can find.
const collisionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-collide-'))
fs.writeFileSync(path.join(collisionDir, 'quit-dsh.ps1'), '# someone else command\n')
const terminalTurnedOn = await run({ terminalEnabled: false, pathPrefix: collisionDir, guard: { terminalName: 'quit-dsh', terminalEnabled: true } })
const terminalTurnedOnReport = terminalTurnedOn.messages.find((m) => m && m.guardCount !== undefined)
check(
  'save guard checks an unchanged name when the save switches the feature on',
  terminalTurnedOnReport?.guardVerdict === 'blocked',
  String(terminalTurnedOnReport?.guardMessage)
)
check(
  'the refusal caused by the switch names the colliding file',
  String(terminalTurnedOnReport?.guardMessage).includes('quit-dsh.ps1'),
  String(terminalTurnedOnReport?.guardMessage)
)
// Staying off is still allowed to carry any name: nothing is installed while the
// feature is off, and the save that turns it on is the one that checks.
const terminalKeptOff = await run({ terminalEnabled: false, pathPrefix: collisionDir, guard: { terminalName: 'quit-dsh', terminalEnabled: false } })
const terminalKeptOffReport = terminalKeptOff.messages.find((m) => m && m.guardCount !== undefined)
check('a save that keeps the feature off still lets the name through', terminalKeptOffReport?.guardVerdict === 'accepted', String(terminalKeptOffReport?.guardMessage))
fs.rmSync(collisionDir, { recursive: true, force: true })

// Every child redirected the terminal half's state into its own scratch
// directory; clean those up rather than leaving them in the temporary folder.
const childStates = new Set()
for (const run of [desktop, web, custom, conflict, terminalGuard, terminalFree, terminalUnchanged, terminalTurnedOn, terminalKeptOff]) {
  for (const message of run.messages) {
    if (typeof message?.stateDir === 'string') childStates.add(message.stateDir)
  }
}
check('every child redirected its terminal state out of the user home', childStates.size === 9, String(childStates.size))
for (const dir of childStates) fs.rmSync(dir, { recursive: true, force: true })

fs.rmSync(path.dirname(childPath), { recursive: true, force: true })
if (vendor.root !== '') fs.rmSync(vendor.root, { recursive: true, force: true })

console.log('')
console.log(failures === 0 ? 'ALL COMMAND CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
