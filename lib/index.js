/**
 * Human-facing quit command: closes the DeepSeek Harness desktop client.
 *
 * The command runs in the Host child process that the Electron shell spawns over
 * an IPC channel. Asking the shell to quit reuses the normal Desktop quit path,
 * including the native confirmation dialog when work is running. The shell
 * advertises that channel through `DSH_DESKTOP_QUIT_REQUEST`, so a shell without
 * the channel reports a plain failure instead of treating the request as a
 * protocol error.
 *
 * The command name is configurable: the plugin declares a volatile
 * `commandName` field, so DSH renders it as an editable plugin setting and
 * commits a change into the running plugin without a restart. Exactly one name
 * is registered at a time, and a name is refused when it fails the platform's
 * command-name rules or when another command already owns it.
 *
 * A name can also be taken AFTER a save: commands registered inside an
 * agent/preset scope appear while a session runs, and a scoped definition
 * shadows a global one of the same name. The registry announces every
 * registration through `commands/change`, so the plugin re-checks ownership
 * after every change, falls back to the default name when it has been
 * shadowed, and — because a silent fallback is exactly the failure this whole
 * check exists to prevent — publishes the reason into its own settings entry,
 * where the browser half renders it as a notice instead of leaving it in a log
 * file.
 *
 * @module dsh-command-quit
 */

import z from '@deepseek-ai/schemastery'

/** Loader identity for this plugin. */
export const name = 'command-quit'

/** The Host command registry is the only service this plugin requires. */
export const inject = ['commands']

/** Environment marker the desktop shell sets when it accepts `quit-request`. */
const SHELL_CHANNEL_ENV = 'DSH_DESKTOP_QUIT_REQUEST'

/** Message type the Electron shell answers with its ordinary quit flow. */
const QUIT_REQUEST = Object.freeze({ type: 'quit-request' })

/** Result of asking the owning shell to quit. */
const NO_SHELL = 'no-shell'

/** Command name used when the configuration carries none. */
export const DEFAULT_COMMAND_NAME = 'quit-dsh'

/** Ready-made names offered in the configuration page. */
export const PRESET_COMMAND_NAMES = Object.freeze(['quit', 'quit-dsh', 'quitdsh', 'qd'])

/** The platform's own command-name rule (`@deepseek-ai/dsh-commands`). */
export const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

/**
 * Settings namespace of this plugin: the profile patch entry id that carries
 * this plugin's configuration. The browser half reads and writes the same key.
 */
export const SETTINGS_NAMESPACE = 'command-quit'

/**
 * Description every registration of this plugin carries.
 *
 * This is display copy only. Ownership is decided by
 * {@link COMMAND_DEFINITION_ID}, because DSH is free to normalize, translate or
 * otherwise rewrite a description; the text survives as the fallback for a
 * registry build that drops unknown definition fields.
 */
export const COMMAND_DESCRIPTION = '关闭 DeepSeek Harness 客户端（退出程序）'

/**
 * Stable, plugin-namespaced identity of this plugin's command definition.
 *
 * `@deepseek-ai/dsh-commands` carries an optional branded `definitionId` from
 * `commands.register()` into the frozen definition `commands.find()` returns,
 * and documents it as identity that is independent of display copy (the client
 * uses the same field to recognise first-party definitions). Comparing this
 * constant is therefore immune to any later normalization of the description.
 *
 * The value is namespaced under this plugin so it can never equal a built-in
 * `@deepseek-ai/…` identity, and it is a plain constant: no per-registration
 * state has to be saved or cleared when a registration is released.
 */
export const COMMAND_DEFINITION_ID = 'dsh-command-quit'

/** Notice kind published when a scoped definition shadows the configured name. */
export const NOTICE_SHADOWED = 'shadowed'

/**
 * Editable configuration plus the host-written runtime notice.
 *
 * `volatile()` is what makes a field appear in the native configuration page and
 * what lets a change reach the running plugin without a reload. `notice` is
 * written by this plugin only — never by hand — and carries the reason its
 * configured name is not the one in force, so the settings page and the
 * frame-wide notice can explain a fallback the user would otherwise never see.
 */
export const Config = z.object({
  commandName: z.string().default(DEFAULT_COMMAND_NAME).pattern(COMMAND_NAME_PATTERN).volatile(),
  notice: z.string().default('').volatile()
})

/**
 * Ask the Electron shell that owns this Host to quit.
 * @returns `NO_SHELL` without a desktop shell, a failure description when the
 *   request could not be delivered, or `undefined` once it was delivered.
 */
