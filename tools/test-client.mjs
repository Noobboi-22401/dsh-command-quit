// Structural test of the browser half (`lib/client.js`).
//
// The client bundle is shipped prebuilt and only runs inside the DSH web shell,
// where `window.__ModuleLoader__` and the shared UI primitives exist. This test
// supplies a stub module loader, a minimal React element shim and stub
// primitives, then renders the configuration card twice — once with a healthy
// settings form and once with a refused save — and renders the frame-wide
// notice the Host raises when it had to rename the command on its own.
//
// It catches the failure mode unit-testing the Host half cannot: a surface that
// is structurally fine but reads the wrong part of its own projection, so
// neither the refusal nor the conflict ever reaches the user's eyes. It also
// pins the containment rule that matters most here: the frame-wide entry sits
// above the settings dialog, so neither of the two components may throw.
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')

const loaded = []
globalThis.window = { __ModuleLoader__: { load: (entry) => loaded.push(entry) } }

/** A writing localStorage stand-in, so the diagnostic trail can be asserted. */
const localStorageStore = new Map()
globalThis.localStorage = {
  getItem: (key) => (localStorageStore.has(key) ? localStorageStore.get(key) : null),
  setItem: (key, value) => {
    localStorageStore.set(key, String(value))
  }
}

/** The element shim: enough of `React.createElement` to build the tree. */
function createElement(type, props, ...children) {
  return {
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((child) => child !== undefined && child !== null && typeof child !== 'boolean')
  }
}

/** The hook shim: one dismissal in component state, effects run on mount. */
const reactStub = {
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: (effect) => {
    effect()
    return undefined
  }
}

/** Dictionaries the bundle registers, read back by the bound `t`. */
const dicts = {}
const t = (key) => dicts.commandQuit?.[key] ?? key

/** Stub UI primitives: the real ones need a browser, the card only names them. */
const formModels = []
const primitives = {
  SettingsForm: function SettingsForm() {},
  SettingsValueField: function SettingsValueField() {},
  Switch: function Switch() {},
  settingsTextField: (field) => ({
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = String(text).trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    }
  }),
  SettingsFormModel: class {
    constructor(scope, specs) {
      this.scope = scope
      this.specs = specs
      formModels.push(this)
    }
    bind(project) {
      return { getSnapshot: () => project(), subscribe: () => () => {} }
    }
    shell() {
      return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
    }
    field(name) {
      return { text: 'rushb', overridden: true, invalid: false, field: name }
    }
    actions() {
      return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }
    }
    dispose() {}
  }
}

/**
 * The settings mirror the bundle reads the Host's notice out of. Its snapshot is
 * the shape `configForms.get(ns)` hands the official pages: a resolved `value`
 * carrying the fields the Host and the user both write.
 */
const mirrorListeners = []
const settingsAdapter = {
  scope: {},
  getSnapshot: () => ({ value: { commandName: 'compact', notice: hostNotice } }),
  subscribe: (listener) => {
    mirrorListeners.push(listener)
    return () => {
      const index = mirrorListeners.indexOf(listener)
      if (index >= 0) mirrorListeners.splice(index, 1)
    }
  }
}
let hostNotice = JSON.stringify({ kind: 'shadowed', configured: 'quit', active: 'quit-dsh', owner: '另一个插件的退出命令' })

new Function('window', source)(globalThis.window)

const factory = loaded[0]?.factory
if (factory === undefined) throw new Error('lib/client.js registered no module factory')
const mod = factory((name) => {
  if (name === 'react') return reactStub
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error('lib/client.js required an unexpected module: ' + name)
})

let failures = 0
function check(label, condition, detail) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label + (detail === undefined ? '' : '  -> ' + detail))
  if (!condition) failures++
}

