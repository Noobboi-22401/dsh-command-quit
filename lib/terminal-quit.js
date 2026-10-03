/**
 * Host-side life cycle of the terminal quit command.
 *
 * This is the piece that makes a terminal command possible at all: while the
 * client runs, it listens on a local endpoint, publishes how to reach it, and
 * answers a quit request by running exactly the code path the `/quit-dsh` slash
 * command runs. Nothing here quits anything itself — the desktop shell's own
 * confirmation dialog and shutdown sequence stay in charge.
 *
 * Four duties, and each one is deliberately forgiving.
 *
 * Serve. The listener exists only while the feature is on. Switching it off
 * closes the listener, so "off" means nothing is listening, not that a request
 * would be refused.
 *
 * Publish. Every sync rewrites the instance record and the settings the terminal
 * command reads. A failure to write is reported in the configuration page, never
 * thrown: a plugin that cannot announce itself must still leave the slash command
 * working.
 *
 * Install. The launcher on PATH belongs to the user's shell, not to this
 * process. Once the installer has put one there, this plugin keeps it true: a
 * renamed command moves the file, a path that has gone missing is restored, a
 * file written by an older version of this plugin is brought up to date, and a
 * file it did not write is never touched.
 *
 * Report. All of it is summarised into one status value the configuration page
 * renders, so the user can see "installed", "not installed yet", or the reason a
 * name was refused without opening a log file.
 *
 * @module dsh-command-quit/terminal-quit
 */
import fs from 'node:fs'
import path from 'node:path'
import { createQuitServer, createToken } from './quit-channel.js'
import {
  installShim,
  isOnPath,
  launcherIsCurrent,
  removeOtherShims,
  resolveNodeCommand,
  scanConflicts,
  shimFiles,
  validateTerminalName
} from './terminal-install.js'
import { publishInstance, readSettings, removeInstance, writeSettings } from './terminal-state.js'

/** Status kinds the configuration page renders. */
export const TERMINAL_STATE = Object.freeze({
  installed: 'installed',
  missing: 'missing',
  disabled: 'disabled',
  conflict: 'conflict',
  error: 'error'
})

/**
 * The Node.js the installed launcher should use.
 *
 * The Host is itself running on one, so no search would be needed for the
 * fallback — but a real Node.js on PATH or the one bundled with DSH is a console
 * program that a shell waits for, which keeps the terminal command's output in
 * order. See {@link resolveNodeCommand}.
 *
 * @returns `{ nodePath, electron }`.
 */
export function currentNodeCommand() {
  return resolveNodeCommand()
}

/**
 * Summarise the launcher's state for the configuration page.
 * @param options - the pieces of the answer.
 * @returns the JSON-shaped status object.
 */
function status(options) {
  return {
    kind: 'terminal',
    state: options.state,
    dir: options.dir,
    file: options.file,
    onPath: options.onPath,
    detail: options.detail
  }
}

/**
 * Create the life cycle.
 *
 * @param options.readConfig - returns the resolved `{ enabled, confirm, name }`.
 * @param options.requestQuit - async; asks the owning shell to quit, returning
 *   `undefined` on success or a failure description.
 * @param options.pluginDir - absolute path of the installed plugin.
 * @param options.publish - receives the status object for the configuration page.
 * @param options.logger - a `{ warn, error }` sink.
 * @param options.version - the plugin version recorded in the published state.
 * @returns `{ sync, dispose }`.
 */