async function requestShellQuit() {
  if (process.env[SHELL_CHANNEL_ENV] !== '1') return NO_SHELL
  if (process.connected !== true || typeof process.send !== 'function') return NO_SHELL
  try {
    await new Promise((resolve, reject) => {
      process.send(QUIT_REQUEST, (error) => {
        if (error === null || error === undefined) resolve()
        else reject(error)
      })
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}

/**
 * Check a candidate command name against the platform's rule.
 * @param value - the raw configured value.
 * @returns `{ ok: true, name }` for an acceptable name, or `{ ok: false, message }`.
 */
export function validateCommandName(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, message: '命令名不能为空。' }
  }
  if (!COMMAND_NAME_PATTERN.test(value)) {
    return {
      ok: false,
      message: `命令名“${value}”不合法：必须以小写英文字母开头，只能包含小写字母、数字、下划线（_）或连字符（-），不能有大写字母、空格、中文或其他符号。`
    }
  }
  return { ok: true, name: value }
}

/**
 * Read a plain value out of a possibly volatile config field.
 * @param field - the raw field or a volatile reference to it.
 * @returns the plain value, or `undefined`.
 */
function readField(field) {
  if (field !== null && typeof field === 'object' && typeof field.get === 'function') {
    try {
      return field.get()
    } catch {
      return undefined
    }
  }
  return field
}

/**
 * Encode the runtime status the browser half renders.
 * @param payload - a JSON-shaped status object, or nothing to clear the notice.
 * @returns the string stored in the `notice` config field.
 */
export function encodeNotice(payload) {
  if (payload === undefined || payload === null) return ''
  try {
    return JSON.stringify(payload)
  } catch {
    return ''
  }
}

/**
 * Whether one registry result is this plugin's own registration.
 *
 * The definition identity is authoritative whenever the registry carries it:
 * `commands.find()` hands back the frozen definition `register()` produced, and
 * `definitionId` is documented as the stable identity that is independent of
 * display copy. A foreign definition — a DSH built-in, or another plugin's —
 * carries its own identity and is rejected here whatever its description says.
 *
 * A registry build that drops the field (or a definition recorded before this
 * field existed) leaves no identity to compare, so the description is still
 * accepted as a normalized fallback: `trim()` on both sides absorbs the
 * whitespace normalization that would have broken the old strict comparison.
 *
 * @param definition - what `commands.find()` returned, if anything.
 * @returns `true` when the definition is this plugin's own registration.
 */
export function isOwnDefinition(definition) {
  if (definition === undefined || definition === null) return false
  const id = definition.definitionId
  if (typeof id === 'string') return id === COMMAND_DEFINITION_ID
  if (typeof definition.description !== 'string') return false
  return definition.description.trim() === COMMAND_DESCRIPTION.trim()
}

/**
 * Every command scope this registry currently knows.
 *
 * Commands live in a global layer plus one layer per live agent scope, and a
 * scoped registration SHADOWS a global one of the same name for that scope —
 * DSH's own `/compact`, `/goal` and `/plan` are registered inside agent presets,
 * so they are invisible to a global-only lookup. Enumerating the registry's
 * known scopes is what lets the check see them; a build that does not expose
 * them simply falls back to the global layer.
 *
 * @param commands - the Host command registry.
 * @returns the scope keys to consult, `undefined` (the global layer) first.
 */
function commandScopes(commands) {
  const scopes = [undefined]
  try {
    const scoped = commands?.layers?.scoped
    if (scoped !== undefined && typeof scoped.keys === 'function') {
      for (const key of scoped.keys()) scopes.push(key)
    }
  } catch {
    // Internals of another shape: the global layer alone still catches the
    // collisions a global registration could not survive.
  }
  return scopes
}

/**
 * Refuse a candidate that another command already owns.
 *
 * The name is looked up in every scope the registry knows, because the layer a
 * name is registered in decides who wins: a global registration that a scoped
 * definition shadows is registered successfully yet never reachable, which is
 * exactly the failure this check exists to prevent.
 *
 * @param commands - the Host command registry.
 * @param candidate - the validated name a save or a reload wants to register.
 * @param ownName - the name this plugin currently registers, excluded from the check.
 * @throws When another definition owns the name in any scope.
 */
export function assertCommandNameAvailable(commands, candidate, ownName) {
  if (candidate === ownName) return
  for (const scope of commandScopes(commands)) {
    const taken = commands.find(scope, candidate)
    if (taken === undefined) continue
    // A scope that resolves to this plugin's own registration is not a conflict:
    // a scoped lookup falls back to the global layer, so every scope reports the
    // plugin's own name back once it is registered.
    if (isOwnDefinition(taken)) continue
    const owner = typeof taken.description === 'string' && taken.description.length > 0 ? `（${taken.description}）` : ''
    const where = scope === undefined ? '' : '（该名字在某个会话/预设的作用域里已被占用，用它会让退出命令被遮住）'
    throw new Error(`命令名“/${candidate}”已被其他命令占用${owner}${where}，请换一个。`)
  }
}

/**
 * Find the scope that shadows one registered name, if any.
 *
 * Only scoped layers are consulted: within a single layer a duplicate name is
 * refused at registration time, so a name that resolves inside an agent/preset
 * scope while this plugin registered it globally can only be a definition that
 * appeared later and took the name away for that scope.
 *
 * @param commands - the Host command registry.
 * @param name - the name this plugin believes it owns.
 * @returns `{ scope, definition }` for the first shadowing scope, else `undefined`.
 */
export function findShadowingScope(commands, name) {
  if (typeof name !== 'string' || name.length === 0) return undefined
  for (const scope of commandScopes(commands)) {
    if (scope === undefined) continue
    let taken
    try {
      taken = commands.find(scope, name)
    } catch {
      continue
    }
    if (taken === undefined) continue
    if (isOwnDefinition(taken)) continue
    return { scope, definition: taken }
  }
  return undefined
}

/**
 * Find the definition that currently owns one name, in any layer.
 *
 * This is the describing counterpart of {@link assertCommandNameAvailable}: a
 * refusal at save or startup can come from the global layer as easily as from a
 * scope, and the notice has to be able to name the owner either way.
 *
 * @param commands - the Host command registry.
 * @param name - the name to look up.
 * @returns the owning definition, or `undefined` when the name is free.
 */
export function findOwner(commands, name) {
  if (typeof name !== 'string' || name.length === 0) return undefined
  for (const scope of commandScopes(commands)) {
    let taken
    try {
      taken = commands.find(scope, name)
    } catch {
      continue
    }
    if (taken === undefined) continue
    if (isOwnDefinition(taken)) continue
    return taken
  }
  return undefined
}

/**
 * Resolve the command name a configuration should register.
 *
 * A configuration the platform accepted always carries a legal name; a name
 * that is missing or illegal (a hand-edited patch file, say) falls back to the
 * default so the user is never left without a way to quit.
 *
 * @param config - the resolved plugin config (volatile references).
 * @returns `{ name }` plus the refused raw value when a fallback was taken.
 */
function resolveCommandName(config) {
  const raw = readField(config?.commandName)
  if (raw === undefined || raw === null || raw === '') return { name: DEFAULT_COMMAND_NAME }
  const verdict = validateCommandName(raw)
  if (verdict.ok) return { name: verdict.name }
  return { name: DEFAULT_COMMAND_NAME, refused: String(raw) }
}

/**
 * Check one candidate configuration and throw when it must not be saved.
 * @param ctx - Host context carrying the command registry.
 * @param raw - the candidate raw config the configuration editor is about to persist.
 * @param ownName - the name this plugin currently registers.
 */
function checkCandidateConfig(ctx, raw, ownName) {
  const candidate = raw?.commandName
  if (candidate === undefined || candidate === null || candidate === '') return
  const verdict = validateCommandName(candidate)
  if (!verdict.ok) throw new Error(verdict.message)
  assertCommandNameAvailable(ctx.commands, verdict.name, ownName)
}

/**
 * Whether one `internal/config` dispatch is this plugin's own save.
 *
 * Two independent readings are accepted, so the guard survives a build that
 * binds the dispatch `this` to a wrapper rather than to the entry fiber: the
 * dispatch runs for this plugin's fiber, or it carries this plugin's own
 * profile patch entry id (the settings namespace).
 *
 * @param fiber - the dispatch `this` (a Fiber, or nothing).
 * @param ctx - this plugin's Host context.
 * @returns `true` when this plugin owns the entry being saved.
 */
export function guardsOwnEntry(fiber, ctx) {
  if (fiber === ctx.fiber) return true
  const id = fiber?.entry?.options?.id
  return typeof id === 'string' && id === SETTINGS_NAMESPACE
}

/**
 * Register the configured quit command for the Host lifetime, and re-register
 * it whenever the volatile name changes.
 * @param ctx - Host context carrying the command registry.
 * @param config - the resolved plugin config (volatile references).
 */
export function apply(ctx, config) {
  let disposeCommand
  let registeredName
  let settingsService
  let lastNotice
  // The conflict currently in force, or `undefined` while the configured name is
  // the one registered. Notice writes are driven from this single value so the
  // two paths that can raise a conflict cannot fight over the stored text.
  let conflict
  // Guards the paths that mutate the registry against the `commands/change`
  // the mutation itself emits: a registration of ours is not news about someone
  // else, and re-entering the re-check from inside it would register in a loop.
  let busy = false

  const configuredName = () => resolveCommandName(config).name

  const readNotice = () => {
    const raw = readField(config?.notice)
    return typeof raw === 'string' ? raw : ''
  }

  /**
   * Store the runtime notice in this plugin's own settings entry.
   *
   * The settings document is the one channel a plain plugin owns that reaches
   * the browser half live: DSH forwards `settings/document-updated` and the
   * client's settings mirror follows it, so the page and the frame-wide notice
   * read the same value the Host wrote. A failure here is logged and dropped —
   * the command itself must keep working even when the notice cannot be shown.
   */
  const publishNotice = (text) => {
    const next = typeof text === 'string' ? text : ''
    const settings = settingsService
    // Nothing to write through yet: leave `lastNotice` unset so the notice is
    // flushed once the service arrives rather than being dropped here.
    if (settings === undefined || typeof settings.update !== 'function') return
    if (lastNotice === undefined) lastNotice = readNotice()
    if (next === lastNotice) return
    lastNotice = next
    try {
      Promise.resolve(settings.update(SETTINGS_NAMESPACE, { notice: next })).catch((error) => {
        ctx.logger.warn(`command-quit: 无法写入冲突提醒：${error instanceof Error ? error.message : String(error)}`)
      })
    } catch (error) {
      ctx.logger.warn(`command-quit: 无法写入冲突提醒：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Push the conflict in force to the browser half, clearing it once resolved. */
  const settleNotice = () => {
    publishNotice(conflict === undefined ? '' : encodeNotice(conflict))
  }

  /** The description of an owning definition, for the notice and the log. */
  const ownerOf = (definition) => (
    typeof definition?.description === 'string' ? definition.description : ''
  )

  const releaseCommand = () => {
    if (disposeCommand === undefined) return
    const dispose = disposeCommand
    disposeCommand = undefined
    registeredName = undefined
    dispose()
  }

  const handleQuit = async () => {
    const commandName = registeredName ?? resolveCommandName(config).name
    const failure = await requestShellQuit()
    if (failure === NO_SHELL) {
      return {
        kind: 'error',
        text: `/${commandName} 需要桌面客户端的退出通道，当前 Host 未提供（不是在 DeepSeek Harness 桌面客户端中运行，或客户端外壳的退出补丁已丢失）。`
      }
    }
    if (failure !== undefined) {
      return { kind: 'error', text: `无法通知客户端退出：${failure}` }
    }
    return { kind: 'success', text: '正在退出 DeepSeek Harness…' }
  }

  const registerName = (name) => {
    releaseCommand()
    const dispose = ctx.commands.register({
      definitionId: COMMAND_DEFINITION_ID,
      name,
      description: COMMAND_DESCRIPTION,
      handler: handleQuit
    })
    disposeCommand = dispose
    registeredName = name
  }

  /** Whether the fallback name can be registered at all right now. */
  const defaultNameIsFree = () => {
    try {
      assertCommandNameAvailable(ctx.commands, DEFAULT_COMMAND_NAME, undefined)
      return true
    } catch (error) {
      ctx.logger.error(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const syncCommand = () => {
    if (busy) return
    busy = true
    try {
      const resolved = resolveCommandName(config)
      if (resolved.refused !== undefined) {
        ctx.logger.warn(
          `command-quit: 配置中的命令名“${resolved.refused}”不合法，已改用默认命令名“${resolved.name}”。`
        )
      }
      if (resolved.name === registeredName) return
      try {
        assertCommandNameAvailable(ctx.commands, resolved.name, registeredName)
      } catch (error) {
        ctx.logger.error(error instanceof Error ? error.message : String(error))
        // Keep whatever command is already live: a refused name must never leave
        // the user without a way to quit.
        if (registeredName !== undefined) return
        // Nothing is live — a name exported in the saved configuration is already
        // taken (it can be shadowed by a scope that only exists while a session
        // runs). Fall back to the default so the way out stays reachable.
        if (resolved.name === DEFAULT_COMMAND_NAME) return
        if (!defaultNameIsFree()) return
        ctx.logger.warn(
          `command-quit: 命令名“${resolved.name}”被占用，已改用默认命令名“${DEFAULT_COMMAND_NAME}”。请在配置页里另选一个名字。`
        )
        registerName(DEFAULT_COMMAND_NAME)
        conflict = {
          kind: NOTICE_SHADOWED,
          configured: resolved.name,
          active: DEFAULT_COMMAND_NAME,
          owner: ownerOf(findOwner(ctx.commands, resolved.name))
        }
        settleNotice()
        return
      }
      registerName(resolved.name)
      conflict = undefined
      settleNotice()
    } finally {
      busy = false
    }
  }

  /**
   * Re-check, after the registry changed, that the live name is still ours.
   *
   * This is the delayed-registration case the save-time check cannot see: the
   * scope a competing definition lives in may not have existed when the user
   * pressed save. When the name has been taken away, the plugin falls back to
   * the default and tells the user — in the settings page and in a frame-wide
   * notice — instead of going quiet.
   */
  const recheckShadow = () => {
    if (busy || registeredName === undefined) return
    const shadow = findShadowingScope(ctx.commands, registeredName)
    if (shadow === undefined) {
      // Nothing shadows the live name. A fallback the save or startup path took
      // stays reported until the configured name is the one in force again.
      if (registeredName === configuredName()) {
        conflict = undefined
        settleNotice()
      }
      return
    }
    const owner = ownerOf(shadow.definition)
    const named = owner.length > 0 ? `（${owner}）` : ''
    ctx.logger.error(
      `command-quit: 命令名“/${registeredName}”已被其他命令在某个会话/预设作用域里占用${named}，这些会话里 /${registeredName} 不会触发本插件。`
    )
    if (registeredName === DEFAULT_COMMAND_NAME) {
      conflict = {
        kind: NOTICE_SHADOWED,
        configured: configuredName(),
        active: registeredName,
        owner
      }
      settleNotice()
      return
    }
    busy = true
    try {
      if (defaultNameIsFree()) {
        registerName(DEFAULT_COMMAND_NAME)
        ctx.logger.warn(
          `command-quit: 已自动改用默认命令名“/${DEFAULT_COMMAND_NAME}”。请在配置页里另选一个没人用的名字。`
        )
        conflict = {
          kind: NOTICE_SHADOWED,
          configured: configuredName(),
          active: DEFAULT_COMMAND_NAME,
          owner
        }
      } else {
        conflict = {
          kind: NOTICE_SHADOWED,
          configured: configuredName(),
          active: registeredName,
          owner
        }
      }
      settleNotice()
    } finally {
      busy = false
    }
  }

  ctx.effect(() => {
    syncCommand()
    recheckShadow()
    return releaseCommand
  }, 'command-quit lifecycle')

  ctx.effect(() => ctx.on('loader/volatile-update', () => {
    syncCommand()
    recheckShadow()
  }), 'command-quit volatile updates')

  // A scoped definition can appear long after the save that chose the name.
  // The registry announces every registration and removal, and that is the only
  // signal that the live name may have stopped being reachable.
  ctx.effect(() => ctx.on('commands/change', () => {
    if (busy) return
    if (registeredName === undefined) {
      syncCommand()
      return
    }
    recheckShadow()
  }), 'command-quit shadow watch')

  // Registered global so the check runs for every configuration save; the
  // entry test keeps it to this plugin's own entry. Throwing here happens
  // before the editor writes the profile patch, which is what makes the
  // refusal hard: the name is never persisted and never registers.
  ctx.effect(() => ctx.on('internal/config', function (raw, next) {
    const value = next()
    if (!guardsOwnEntry(this, ctx)) return value
    // A save that leaves the name alone — this plugin's own notice writes, or a
    // form save that only touches another field — has nothing to refuse, and
    // re-checking it would refuse the notice of a conflict already in force.
    if (value?.commandName === configuredName()) return value
    try {
      checkCandidateConfig(ctx, value, registeredName)
    } catch (error) {
      ctx.logger.warn(error instanceof Error ? error.message : String(error))
      throw error
    }
    return value
  }, { global: true }), 'command-quit save guard')

  ctx.inject(['settings'], (child) => {
    settingsService = child.settings
    // A conflict found before the settings seam was available is flushed here.
    settleNotice()
    child.effect(() => () => {
      if (settingsService === child.settings) settingsService = undefined
    }, 'command-quit settings handle')
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'command-quit settings policy')
  })
}
