// Browser half of dsh-command-quit.
//
// A DSH client plugin bundle: `window.__ModuleLoader__.load` registers one
// factory, and the module body only runs when the shell materializes it. The
// page registers into the Plugins page's `plugins.item` slot while the Host
// serves this plugin's settings namespace (the profile patch entry id
// `command-quit`), so it appears beside the official plugin pages and is
// edited with the same shared settings-form controls.
//
// Two surfaces report a conflict the Host resolved on its own. The page shows
// the reason inline, and a frame-wide entry in `shell.overlay` raises a notice
// that survives leaving the settings page — because a plugin that silently
// renames its own command is indistinguishable from a broken one.
//
// The frame-wide layer is an ancestor of the settings dialog, so a component
// that throws there can take the whole overlay down with it. Both surfaces
// therefore render defensively: `shell.overlay` is registered last, the notice
// entry owns its own state instead of relying on a slot-injected hook, and a
// Render that fails degrades to a written line (also recorded in localStorage)
// rather than an exception.
//
// This file is shipped prebuilt: DSH consumes `lib/client.js` directly, with
// no build step of its own.
window.__ModuleLoader__.load({
  id: 'dsh-command-quit',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    let react = require('react')
    let primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = react.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'commandQuit'

    /** Settings namespace: the profile patch entry id that owns this plugin's config. */
    const SETTINGS_NAMESPACE = 'command-quit'

    /** Config field carrying the command name. */
    const FIELD = 'commandName'

    /** Config field the Host writes its runtime status into. */
    const NOTICE_FIELD = 'notice'

    /** Notice kind the Host publishes when a scoped command took the name away. */
    const NOTICE_SHADOWED = 'shadowed'

    /** Config field carrying the terminal command name. */
    const TERMINAL_NAME_FIELD = 'terminalName'

    /** Config field switching the terminal command on and off. */
    const TERMINAL_ENABLED_FIELD = 'terminalEnabled'

    /** Config field switching the terminal command's own confirmation on and off. */
    const TERMINAL_CONFIRM_FIELD = 'terminalConfirm'

    /** Config field the Host writes the terminal feature's status into. */
    const TERMINAL_NOTICE_FIELD = 'terminalNotice'

    /** Notice kind of that status. */
    const NOTICE_TERMINAL = 'terminal'

    /** Fallback terminal command name; mirrored from the Host half. */
    const DEFAULT_TERMINAL_NAME = 'quit-dsh'

    /** Ready-made terminal names offered as one-click chips; the default first. */
    const TERMINAL_PRESETS = ['quit-dsh', 'dsh-quit', 'dshq', 'dsq']

    /** Fallback name the Host switches to; mirrored here for the copy. */
    const DEFAULT_NAME = 'quit-dsh'

    /** The platform's command-name rule, mirrored from the Host half. */
    const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

    /** Ready-made names offered as one-click chips. */
    const PRESETS = ['quit', 'quit-dsh', 'quitdsh', 'qd']

    /** Where a rendering failure is recorded, so it can be read back from disk. */
    const DIAG_KEY = 'dsh-command-quit:diag'

    const zh = {
      title: '退出命令',
      summary: '设置关闭 DeepSeek Harness 客户端所用的命令名。',
      intro: '选定一个命令名后，在对话框里输入它即可退出客户端。',
      presets: '常用命令名',
      name: '命令名',
      hint: '输入 / 后面那一段，例如 quit-dsh；也可以选一个常用命令名。同一时刻只有一个命令名生效。',
      invalid: '必须以小写字母开头，只能用小写字母、数字、下划线或连字符，不能有空格或中文。',
      conflict: '保存被拒绝：这个名字通常已经被 DSH 的其他命令占用（例如 compact、goal、plan、permission、feedback、export），或者是格式不合法。换一个名字再保存即可；被拒绝的名字不会生效。',
      shadowed: '⚠ 命令名冲突：你配置的命令名 %c 已被其他命令占用%s。插件已自动改用 %a，输入 %a 即可退出。请在下面换一个没人用的名字。',
      shadowedOwner: '（%s）',
      shadowedStuck: '⚠ 命令名冲突：你配置的命令名 %c 已被其他命令占用%s，默认命令名 %d 也被占用，退出命令暂时无法使用。请在下面换一个没人用的名字，或重启一次客户端。',
      renderFailed: '退出命令的配置界面渲染失败：',
      dismiss: '关闭提示',
      disclaimer: '免责声明：本插件不是 DeepSeek 官方插件，与 DeepSeek 官方无关。这里只是借用了 DSH 自带的插件设置入口来存放本插件自己的一个配置项。',
      noSettings: '配置界面暂时拿不到 DSH 的设置服务，无法读写命令名。请重启一次客户端；若一直如此，说明本机 DSH 版本与本插件的配置页不兼容。',
      overridden: '已修改',
      reset: '恢复默认',
      readOnly: '本部署的设置为只读。',
      unavailable: 'DSH 还没有把这个插件的配置交给界面（插件未加载或配置尚未就绪），暂时无法修改。',
      saveFailed: '本部署没有接受这个值，已保留供你修改。',
      save: '保存',
      saving: '保存中…',
      terminalTitle: '终端命令',
      terminalIntro: '在任意终端窗口里输入这个命令，也能关闭正在运行的客户端；效果和对话框里的命令完全一样。',
      terminalToggle: '启用终端退出功能',
      terminalToggleHint: '关闭后这个命令不会关闭客户端，只会提示功能已关闭；已经安装的启动文件会保留。',
      confirmToggle: '执行前先询问确认（y/N）',
      confirmToggleHint: '关闭后，输入命令会直接关闭客户端，不再提问。',
      confirmDisabledHint: '终端退出功能关闭时，这一项不生效。',
      terminalPresets: '常用终端命令名',
      terminalName: '终端命令名',
      terminalHint: '在终端里输入的那一段，例如 quit-dsh；也可以选一个常用名。修改后已安装的启动文件会自动改名。',
      terminalStatusInstalled: '已安装：%p',
      terminalStatusNotOnPath: '已安装：%p（这个目录不在当前 PATH 里，请重开终端或重新登录一次）',
      terminalStatusMissing: '尚未安装。双击插件文件夹里的 install-dsh-quit.cmd 即可安装。',
      terminalStatusDisabled: '终端退出功能已关闭；已经安装的命令会提示这一点。',
      terminalStatusConflict: '这个名字不能安装：%s',
      terminalStatusError: '终端命令暂时不可用：%s'
    }

    const en = {
      title: 'Quit command',
      summary: 'Set the command name that closes the DeepSeek Harness client.',
      intro: 'Pick a command name, then type it in the composer to quit.',
      presets: 'Preset command names',
      name: 'Command name',
      hint: 'The part after “/”, for example quit-dsh — or pick a preset above. Only one name is active at a time.',
      invalid: 'Must start with a lowercase letter and contain only lowercase letters, digits, “_” or “-”.',
      conflict: 'The save was refused: this name is usually already taken by another DSH command (for example compact, goal, plan, permission, feedback, export), or the format is invalid. Choose another name and save again — a refused name never takes effect.',
      shadowed: '⚠ Command-name conflict: your configured name %c is taken by another command%s. The plugin switched to %a — type %a to quit. Pick an unused name below.',
      shadowedOwner: ' (%s)',
      shadowedStuck: '⚠ Command-name conflict: your configured name %c is taken by another command%s, and the default name %d is taken as well, so the quit command is unavailable for now. Pick an unused name below, or restart the client once.',
      renderFailed: 'The command-name settings page failed to render: ',
      dismiss: 'Dismiss notice',
      disclaimer: 'Disclaimer: this plugin is not an official DeepSeek plugin and is not affiliated with DeepSeek. It only borrows DSH\'s built-in plugin settings entry to store one of its own options.',
      noSettings: 'The settings service is not reachable, so the command name cannot be read or written. Restart the client once; if this persists, this DSH build is incompatible with this configuration page.',
      overridden: 'Changed',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'DSH has not published this plugin\'s configuration to the interface yet (the plugin is not loaded, or its configuration is not ready).',
      saveFailed: 'The deployment did not accept this value; it was left for you to correct.',
      save: 'Save',
      saving: 'Saving…',
      terminalTitle: 'Terminal command',
      terminalIntro: 'Typing this command in any terminal window also closes the running client, exactly like the command in the composer.',
      terminalToggle: 'Enable the terminal quit command',
      terminalToggleHint: 'When off, the command will not close the client — it only says the feature is off. A launcher that is already installed is kept.',
      confirmToggle: 'Ask for confirmation first (y/N)',
      confirmToggleHint: 'When off, typing the command closes the client immediately without asking.',
      confirmDisabledHint: 'Has no effect while the terminal quit command is off.',
      terminalPresets: 'Preset terminal command names',
      terminalName: 'Terminal command name',
      terminalHint: 'The word you type in a terminal, for example quit-dsh — or pick a preset. Renaming updates the installed launcher automatically.',
      terminalStatusInstalled: 'Installed: %p',
      terminalStatusNotOnPath: 'Installed: %p (this directory is not on the current PATH — reopen the terminal or sign in again)',
      terminalStatusMissing: 'Not installed yet. Double-click install-dsh-quit.cmd inside the plugin folder to install it.',
      terminalStatusDisabled: 'The terminal quit command is switched off; an installed command says so when it runs.',
      terminalStatusConflict: 'This name cannot be installed: %s',
      terminalStatusError: 'The terminal command is unavailable for now: %s'
    }

    /** One value's text form, never throwing on an exotic value. */
    function describeError(error) {
      try {
        if (error === undefined || error === null) return 'unknown failure'
        if (error instanceof Error) return error.message || error.name
        return typeof error === 'string' ? error : JSON.stringify(error)
      } catch {
        return 'unknown failure'
      }
    }

    /**
     * Record a rendering failure where it can be read back from disk.
     *
     * The frame-wide layer has no console the user can be asked to open, so a
     * caught failure is written to localStorage as well as shown where possible.
     * This never throws: diagnostics must not be able to cause the failure they
     * exist to report.
     */
    function recordDiag(stage, error) {
      try {
        const store = globalThis.localStorage
        if (store === undefined) return
        const line = stage + ': ' + describeError(error)
        const previous = store.getItem(DIAG_KEY) ?? ''
        if (previous.includes(line)) return
        store.setItem(DIAG_KEY, (previous === '' ? line : previous + '\n' + line).slice(-2000))
      } catch {
        // Diagnostics are best effort.
      }
    }

    // ---------------------------------------------------------------------
    // The Host's runtime notice, held by this module.
    //
    // It is deliberately NOT injected into the frame-wide entry: a plug-in's
    // own state is the one thing that cannot be missing, and an entry whose
    // data arrives as an optional prop can throw on every render when the slot
    // does not supply it — which, in an ancestor of the settings dialog, takes
    // the dialog down with it.
    // ---------------------------------------------------------------------
    let noticeCurrent
    const noticeListeners = new Set()

    /** Publish the current conflict, notifying only on a real change. */
    function publishClientNotice(next) {
      const previous = noticeCurrent
      if (previous === next) return
      if (
        previous !== undefined && next !== undefined &&
        previous.kind === next.kind &&
        previous.configured === next.configured &&
        previous.active === next.active &&
        previous.owner === next.owner
      ) {
        noticeCurrent = next
        return
      }
      noticeCurrent = next
      for (const listener of [...noticeListeners]) {
        try {
          listener()
        } catch {
          // One listener's failure must not stop the others.
        }
      }
    }

    /** Follow the published notice; returns a disposer. */
    function subscribeClientNotice(listener) {
      noticeListeners.add(listener)
      return () => {
        noticeListeners.delete(listener)
      }
    }

    /** The form frame's copy, read from this page's dictionary. */
    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving')
      }
    }

    /**
     * A boolean field's conversion spec.
     *
     * The primitives ship text and number fields but no boolean one, while the
     * form model accepts any `{ field, format, parse }`. Formatting an absent
     * value as `true` is deliberate: both of this plugin's switches default to
     * on, so a value the settings mirror has not carried yet must not read as
     * "off" — that would show the user the opposite of what the Host is doing.
     *
     * @param field - field name inside the settings namespace.
     * @returns the field's conversion spec.
     */
    function settingsBooleanField(field) {
      return {
        field,
        format: (value) => (value === false ? 'false' : 'true'),
        parse: (text) => {
          const trimmed = String(text).trim()
          if (trimmed === 'true') return { kind: 'set', value: true }
          if (trimmed === 'false') return { kind: 'set', value: false }
          return undefined
        }
      }
    }

    /**
     * A switch, falling back to a plain checkbox.
     *
     * A deployment whose primitives predate `Switch` still gets a working
     * control, because the alternative — an entry that throws — would take the
     * whole settings page down with it.
     *
     * @param props - `checked`, `onChange`, `label`, `disabled`, `title`.
     * @returns the control element.
     */
    function ToggleControl(props) {
      if (typeof primitives.Switch === 'function') return h(primitives.Switch, props)
      return h('input', {
        type: 'checkbox',
        checked: props.checked,
        disabled: props.disabled,
        title: props.title,
        'aria-label': props.label,
        onChange: (event) => props.onChange(event.target.checked === true)
      })
    }

    /**
     * Read the terminal feature's status out of the settings mirror.
     *
     * The Host owns the field and writes it through the settings document, so it
     * arrives the same way the shadow notice does. Anything that is not a
     * well-formed status is ignored rather than rendered.
     *
     * @param raw - the stored text.
     * @returns the status object, or `undefined`.
     */
    function parseTerminalStatus(raw) {
      if (typeof raw !== 'string' || raw.length === 0) return undefined
      try {
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return undefined
        if (parsed.kind !== NOTICE_TERMINAL) return undefined
        return parsed
      } catch {
        return undefined
      }
    }

    /**
     * One status's copy: which line the user needs to read.
     * @param t - the dictionary lookup.
     * @param status - the parsed status.
     * @returns the line, or `undefined` while there is nothing to say.
     */
    function formatTerminalStatus(t, status) {
      if (status === undefined) return undefined
      if (status.state === 'conflict') return t('terminalStatusConflict').replace('%s', String(status.detail ?? ''))
      if (status.state === 'error') return t('terminalStatusError').replace('%s', String(status.detail ?? ''))
      if (status.state === 'disabled') return t('terminalStatusDisabled')
      if (status.state === 'missing') return t('terminalStatusMissing')
      if (status.state === 'installed') {
        const key = status.onPath === false ? 'terminalStatusNotOnPath' : 'terminalStatusInstalled'
        return t(key).replace('%p', String(status.dir ?? ''))
      }
      return undefined
    }

    /**
     * One preset chip: it stages the preset into the name field instead of writing.
     *
     * `prefix` is the slash a composer command carries and a terminal command
     * does not, so one component serves both chips.
     */
    function PresetChip(props) {
      return h(
        'button',
        {
          type: 'button',
          className: props.active
            ? 'cqchip cqchipActive'
            : 'cqchip',
          'aria-pressed': props.active,
          disabled: props.disabled,
          onClick: props.onPick
        },
        (props.prefix ?? '/') + props.name
      )
    }

    /**
     * Read the Host's runtime status out of the settings mirror.
     *
     * The Host owns the `notice` field and writes it through the settings
     * document, which DSH forwards to the browser and this client's settings
     * mirror follows, so the value arrives without polling. Anything that is not
     * a well-formed shadow notice is ignored rather than rendered.
     */
    function parseNotice(raw) {
      if (typeof raw !== 'string' || raw.length === 0) return undefined
      try {
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return undefined
        if (parsed.kind !== NOTICE_SHADOWED) return undefined
        return parsed
      } catch {
        return undefined
      }
    }

    /** One shadow notice's copy, built from its own fields. */
    function formatShadow(t, notice) {
      const configured = '/' + (typeof notice.configured === 'string' && notice.configured.length > 0 ? notice.configured : '?')
      const active = typeof notice.active === 'string' && notice.active.length > 0 ? notice.active : DEFAULT_NAME
      const owner = typeof notice.owner === 'string' && notice.owner.length > 0
        ? t('shadowedOwner').replace('%s', notice.owner)
        : ''
      if (active === configured.slice(1)) {
        return t('shadowedStuck')
          .replace('%c', configured)
          .replace('%s', owner)
          .replace('%d', '/' + DEFAULT_NAME)
      }
      return t('shadowed')
        .replace('%c', configured)
        .replace('%s', owner)
        .replace(/%a/g, '/' + active)
    }

    /** Identity of one notice, so a dismissal is per conflict and not global. */
    function noticeKey(notice) {
      return String(notice.configured) + '>' + String(notice.active)
    }

    /**
     * The selector this page's Hook reads through.
     *
     * Hoisted on purpose: the Hook DSH builds around an injected source caches
     * on its arguments, so a fresh arrow per render would re-create that
     * binding — and re-read the source — on every single render.
     */
    const SAME_SNAPSHOT = (snapshot) => snapshot

    /** Actions a card falls back to while the settings seam is missing. */
    const NO_ACTIONS = Object.freeze({
      edit: () => {},
      resetField: () => {},
      save: () => {},
      discard: () => {}
    })

    /** The one snapshot a reader gets when the settings seam is gone. */
    const ABSENT_SNAPSHOT = Object.freeze({
      shell: Object.freeze({
        available: false,
        writable: false,
        dirty: false,
        invalid: false,
        saving: false,
        failed: false
      }),
      field: Object.freeze({ text: '', overridden: false, invalid: false }),
      // The switches read as on, because that is what the Host does when it has
      // no opinion — the schema default — and a page that showed "off" for an
      // unknown value would be describing the opposite of the running plugin.
      fields: Object.freeze({
        enabled: Object.freeze({ text: 'true', overridden: false, invalid: false }),
        confirm: Object.freeze({ text: 'true', overridden: false, invalid: false }),
        name: Object.freeze({ text: DEFAULT_TERMINAL_NAME, overridden: false, invalid: false })
      }),
      reason: 'settings',
      notice: undefined,
      terminal: undefined
    })

    /** Shallow structural identity: two values that say the same thing. */
    function sameShape(a, b) {
      if (a === b) return true
      if (a === null || b === null) return false
      if (typeof a !== 'object' || typeof b !== 'object') return false
      const keys = Object.keys(a)
      if (keys.length !== Object.keys(b).length) return false
      for (const key of keys) {
        if (!Object.is(a[key], b[key])) return false
      }
      return true
    }

    /**
     * Whether two groups of field projections say the same thing.
     *
     * One level deeper than {@link sameShape}, which is exactly what the
     * projection needs: the form builds a fresh object per field per read, so
     * the group has to be compared by value rather than by identity or the
     * reader would hand React a new snapshot on every single render.
     *
     * @param a - one group of field projections.
     * @param b - the other group.
     * @returns `true` when every field agrees.
     */
    function sameFields(a, b) {
      if (a === b) return true
      if (a === undefined || b === undefined) return false
      if (typeof a !== 'object' || typeof b !== 'object') return false
      const keys = Object.keys(a)
      if (keys.length !== Object.keys(b).length) return false
      for (const key of keys) {
        if (!sameShape(a[key], b[key])) return false
      }
      return true
    }

    /** Whether two projections can be read as the same value. */
    function sameProjection(a, b) {
      if (a === b) return true
      if (a === undefined || b === undefined) return false
      if (typeof a !== 'object' || typeof b !== 'object') return false
      return (
        a.reason === b.reason &&
        sameShape(a.shell, b.shell) &&
        sameShape(a.field, b.field) &&
        sameFields(a.fields, b.fields) &&
        sameShape(a.notice, b.notice) &&
        sameShape(a.terminal, b.terminal)
      )
    }

    /**
     * The plugin's one-liner or its settings form, as the Plugins page asks.
     *
     * The Hook is called unconditionally and outside the guard: React counts
     * Hooks, so a body that sometimes skipped it would take the page down
     * instead of showing a failure. Only the rendering below is guarded, and a
     * failure there is written onto the page rather than blanking the entry.
     */
    function CommandQuitCard(props) {
      const safe = props !== null && typeof props === 'object' ? props : {}
      let state
      let stateError
      try {
        state = typeof safe.useCommandQuitCard === 'function' ? safe.useCommandQuitCard(SAME_SNAPSHOT) : undefined
      } catch (error) {
        recordDiag('card-state', error)
        state = undefined
        stateError = error
      }
      try {
        return renderCommandQuitCard(safe, state, stateError)
      } catch (error) {
        recordDiag('card', error)
        return h(
          'p',
          { className: 'cqdiag', role: 'alert' },
          t_of(safe, 'renderFailed') + describeError(error)
        )
      }
    }

    /** The dictionary lookup, with a readable fallback when none was supplied. */
    function t_of(props, key) {
      try {
        if (props !== null && typeof props === 'object' && typeof props.t === 'function') return props.t(key)
      } catch {
        // Fall through to the key itself.
      }
      return key
    }

    /** The card itself. */
    function renderCommandQuitCard(props, state, stateError) {
      const t = (key) => t_of(props, key)
      if (props.view === 'summary') return t('summary')
      if (state === undefined || state === null || typeof state !== 'object') {
        return h(
          'p',
          { className: 'cqdiag', role: 'alert' },
          stateError === undefined ? t('noSettings') : t('renderFailed') + describeError(stateError)
        )
      }

      const field = state.field ?? ABSENT_SNAPSHOT.field
      const shell = state.shell ?? ABSENT_SNAPSHOT.shell
      const invalid = String(field.text ?? '').length > 0 && !NAME_PATTERN.test(String(field.text))
      const notice = state.notice
      const fields = state.fields ?? ABSENT_SNAPSHOT.fields
      const terminalName = fields.name ?? ABSENT_SNAPSHOT.fields.name
      const terminalEnabled = String((fields.enabled ?? ABSENT_SNAPSHOT.fields.enabled).text ?? 'true') === 'true'
      const terminalConfirm = String((fields.confirm ?? ABSENT_SNAPSHOT.fields.confirm).text ?? 'true') === 'true'
      const terminalInvalid = String(terminalName.text ?? '').length > 0 && !NAME_PATTERN.test(String(terminalName.text))
      const locked = !shell.writable || shell.saving
      const terminalStatus = formatTerminalStatus(t, state.terminal)
      const terminalBad = state.terminal?.state === 'conflict' || state.terminal?.state === 'error'
      const actions = {
        edit: typeof props.edit === 'function' ? props.edit : NO_ACTIONS.edit,
        resetField: typeof props.resetField === 'function' ? props.resetField : NO_ACTIONS.resetField,
        save: typeof props.save === 'function' ? props.save : NO_ACTIONS.save,
        discard: typeof props.discard === 'function' ? props.discard : NO_ACTIONS.discard
      }
      return h(
        primitives.SettingsForm,
        {
          labels: formLabels(t),
          state: {
            available: shell.available,
            writable: shell.writable,
            dirty: shell.dirty || invalid,
            invalid: shell.invalid || invalid,
            saving: shell.saving,
            failed: shell.failed
          },
          onSave: actions.save,
          onDiscard: actions.discard
        },
        h('p', { key: 'intro', className: 'cqintro' }, state.reason === 'settings' ? t('noSettings') : t('intro')),
        h(
          'div',
          { key: 'presets', className: 'cqpresets' },
          h('span', { className: 'cqpresetsLabel' }, t('presets')),
          h(
            'div',
            { className: 'cqchips' },
            PRESETS.map((preset) =>
              h(PresetChip, {
                key: preset,
                name: preset,
                active: String(field.text ?? '') === preset,
                disabled: !shell.writable,
                onPick: () => actions.edit(FIELD, preset)
              })
            )
          )
        ),
        h(primitives.SettingsValueField, {
          key: 'name',
          id: 'plugin-config-command-quit-name',
          label: t('name'),
          hint: shell.failed ? t('conflict') : t('hint'),
          invalidLabel: t('invalid'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          // The form's own projection goes first: its `invalid` only reports a
          // draft the field spec cannot parse, so the name rule is layered on top.
          ...field,
          invalid: field.invalid || invalid,
          disabled: !shell.writable,
          onEdit: (text) => {
            actions.edit(FIELD, text)
          },
          onReset: () => {
            actions.resetField(FIELD)
          }
        }),
        h(
          'div',
          { key: 'terminal', className: 'cqsection' },
          h('h4', { className: 'cqsectionTitle' }, t('terminalTitle')),
          h('p', { className: 'cqsectionIntro' }, t('terminalIntro')),
          h(
            'div',
            { className: 'cqrow' },
            h(
              'div',
              { className: 'cqrowText' },
              h('span', { className: 'cqrowLabel' }, t('terminalToggle')),
              h('span', { className: 'cqrowHint' }, t('terminalToggleHint'))
            ),
            h(ToggleControl, {
              checked: terminalEnabled,
              disabled: locked,
              label: t('terminalToggle'),
              onChange: (next) => {
                actions.edit(TERMINAL_ENABLED_FIELD, next ? 'true' : 'false')
              }
            })
          ),
          h(
            'div',
            { className: terminalEnabled ? 'cqrow' : 'cqrow cqrowOff' },
            h(
              'div',
              { className: 'cqrowText' },
              h('span', { className: 'cqrowLabel' }, t('confirmToggle')),
              h('span', { className: 'cqrowHint' }, terminalEnabled ? t('confirmToggleHint') : t('confirmDisabledHint'))
            ),
            h(ToggleControl, {
              checked: terminalConfirm,
              disabled: locked || !terminalEnabled,
              label: t('confirmToggle'),
              title: terminalEnabled ? undefined : t('confirmDisabledHint'),
              onChange: (next) => {
                actions.edit(TERMINAL_CONFIRM_FIELD, next ? 'true' : 'false')
              }
            })
          ),
          h(
            'div',
            { className: 'cqpresets' },
            h('span', { className: 'cqpresetsLabel' }, t('terminalPresets')),
            h(
              'div',
              { className: 'cqchips' },
              TERMINAL_PRESETS.map((preset) =>
                h(PresetChip, {
                  key: preset,
                  name: preset,
                  prefix: '',
                  active: String(terminalName.text ?? '') === preset,
                  disabled: locked,
                  onPick: () => actions.edit(TERMINAL_NAME_FIELD, preset)
                })
              )
            )
          ),
          h(primitives.SettingsValueField, {
            key: 'terminalName',
            id: 'plugin-config-command-quit-terminal-name',
            label: t('terminalName'),
            hint: t('terminalHint'),
            invalidLabel: t('invalid'),
            overriddenLabel: t('overridden'),
            resetLabel: t('reset'),
            ...terminalName,
            invalid: terminalName.invalid || terminalInvalid,
            disabled: locked,
            onEdit: (text) => {
              actions.edit(TERMINAL_NAME_FIELD, text)
            },
            onReset: () => {
              actions.resetField(TERMINAL_NAME_FIELD)
            }
          }),
          terminalStatus === undefined
            ? undefined
            : h(
                'p',
                { className: terminalBad ? 'cqstatus cqstatusBad' : 'cqstatus', role: terminalBad ? 'alert' : undefined },
                terminalStatus
              )
        ),
        notice === undefined
          ? undefined
          : h('p', { key: 'shadow', className: 'cqshadow', role: 'alert' }, formatShadow(t, notice)),
        shell.failed
          ? h('p', { key: 'failed', className: 'cqfailed', role: 'alert' }, t('conflict'))
          : undefined,
        h('p', { key: 'disclaimer', className: 'cqnote' }, t('disclaimer'))
      )
    }

    /**
     * The frame-wide notice: the same conflict, shown outside the settings page.
     *
     * It renders nothing while there is no conflict, and one dismissal hides one
     * specific conflict — a later one, or a restart that still reports the same
     * one, raises the notice again. Its data comes from this module, never from
     * a slot-injected prop, and the whole body is guarded: this layer sits above
     * the settings dialog, so throwing here would take the dialog with it.
     */
    function QuitNoticeBanner(props) {
      // React hooks are the only place this entry depends on the shell's module
      // table. A deployment whose table lacks them gets no frame notice at all,
      // which is strictly better than an entry that throws on every render.
      if (typeof react.useState !== 'function' || typeof react.useEffect !== 'function') return null
      const [, setTick] = react.useState(0)
      const [dismissed, setDismissed] = react.useState(undefined)
      react.useEffect(() => {
        try {
          setTick((value) => value + 1)
          return subscribeClientNotice(() => setTick((value) => value + 1))
        } catch (error) {
          recordDiag('banner-subscribe', error)
          return undefined
        }
      }, [])
      try {
        const notice = noticeCurrent
        if (notice === undefined) return null
        const key = noticeKey(notice)
        if (dismissed === key) return null
        const t = (name) => t_of(props, name)
        return h(
          'div',
          { className: 'cqbanner', role: 'alert' },
          h('span', { className: 'cqbannerText' }, formatShadow(t, notice)),
          h(
            'button',
            {
              type: 'button',
              className: 'cqbannerClose',
              'aria-label': t('dismiss'),
              title: t('dismiss'),
              onClick: () => setDismissed(key)
            },
            '×'
          )
        )
      } catch (error) {
        recordDiag('banner', error)
        return null
      }
    }

    /**
     * Stage the command name over this plugin's settings namespace.
     *
     * The form model owns the draft and the single write; this controller only
     * projects the model — plus the Host's runtime notice, which the settings
     * mirror carries as an ordinary field — into what the card renders.
     * Construction is defensive: a deployment whose settings seam is missing
     * still gets the page, with the reason written on it.
     */
    var CommandQuitCardController = class {
      constructor(build, readNotice, readTerminal) {
        this.form = undefined
        this.formStore = undefined
        this.build = build
        this.readNotice = readNotice
        this.readTerminal = readTerminal
        this.store = this.createStore()
        this.rebuild()
      }
      /**
       * Bind the form once, if the settings seam is available yet.
       *
       * The binding is the form's own — `SettingsFormModel.bind` — exactly as
       * the shipped settings pages do it, so the snapshot it hands a reader is
       * cached until the form actually moves.
       *
       * @returns whether a form is bound now.
       */
      rebuild() {
        if (this.form !== undefined) return true
        const form = this.build()
        if (form === undefined) return false
        this.form = form
        this.formStore = form.bind(() => this.projection())
        return true
      }
      /**
       * The reader the page's Hook binds to.
       *
       * Created once and never replaced: DSH binds a Hook to this object's
       * identity, so swapping it would leave the page on a dead source. Every
       * read returns the SAME object until something actually changed — React's
       * `useSyncExternalStore` re-renders for as long as two consecutive reads
       * differ, so a snapshot built fresh per read would re-render this page,
       * and the settings page it sits on, forever.
       */
      createStore() {
        let cached
        return {
          getSnapshot: () => {
            let next
            try {
              const store = this.formStore
              next =
                store === undefined || typeof store.getSnapshot !== 'function'
                  ? this.projection()
                  : store.getSnapshot()
            } catch (error) {
              recordDiag('snapshot', error)
              next = ABSENT_SNAPSHOT
            }
            if (next === null || next === undefined || typeof next !== 'object') next = ABSENT_SNAPSHOT
            if (cached !== undefined && sameProjection(cached, next)) return cached
            cached = next
            return cached
          },
          subscribe: (listener) => {
            const store = this.formStore
            if (store === undefined || typeof store.subscribe !== 'function') return () => {}
            return store.subscribe(listener)
          }
        }
      }
      ensure() {
        if (this.form === undefined) {
          if (!this.rebuild()) return undefined
        }
        return this.form
      }
      projection() {
        const form = this.form
        let notice
        let terminal
        try {
          notice = this.readNotice()
        } catch {
          notice = undefined
        }
        try {
          terminal = this.readTerminal()
        } catch {
          terminal = undefined
        }
        if (form === undefined) {
          return {
            shell: { available: false, writable: false, dirty: false, invalid: false, saving: false, failed: false },
            field: { text: '', overridden: false, invalid: false },
            fields: ABSENT_SNAPSHOT.fields,
            reason: 'settings',
            notice,
            terminal
          }
        }
        return {
          shell: form.shell(),
          field: form.field(FIELD),
          fields: {
            enabled: form.field(TERMINAL_ENABLED_FIELD),
            confirm: form.field(TERMINAL_CONFIRM_FIELD),
            name: form.field(TERMINAL_NAME_FIELD)
          },
          notice,
          terminal
        }
      }
      inject() {
        const form = this.ensure()
        const actions = form === undefined ? NO_ACTIONS : form.actions()
        return {
          hooks: { commandQuitCard: this.store },
          ...actions
        }
      }
      dispose() {
        this.form?.dispose()
        this.form = undefined
        this.formStore = undefined
      }
    }

    /**
     * Follow the settings mirror and publish the Host's notice into this module.
     *
     * Subscribes to the settings mirror when that adapter offers a subscription,
     * and to the forwarded `settings/document-updated` event as well, so a
     * deployment that exposes only one of the two still updates live. A
     * deployment that offers neither falls back to a slow re-read, because a
     * notice that never arrives is worse than a stale one.
     */
    function watchNotice(ctx, settingsAdapter, publish) {
      const read = () => {
        const adapter = settingsAdapter()
        if (adapter === undefined || typeof adapter.getSnapshot !== 'function') return undefined
        try {
          return parseNotice(adapter.getSnapshot()?.value?.[NOTICE_FIELD])
        } catch {
          return undefined
        }
      }
      const push = () => {
        try {
          publish(read())
        } catch (error) {
          recordDiag('notice', error)
        }
      }
      push()
      const disposers = []
      try {
        const adapter = settingsAdapter()
        if (adapter !== undefined && typeof adapter.subscribe === 'function') {
          const off = adapter.subscribe(push)
          if (typeof off === 'function') disposers.push(off)
        }
      } catch {
        // No adapter subscription available.
      }
      try {
        const remote = ctx.get('remote')
        if (remote !== undefined && typeof remote.$on === 'function') {
          const off = remote.$on('settings/document-updated', push)
          if (typeof off === 'function') disposers.push(off)
        }
      } catch {
        // No forwarded-event subscription available.
      }
      let timer
      if (disposers.length === 0 && typeof setInterval === 'function') {
        timer = setInterval(push, 3000)
      }
      return () => {
        if (timer !== undefined) clearInterval(timer)
        for (const off of disposers) {
          try {
            off()
          } catch {
            // Disposal is best effort.
          }
        }
      }
    }

    /** The shared chip styles, injected once per page. */
    function injectStyles() {
      if (typeof document === 'undefined') return
      const id = 'dsh-command-quit/styles'
      if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-command-quit'
      tag.dataset.pluginCss = id
      tag.textContent = [
        '.cqintro{margin:0 0 12px;font-size:13px;color:var(--dsw-alias-label-tertiary)}',
        '.cqpresets{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}',
        '.cqpresetsLabel{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.cqchips{display:flex;flex-wrap:wrap;gap:6px}',
        '.cqchip{font:inherit;font-size:12px;line-height:18px;padding:2px 10px;border-radius:9px;',
        'border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
        '.cqchip:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
        '.cqchipActive{background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary)}',
        '.cqchip:disabled{cursor:default;opacity:.5}',
        '.cqsection{margin:16px 0 0;padding-top:12px;border-top:0.5px solid var(--dsw-alias-border-l2)}',
        '.cqsectionTitle{margin:0 0 6px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.cqsectionIntro{margin:0 0 10px;font-size:13px;line-height:19px;color:var(--dsw-alias-label-tertiary)}',
        '.cqrow{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}',
        '.cqrowText{display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.cqrowLabel{font-size:13px;color:var(--dsw-alias-label-primary)}',
        '.cqrowHint{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}',
        '.cqrowOff{opacity:.6}',
        '.cqstatus{margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);word-break:break-all}',
        '.cqstatusBad{color:var(--dsw-alias-label-error,#e5484d)}',
        '.cqfailed{margin:10px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-error,#e5484d)}',
        '.cqshadow{margin:10px 0 0;padding:8px 10px;border-radius:8px;font-size:12px;line-height:18px;',
        'background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-error,#e5484d)}',
        '.cqdiag{margin:10px 0 0;padding:8px 10px;border-radius:8px;font-size:12px;line-height:18px;',
        'background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-error,#e5484d)}',
        '.cqnote{margin:14px 0 0;padding-top:10px;font-size:12px;line-height:18px;',
        'border-top:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}',
        '.cqbanner{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;pointer-events:none;',
        'display:flex;align-items:flex-start;gap:10px;max-width:min(560px,calc(100vw - 48px));',
        'padding:10px 12px;border-radius:10px;font-size:13px;line-height:19px;',
        'background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary);',
        'border:0.5px solid var(--dsw-alias-border-l2);box-shadow:0 6px 24px rgba(0,0,0,.18)}',
        '.cqbannerText{pointer-events:none}',
        '.cqbannerClose{pointer-events:auto;flex:none;font:inherit;font-size:16px;line-height:1;cursor:pointer;',
        'border:0;background:transparent;color:var(--dsw-alias-label-tertiary);padding:0 2px}'
      ].join('')
      document.head.appendChild(tag)
    }

    /** Required services (cordis fiber inject); mirrors the official settings pages. */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * Mount this plugin's configuration page on the Plugins page, plus the
     * frame-wide notice for a conflict the Host resolved on its own.
     *
     * The page is registered unconditionally rather than through
     * `configForms.whileServed`: this plugin owns its namespace, so the page is
     * never a cross-plugin contribution, and whenever the plugin is composed at
     * all the settings seam is composed with it. The form is built lazily so a
     * failure there can be written on the page instead of killing the plugin.
     *
     * Order matters. The page is registered first and every later step is
     * guarded on its own, so nothing the frame-wide notice does can leave the
     * user without the settings page.
     *
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en
          }),
        'dsh-command-quit: dictionaries'
      )
      try {
        injectStyles()
      } catch (error) {
        recordDiag('styles', error)
      }
      let adapter
      let adapterResolved = false
      const settingsAdapter = () => {
        if (!adapterResolved) {
          // Only a resolved adapter locks the cache. A lookup that answers
          // `undefined` (the namespace is not served yet) or throws must stay
          // retryable: the caller runs again on every render, so the page
          // recovers by itself once the settings seam is ready instead of
          // staying on “拿不到设置服务” until a restart.
          try {
            const resolved = ctx.get('configForms')?.get(SETTINGS_NAMESPACE)
            if (resolved !== undefined) {
              adapter = resolved
              adapterResolved = true
            }
          } catch (error) {
            recordDiag('adapter', error)
          }
        }
        return adapter
      }
      const readNotice = () => {
        const current = settingsAdapter()
        if (current === undefined || typeof current.getSnapshot !== 'function') return undefined
        try {
          return parseNotice(current.getSnapshot()?.value?.[NOTICE_FIELD])
        } catch {
          return undefined
        }
      }
      const readTerminal = () => {
        const current = settingsAdapter()
        if (current === undefined || typeof current.getSnapshot !== 'function') return undefined
        try {
          return parseTerminalStatus(current.getSnapshot()?.value?.[TERMINAL_NOTICE_FIELD])
        } catch {
          return undefined
        }
      }
      const buildForm = () => {
        const target = settingsAdapter()
        if (target === undefined) return undefined
        try {
          return new primitives.SettingsFormModel(target, [
            primitives.settingsTextField(FIELD),
            settingsBooleanField(TERMINAL_ENABLED_FIELD),
            settingsBooleanField(TERMINAL_CONFIRM_FIELD),
            primitives.settingsTextField(TERMINAL_NAME_FIELD)
          ])
        } catch (error) {
          recordDiag('form', error)
          return undefined
        }
      }
      const card = new CommandQuitCardController(buildForm, readNotice, readTerminal)
      ctx.effect(() => () => {
        card.dispose()
      }, 'dsh-command-quit: form subscription')
      ctx.effect(
        () => {
          try {
            return ctx.slots.inject('plugins.item', () =>
              ctx.slots.register(
                {
                  name: 'plugins.item',
                  id: SETTINGS_NAMESPACE,
                  order: 50,
                  label: () => t('title'),
                  locale: NS,
                  inject: () => card.inject()
                },
                CommandQuitCard
              )
            )
          } catch (error) {
            recordDiag('page', error)
            return undefined
          }
        },
        'dsh-command-quit: page'
      )
      ctx.effect(
        () => {
          try {
            return watchNotice(ctx, settingsAdapter, publishClientNotice)
          } catch (error) {
            recordDiag('watch', error)
            return undefined
          }
        },
        'dsh-command-quit: notice watch'
      )
      ctx.effect(
        () => {
          try {
            return ctx.slots.inject('shell.overlay', () =>
              ctx.slots.register(
                {
                  name: 'shell.overlay',
                  id: SETTINGS_NAMESPACE + '-notice',
                  order: 90,
                  locale: NS
                },
                QuitNoticeBanner
              )
            )
          } catch (error) {
            recordDiag('overlay', error)
            return undefined
          }
        },
        'dsh-command-quit: frame notice'
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