const registrations = []
const ctx = {
  fiber: {},
  logger: { warn: () => {}, error: () => {}, info: () => {} },
  locale: {
    bind: () => t,
    register: (ns, value) => {
      dicts[ns] = value.zh
      return () => {}
    }
  },
  effect: (callback) => {
    const dispose = callback()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  get: (name) => (name === 'configForms' ? { get: () => settingsAdapter } : undefined),
  slots: {
    inject: (_slot, callback) => {
      callback()
      return () => {}
    },
    register: (entry, component) => {
      registrations.push({ entry, component })
      return () => {}
    }
  }
}

mod.apply(ctx)

check('bundle declares the package id', loaded[0].id === 'dsh-command-quit', String(loaded[0].id))
check('client inject list', JSON.stringify(mod.inject) === '["slots","locale","configForms"]', JSON.stringify(mod.inject))

const pageEntries = registrations.filter((item) => item.entry?.name === 'plugins.item')
const overlayEntries = registrations.filter((item) => item.entry?.name === 'shell.overlay')
check('registers exactly one plugins.item entry', pageEntries.length === 1, String(pageEntries.length))
check('registers exactly one shell.overlay notice entry', overlayEntries.length === 1, String(overlayEntries.length))
check('no other slot is claimed', registrations.length === 2, JSON.stringify(registrations.map((item) => item.entry?.name)))

const { entry, component } = pageEntries[0]
check('slot entry id is the settings namespace', entry.id === 'command-quit', String(entry.id))
check('slot label resolves from the dictionary', entry.label() === '退出命令', String(entry.label()))
check('notice entry id is distinct from the page entry', overlayEntries[0].entry.id === 'command-quit-notice', String(overlayEntries[0].entry.id))
check(
  'the frame notice takes no slot-injected face',
  overlayEntries[0].entry.inject === undefined,
  String(overlayEntries[0].entry.inject)
)
check('no rendering failure was recorded during activation', (localStorageStore.get('dsh-command-quit:diag') ?? '') === '', String(localStorageStore.get('dsh-command-quit:diag')))

const face = entry.inject()
check('inject exposes the save and discard actions', typeof face.edit === 'function' && typeof face.save === 'function' && typeof face.discard === 'function')
check('inject exposes one snapshot store', typeof face.hooks?.commandQuitCard?.getSnapshot === 'function')
const snapshot = face.hooks.commandQuitCard.getSnapshot()
check('projection nests shell and field', snapshot?.shell !== undefined && snapshot?.field !== undefined, JSON.stringify(snapshot))

// ---------------------------------------------------------------------------
// The Host's notice, read through the settings mirror rather than injected.
// ---------------------------------------------------------------------------
const blockedNotice = { kind: 'shadowed', configured: 'quit', active: 'quit-dsh', owner: '另一个插件的退出命令' }
hostNotice = ''
check('no conflict reads as no notice', face.hooks.commandQuitCard.getSnapshot()?.notice === undefined, 'none')

hostNotice = JSON.stringify(blockedNotice)
check(
  'the page reads the Host notice out of the settings mirror',
  face.hooks.commandQuitCard.getSnapshot()?.notice?.kind === 'shadowed',
  JSON.stringify(face.hooks.commandQuitCard.getSnapshot()?.notice)
)

hostNotice = 'not json at all'
check('a malformed notice is ignored rather than rendered', face.hooks.commandQuitCard.getSnapshot()?.notice === undefined, 'malformed')

hostNotice = JSON.stringify({ kind: 'something-else' })
check('an unknown notice kind is ignored', face.hooks.commandQuitCard.getSnapshot()?.notice === undefined, 'unknown-kind')

hostNotice = ''
check('a cleared notice disappears from the page', face.hooks.commandQuitCard.getSnapshot()?.notice === undefined, 'cleared')

// ---------------------------------------------------------------------------
// The reader a Hook binds to must be identity-stable. React's
// `useSyncExternalStore` re-renders for as long as two consecutive reads
// differ, so a snapshot built fresh per read re-renders the page forever and
// takes the settings page it sits on down with it. This is that regression.
// ---------------------------------------------------------------------------
const reader = face.hooks.commandQuitCard
check(
  'the reader hands back one and the same snapshot while nothing changed',
  reader.getSnapshot() === reader.getSnapshot(),
  'two consecutive reads differ'
)
check('the reader object itself is never replaced', entry.inject().hooks.commandQuitCard === reader)

const quietSnapshot = reader.getSnapshot()
hostNotice = JSON.stringify(blockedNotice)
const loudSnapshot = reader.getSnapshot()
check(
  'a changed notice does produce a new snapshot',
  quietSnapshot !== loudSnapshot && loudSnapshot?.notice?.kind === 'shadowed',
  JSON.stringify(loudSnapshot?.notice)
)
check('that snapshot is stable again once it has been read once', reader.getSnapshot() === reader.getSnapshot())
hostNotice = ''
check('clearing the notice moves the snapshot back', reader.getSnapshot() !== loudSnapshot)
check('and the cleared snapshot is stable too', reader.getSnapshot() === reader.getSnapshot())

/** Flatten an element tree, expanding the components defined inside the bundle. */
function collect(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  out.push(node)
  if (typeof node.type === 'function' && (node.type.name === 'PresetChip' || node.type.name === 'ToggleControl')) {
    collect(node.type(node.props), out)
    return out
  }
  for (const child of node.children ?? []) collect(child, out)
  return out
}

/** Render the card against a projection whose save outcome the caller chooses. */
function render(failed, notice, override) {
  const state = {
    shell: { available: true, writable: true, dirty: true, invalid: false, saving: false, failed },
    field: { text: 'compact', overridden: true, invalid: false },
    notice
  }
  return component({
    t,
    view: 'page',
    useCommandQuitCard: override ?? ((selector) => selector(state)),
    edit: () => {},
    resetField: () => {},
    save: () => {},
    discard: () => {}
  })
}

const shadowOf = (tree) => collect(tree).find((node) => node.props?.className === 'cqshadow')

for (const failed of [false, true]) {
  const nodes = collect(render(failed))
  const note = nodes.find((node) => node.props?.className === 'cqnote')
  const alert = nodes.find((node) => node.props?.className === 'cqfailed')
  const field = nodes.find((node) => node.type === primitives.SettingsValueField)

  check(
    `disclaimer is on the page (refused=${failed})`,
    typeof note?.children?.[0] === 'string' && note.children[0].includes('不是 DeepSeek 官方插件'),
    String(note?.children?.[0])
  )
  check(
    `refusal notice follows the save outcome (refused=${failed})`,
    failed ? alert !== undefined && alert.props.role === 'alert' : alert === undefined,
    String(alert?.props?.className)
  )
  check(
    `field hint follows the save outcome (refused=${failed})`,
    failed ? field?.props?.hint?.includes('保存被拒绝') === true : field?.props?.hint?.includes('输入 / 后面那一段') === true,
    String(field?.props?.hint?.slice(0, 24))
  )
  const chips = nodes.filter((node) => node.props?.className === 'cqchip' || node.props?.className === 'cqchip cqchipActive')
  check(`four presets per name field render (refused=${failed})`, chips.length === 8, String(chips.length))
  check(`the terminal presets carry no slash (refused=${failed})`,
    chips.filter((node) => String(node.children?.[0]).startsWith('/')).length === 4,
    JSON.stringify(chips.map((node) => node.children?.[0])))
  check(`no shadow warning without a conflict (refused=${failed})`, shadowOf(render(failed)) === undefined, 'none')
}

// ---------------------------------------------------------------------------
// The terminal section: two switches, a second name field and a status line.
// ---------------------------------------------------------------------------
const terminalState = {
  shell: { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false },
  field: { text: 'quit-dsh', overridden: false, invalid: false },
  fields: {
    enabled: { text: 'true', overridden: false, invalid: false },
    confirm: { text: 'true', overridden: false, invalid: false },
    name: { text: 'quit-dsh', overridden: false, invalid: false }
  },
  notice: undefined,
  terminal: undefined
}
const renderTerminal = (terminal, fields, extra) =>
  collect(
    component({
      t,
      view: 'page',
      useCommandQuitCard: (selector) => selector({ ...terminalState, fields: { ...terminalState.fields, ...fields }, terminal, ...extra }),
      edit: () => {},
      resetField: () => {},
      save: () => {},
      discard: () => {}
    })
  )

const section = renderTerminal().find((node) => node.props?.className === 'cqsection')
check('the page carries a terminal section', section !== undefined, String(section?.props?.className))
check('the section is titled from the dictionary', String(renderTerminal().find((n) => n.props?.className === 'cqsectionTitle')?.children?.[0]) === '终端命令', 'title')
const switches = renderTerminal().filter((node) => node.type === primitives.Switch)
check('the section renders two switches', switches.length === 2, String(switches.length))
check('both switches start on', switches.every((node) => node.props.checked === true), JSON.stringify(switches.map((n) => n.props.checked)))
check('both switches are labelled', switches.every((node) => typeof node.props.label === 'string' && node.props.label.length > 0), JSON.stringify(switches.map((n) => n.props.label)))
check('no switch is locked while the deployment is writable', switches.every((node) => node.props.disabled === false), JSON.stringify(switches.map((n) => n.props.disabled)))

const offSwitches = renderTerminal(undefined, { enabled: { text: 'false', overridden: true, invalid: false } }).filter((node) => node.type === primitives.Switch)
check('the confirmation switch is locked while the feature is off', offSwitches[1]?.props.disabled === true, JSON.stringify(offSwitches.map((n) => n.props.disabled)))
check('the locked switch explains why', offSwitches[1]?.props.title?.includes('不生效') === true, String(offSwitches[1]?.props.title))
check('the row it sits in is dimmed', renderTerminal(undefined, { enabled: { text: 'false', overridden: true, invalid: false } }).some((node) => node.props?.className === 'cqrow cqrowOff'), 'cqrowOff')

// Every state the Host can publish has copy, and only the bad ones are alarms.
const statusCases = [
  ['installed', { kind: 'terminal', state: 'installed', dir: 'D:\\Main\\resources\\runtime\\cli\\bin', onPath: true }, '已安装：', false],
  ['not on PATH', { kind: 'terminal', state: 'installed', dir: 'D:\\x', onPath: false }, 'PATH', false],
  ['missing', { kind: 'terminal', state: 'missing' }, 'install-dsh-quit.cmd', false],
  ['disabled', { kind: 'terminal', state: 'disabled' }, '已关闭', false],
  ['conflict', { kind: 'terminal', state: 'conflict', detail: '已被占用' }, '已被占用', true],
  ['error', { kind: 'terminal', state: 'error', detail: '管道失败' }, '管道失败', true]
]
for (const [label, status, needle, alarm] of statusCases) {
  const node = renderTerminal(status).find((n) => n.props?.className === 'cqstatus' || n.props?.className === 'cqstatus cqstatusBad')
  check(`the ${label} status is shown`, node !== undefined && String(node.children?.[0]).includes(needle), String(node?.children?.[0]))
  check(`the ${label} status alarm flag is ${alarm}`, (node?.props?.className === 'cqstatus cqstatusBad') === alarm, String(node?.props?.className))
}
check('a status kind nobody knows renders nothing',
  renderTerminal({ kind: 'terminal', state: 'nonsense' }).find((n) => n.props?.className?.startsWith('cqstatus')) === undefined, 'none')
check('a status of another kind is ignored',
  renderTerminal({ kind: 'shadowed' }).find((n) => n.props?.className?.startsWith('cqstatus')) === undefined, 'none')

// The form model must know all four fields, and the switches must speak true/false.
const specs = formModels[0]?.specs ?? []
check('the form declares all four fields', JSON.stringify(specs.map((spec) => spec.field)) === JSON.stringify(['commandName', 'terminalEnabled', 'terminalConfirm', 'terminalName']), JSON.stringify(specs.map((spec) => spec.field)))
const enabledSpec = specs.find((spec) => spec.field === 'terminalEnabled')
check('an absent switch value formats as on', enabledSpec?.format(undefined) === 'true', String(enabledSpec?.format(undefined)))
check('a switch value of false formats as off', enabledSpec?.format(false) === 'false', String(enabledSpec?.format(false)))
check('a switch parses true', JSON.stringify(enabledSpec?.parse('true')) === JSON.stringify({ kind: 'set', value: true }), JSON.stringify(enabledSpec?.parse('true')))
check('a switch parses false', JSON.stringify(enabledSpec?.parse('false')) === JSON.stringify({ kind: 'set', value: false }), JSON.stringify(enabledSpec?.parse('false')))
check('a switch refuses anything else', enabledSpec?.parse('maybe') === undefined, String(enabledSpec?.parse('maybe')))
check('the two switches share one spec shape',
  specs.find((spec) => spec.field === 'terminalConfirm')?.parse('false')?.value === false, 'confirm')
check('the terminal name field is a text field', specs.find((spec) => spec.field === 'terminalName')?.parse('  dshq  ')?.value === 'dshq', 'text')

// ---------------------------------------------------------------------------
// The page's own conflict warning.
// ---------------------------------------------------------------------------
const shadowNode = shadowOf(render(false, blockedNotice))
check('the page shows the shadow warning', shadowNode !== undefined && shadowNode.props.role === 'alert', String(shadowNode?.props?.className))
check(
  'the page warning names the configured and the active name',
  String(shadowNode?.children?.[0]).includes('/quit') && String(shadowNode?.children?.[0]).includes('/quit-dsh'),
  String(shadowNode?.children?.[0])
)
check(
  'the page warning names the other owner',
  String(shadowNode?.children?.[0]).includes('另一个插件的退出命令'),
  String(shadowNode?.children?.[0])
)

// ---------------------------------------------------------------------------
// A page that fails to render must degrade, never blank the entry.
// ---------------------------------------------------------------------------
const diagBefore = localStorageStore.get('dsh-command-quit:diag')
const broken = collect(render(false, undefined, () => {
  throw new Error('projection exploded')
}))
const diag = broken.find((node) => node.props?.className === 'cqdiag')
check('a failing page render degrades to a written line', diag !== undefined && diag.props.role === 'alert', String(diag?.props?.className))
check(
  'the degraded line names the failure',
  String(diag?.children?.[0]).includes('projection exploded') && String(diag?.children?.[0]).includes('渲染失败'),
  String(diag?.children?.[0])
)
check(
  'the failure is recorded for later reading',
  (localStorageStore.get('dsh-command-quit:diag') ?? '').includes('projection exploded'),
  String(diagBefore) + ' -> ' + String(localStorageStore.get('dsh-command-quit:diag'))
)

// ---------------------------------------------------------------------------
// The frame-wide notice, which is what a user sees without opening Settings.
// ---------------------------------------------------------------------------
const bannerComponent = overlayEntries[0].component
const renderBanner = () => bannerComponent({ t })

/** Drive the mirror so the module publishes whatever the Host now reports. */
function pushHostNotice(text) {
  hostNotice = text
  for (const listener of [...mirrorListeners]) listener()
}

check('the notice watch subscribes to the settings mirror', mirrorListeners.length === 1, String(mirrorListeners.length))

pushHostNotice('')
check('the frame notice renders nothing without a conflict', renderBanner() === null, 'null')

pushHostNotice(JSON.stringify(blockedNotice))
const bannerNodes = collect(renderBanner())
const banner = bannerNodes.find((node) => node.props?.className === 'cqbanner')
check('the frame notice renders the conflict', banner !== undefined && banner.props.role === 'alert', String(banner?.props?.className))
const bannerText = bannerNodes.find((node) => node.props?.className === 'cqbannerText')
check(
  'the frame notice carries the same copy as the page',
  String(bannerText?.children?.[0]).includes('/quit-dsh') && String(bannerText?.children?.[0]).includes('/quit'),
  String(bannerText?.children?.[0])
)
check(
  'the frame notice offers a dismissal',
  bannerNodes.some((node) => node.props?.className === 'cqbannerClose' && node.props?.['aria-label'] === '关闭提示'),
  'close button'
)

// When the fallback name is taken too, the copy must stop promising a working
// command and send the user to the configuration page instead.
pushHostNotice(JSON.stringify({ kind: 'shadowed', configured: 'quit-dsh', active: 'quit-dsh', owner: '' }))
const stuckText = collect(renderBanner()).find((node) => node.props?.className === 'cqbannerText')
check(
  'a stranded conflict says the command is unavailable',
  String(stuckText?.children?.[0]).includes('暂时无法使用'),
  String(stuckText?.children?.[0])
)
pushHostNotice(JSON.stringify(blockedNotice))

// The notice the frame shows must never be able to throw, whatever the slot
// hands the component: no `t` prop, a foreign props object, or none at all.
check('the frame notice survives a missing locale binding', (() => {
  try {
    const tree = bannerComponent({})
    return tree === null || tree.props?.className === 'cqbanner'
  } catch {
    return false
  }
})(), 'no throw')
check('the frame notice survives absent props', (() => {
  try {
    const tree = bannerComponent(undefined)
    return tree === null || tree.props?.className === 'cqbanner'
  } catch {
    return false
  }
})(), 'no throw')

// ---------------------------------------------------------------------------
// A settings seam that is not ready yet must stay retryable. The lazy adapter
// lookup used to lock its miss on the first call, so a namespace that was not
// served at mount left the page on “no settings service” until a restart. Here
// the seam arrives after activation: the page must pick it up by itself.
// ---------------------------------------------------------------------------
const lateFactory = loaded[0].factory
let settingsServed = false
const lateRegistrations = []
const lateCtx = {
  fiber: {},
  logger: { warn: () => {}, error: () => {}, info: () => {} },
  locale: {
    bind: () => t,
    register: (ns, value) => {
      dicts[ns] = value.zh
      return () => {}
    }
  },
  effect: (callback) => {
    const dispose = callback()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  get: (name) => (name === 'configForms' ? { get: () => (settingsServed ? settingsAdapter : undefined) } : undefined),
  slots: {
    inject: (_slot, callback) => {
      callback()
      return () => {}
    },
    register: (entry, component) => {
      lateRegistrations.push({ entry, component })
      return () => {}
    }
  }
}
const lateMod = lateFactory((name) => {
  if (name === 'react') return reactStub
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error('lib/client.js required an unexpected module: ' + name)
})
lateMod.apply(lateCtx)
const lateEntry = lateRegistrations.find((item) => item.entry?.name === 'plugins.item')?.entry
check(
  'a settings seam that is not ready yet degrades instead of failing',
  lateEntry?.inject().hooks.commandQuitCard.getSnapshot()?.reason === 'settings',
  JSON.stringify(lateEntry?.inject().hooks.commandQuitCard.getSnapshot()?.reason)
)
settingsServed = true
const recoveredSnapshot = lateEntry?.inject().hooks.commandQuitCard.getSnapshot()
check(
  'the page picks the settings seam up once it arrives, without a restart',
  recoveredSnapshot?.reason === undefined && recoveredSnapshot?.shell?.available === true,
  JSON.stringify(recoveredSnapshot?.shell)
)
check(
  'the late seam also carries the Host notice into the page',
  recoveredSnapshot?.notice?.kind === 'shadowed',
  JSON.stringify(recoveredSnapshot?.notice)
)

console.log('')
console.log(failures === 0 ? 'ALL CLIENT CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