export function createTerminalQuit(options) {
  const { readConfig, requestQuit, pluginDir, publish, logger } = options
  const version = options.version ?? '0.0.0'
  let server
  let endpoint
  let token
  // One sync at a time: the volatile update and the start-up call can both run,
  // and a rename half-done when the next one starts would delete the new file.
  let queue = Promise.resolve()
  let disposed = false

  /** Record the current configuration where the terminal command can read it. */
  const publishSettings = (config) => {
    writeSettings({
      terminalEnabled: config.enabled,
      terminalConfirm: config.confirm,
      terminalName: config.name,
      pluginVersion: version,
      updatedAt: new Date().toISOString()
    })
  }

  /**
   * Bring the installed launcher in line with the configured name.
   *
   * Nothing is installed unless the installer already recorded an installation.
   * Writing into DSH's own command directory is a decision the user makes by
   * running the installer, and a plugin that quietly re-created the file after
   * the user deleted it would be exactly the kind of surprise this feature must
   * not spring.
   *
   * @param config - the resolved configuration.
   * @returns the status object for the configuration page.
   */
  const reconcileLauncher = (config) => {
    const settings = readSettings()
    const installed = settings.installed
    if (installed === undefined || typeof installed.dir !== 'string') {
      return status({
        state: TERMINAL_STATE.missing,
        detail: '尚未安装。双击插件文件夹里的 install-dsh-quit.cmd 即可安装。'
      })
    }
    const dir = installed.dir
    if (!fs.existsSync(dir)) {
      return status({ state: TERMINAL_STATE.missing, dir, detail: '安装目录已不存在，请重新双击 install-dsh-quit.cmd。' })
    }
    const verdict = validateTerminalName(config.name)
    if (!verdict.ok) {
      return status({ state: TERMINAL_STATE.error, dir, detail: verdict.message })
    }
    // `scanConflicts` reports only files this feature did not write, so anything
    // it finds here is someone else's command wearing the configured name. The
    // scan covers the whole PATH, exactly like the check a save runs, so a name
    // that reached the configuration without being checked — saved while the
    // feature was off, or edited into the profile by hand — is refused here too
    // rather than installed on top of another command.
    const conflicts = scanConflicts(verdict.name)
    if (conflicts.length > 0) {
      return status({
        state: TERMINAL_STATE.conflict,
        dir,
        file: conflicts[0].file,
        onPath: isOnPath(dir),
        detail: `名字“${verdict.name}”已被占用：${conflicts.map((entry) => path.join(entry.dir, entry.file)).join('、')}。请在下面换一个名字。`
      })
    }
    const wanted = shimFiles(verdict.name)
    const node = currentNodeCommand()
    const recorded = installed.nodePath === node.nodePath && installed.electron === node.electron
    // `launcherIsCurrent` covers the file names *and* the generation that wrote
    // them: a launcher left by an older version of this plugin looks complete
    // while missing whatever that version did not know to record, so the
    // generation, not the file list, is what decides.
    if (!launcherIsCurrent(dir, verdict.name) || !recorded || installed.name !== verdict.name) {
      try {
        removeOtherShims({ dir, keep: wanted })
        installShim({ dir, name: verdict.name, pluginDir, nodePath: node.nodePath, electron: node.electron })
        writeSettings({ installed: { ...installed, dir, name: verdict.name, nodePath: node.nodePath, electron: node.electron, updatedAt: new Date().toISOString() } })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        logger?.error?.(`command-quit: 终端命令安装文件更新失败：${detail}`)
        return status({ state: TERMINAL_STATE.error, dir, onPath: isOnPath(dir), detail })
      }
    }
    return status({ state: TERMINAL_STATE.installed, dir, file: `${verdict.name}.cmd`, onPath: isOnPath(dir) })
  }

  /** Start listening, if it is not already listening. */
  const startServer = async () => {
    if (server !== undefined) return
    token = createToken()
    const started = await createQuitServer({
      token,
      onQuit: () => requestQuit(),
      logger
    })
    server = started
    endpoint = started.endpoint
  }

  /** Stop listening, and forget how to be reached. */
  const stopServer = () => {
    if (server === undefined) return
    const closing = server
    server = undefined
    endpoint = undefined
    token = undefined
    closing.close()
  }

  /**
   * Publish this process's instance record.
   *
   * The record is written even while the feature is off, because "the client is
   * running with the feature switched off" and "no client is running" are
   * different things to the person reading the terminal's answer, and only the
   * record can tell them apart.
   */
  const publishPresence = (config) => {
    publishInstance({
      enabled: config.enabled,
      confirm: config.confirm,
      name: config.name,
      endpoint: endpoint ?? null,
      token: token ?? null,
      profileDir: process.env.DSH_PROFILE_DIR ?? null,
      version,
      startedAt: new Date().toISOString()
    })
  }

  /** Apply one configuration to everything this feature owns. */
  const applyConfig = async () => {
    if (disposed) return
    const config = readConfig()
    publishSettings(config)
    if (!config.enabled) {
      stopServer()
      publishPresence(config)
      publish(status({ state: TERMINAL_STATE.disabled, detail: '终端退出功能已关闭；已经安装的命令会提示这一点。' }))
      return
    }
    try {
      await startServer()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      logger?.error?.(`command-quit: 无法启动终端退出通道：${detail}`)
      publishPresence(config)
      publish(status({ state: TERMINAL_STATE.error, detail: `无法启动终端退出通道：${detail}` }))
      return
    }
    publishPresence(config)
    publish(reconcileLauncher(config))
  }

  return {
    /**
     * Apply the current configuration.
     * @returns settlement after this sync, and every sync queued before it.
     */
    sync() {
      queue = queue.then(applyConfig).catch((error) => {
        logger?.error?.(`command-quit: 终端退出功能同步失败：${error instanceof Error ? error.message : String(error)}`)
      })
      return queue
    },
    /** Stop listening and remove this process's record. */
    dispose() {
      disposed = true
      stopServer()
      removeInstance()
    }
  }
}
