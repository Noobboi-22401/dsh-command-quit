/**
 * The launcher file that puts the terminal quit command on the user's PATH.
 *
 * DSH already solved "find the command directory" for itself: its installer
 * writes `dsh.cmd` into a directory that is on the user's PATH. That directory
 * is where this feature installs, because it is the one place a command is
 * reachable from a terminal without the user editing PATH by hand.
 *
 * Two files are written per name. `<name>.cmd` is what cmd.exe, Windows
 * Terminal and PowerShell find; the extension-less `<name>` is a POSIX shell
 * script for Git Bash and similar shells, which do not consult `PATHEXT`. The
 * two never collide, because `cmd.exe` only looks for extensions it knows.
 *
 * Both files are marked. That marker is what makes every later decision safe:
 * the feature renames and deletes only files it can prove it wrote, and it
 * refuses a name whose file someone else created rather than overwriting it.
 *
 * Both files also record the name they were installed under, because the command
 * they run is shared by every name: that record is how the command's own messages
 * come to say `dshq` after the user renamed it, instead of the default.
 *
 * Collision checking is deliberately paranoid. A command name is resolved
 * against the whole PATH, so a same-named file anywhere on it — not just in the
 * install directory — would decide what the user's typed command runs. The scan
 * therefore walks every PATH entry, for every extension the shell can execute,
 * and refuses the name when anything it did not write turns up.
 *
 * @module dsh-command-quit/terminal-install
 */
import fs from 'node:fs'
import path from 'node:path'
import { COMMAND_NAME_ENV, RESERVED_NAMES, TERMINAL_NAME_PATTERN } from './terminal-state.js'

/** Marker that identifies a file this feature wrote and may therefore replace. */
export const SHIM_MARK = 'dsh-command-quit:terminal-shim'

/**
 * Marker generation; a file carrying an older generation is still ours, but it
 * is not current and gets rewritten.
 *
 * Generation 2 added the command name to the recorded environment. The check
 * that decides whether to rewrite cannot look at the file names alone — a rename
 * changes them, but this did not — so the generation in the marker is what says
 * "this file is what the running version writes".
 */
export const SHIM_VERSION = 2

/** Extensions a Windows shell resolves a bare command name against, in order. */
export const SHELL_EXTENSIONS = Object.freeze(['.com', '.exe', '.bat', '.cmd', '.ps1', '.vbs'])

/** The environment override that names the install directory outright. */
const COMMAND_DIR_ENV = 'DSH_COMMAND_DIR'

/** Directory names DSH has used for its install. */
const APP_DIR_NAMES = Object.freeze(['DeepSeek Harness', 'deepseek-harness', 'DeepSeekHarness'])

/** The command DSH's own installer puts on PATH; finding it finds the directory. */
const DSH_COMMAND_FILE = 'dsh.cmd'

/**
 * The Node.js the installed launcher should run with.
 *
 * Three answers, best first, and the order is about more than speed.
 *
 * A Node.js on PATH is preferred because it is a console program: cmd.exe waits
 * for it, so the terminal command's output lands before the next prompt. The
 * Node.js bundled with DeepSeek Harness is the same kind of program and is
 * always present in an installation, but it is not always in the conventional
 * place — which is why it is derived from the running Host's own location
 * rather than guessed. The last resort is the running executable itself: a real
 * Node.js if this process is one, otherwise the desktop executable, which the
 * launcher runs as Node.js through `ELECTRON_RUN_AS_NODE` (the same mechanism
 * DSH's own `dsh.cmd` uses). That last one works but is a GUI-subsystem program,
 * so cmd.exe does not wait for it.
 *
 * @returns `{ nodePath, electron }`.
 */
export function resolveNodeCommand() {
  const onPath = findNodeOnPath()
  if (onPath !== undefined) return { nodePath: onPath, electron: false }
  const execPath = process.execPath
  if (process.versions.electron !== undefined) {
    const bundled = path.join(
      path.dirname(execPath),
      'resources',
      'runtime',
      'primary-runtime',
      'dependencies',
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node'
    )
    if (isFile(bundled)) return { nodePath: bundled, electron: false }
    return { nodePath: execPath, electron: true }
  }
  return { nodePath: execPath, electron: false }
}

/**
 * A `node` executable found on the PATH.
 * @returns its absolute path, or `undefined`.
 */
export function findNodeOnPath() {
  const names = process.platform === 'win32' ? ['node.exe', 'node.cmd', 'node.bat'] : ['node']
  for (const dir of pathDirs()) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (isFile(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Every PATH entry, in order, with duplicates and empty entries removed.
 * @returns an array of absolute directory paths.
 */
export function pathDirs() {
  const raw = process.env.PATH ?? process.env.Path ?? ''
  const seen = new Set()
  const dirs = []
  for (const entry of raw.split(path.delimiter)) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length === 0) continue
    const resolved = path.resolve(trimmed)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) continue
    seen.add(key)
    dirs.push(resolved)
  }
  return dirs
}

/**
 * Install directories this feature is willing to write into, best first.
 * @returns an array of absolute directory paths.
 */
export function candidateCommandDirs() {
  const dirs = []
  const configured = process.env[COMMAND_DIR_ENV]
  if (typeof configured === 'string' && configured.length > 0) dirs.push(path.resolve(configured))
  // A PATH entry that already serves `dsh.cmd` is the directory DSH itself chose.
  for (const dir of pathDirs()) dirs.push(dir)
  const asar = process.env.DSH_APP_ASAR
  if (typeof asar === 'string' && asar.length > 0) {
    dirs.push(path.join(path.dirname(asar), 'runtime', 'cli', 'bin'))
  }
  const bases = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)
  for (const base of bases) {
    for (const name of APP_DIR_NAMES) dirs.push(path.join(base, name, 'resources', 'runtime', 'cli', 'bin'))
  }
  const seen = new Set()
  const unique = []
  for (const dir of dirs) {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(dir)
  }
  return unique
}

/**
 * Whether one path entry is on the user's PATH right now.
 * @param dir - the directory to look for.
 * @returns `true` when a shell started now would search it.
 */
export function isOnPath(dir) {
  const key = process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir)
  return pathDirs().some((entry) => {
    const candidate = process.platform === 'win32' ? entry.toLowerCase() : entry
    return candidate === key
  })
}

/** Whether a file exists and is a regular file. */
function isFile(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * Whether a name may be written into a launcher as the command's own name.
 *
 * The same rule the configuration page enforces, applied again at the file: a
 * name that does not pass it is left out rather than quoted into a script, so no
 * value from outside can put a quote, a newline or an escape into a file the
 * user's shell will run.
 *
 * @param name - the candidate.
 * @returns `true` when it is a legal command name.
 */
function isUsableName(name) {
  return typeof name === 'string' && TERMINAL_NAME_PATTERN.test(name)
}

/**
 * The directory to install into: the first candidate that holds `dsh.cmd`.
 * @returns `{ dir, onPath, source }`, or `undefined` when DSH's command directory cannot be found.
 */
export function findCommandDir() {
  const configured = process.env[COMMAND_DIR_ENV]
  if (typeof configured === 'string' && configured.length > 0) {
    const dir = path.resolve(configured)
    return { dir, onPath: isOnPath(dir), source: 'override' }
  }
  for (const dir of candidateCommandDirs()) {
    if (isFile(path.join(dir, DSH_COMMAND_FILE))) return { dir, onPath: isOnPath(dir), source: 'dsh-command' }
  }
  return undefined
}

/**
 * The file names this feature owns for one command name.
 * @param name - the configured terminal command name.
 * @returns the relative file names, Windows shim first.
 */
export function shimFiles(name) {
  return [`${name}.cmd`, name]
}

/**
 * The first kilobyte of a file, as text, or `undefined` when it cannot be read.
 *
 * Only the header is ever needed: the marker sits in the first line, and a file
 * too large to be a shim should never be read into memory to find that out.
 *
 * @param file - the file to inspect.
 * @returns the header text, or `undefined`.
 */
function headOf(file) {
  let handle
  try {
    handle = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(1024)
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return undefined
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle)
      } catch {
        // Nothing useful to do with a close failure here.
      }
    }
  }
}

/**
 * Whether a file carries this feature's marker.
 *
 * @param file - the file to inspect.
 * @returns `true` when this feature wrote it.
 */
export function isOwnShim(file) {
  const head = headOf(file)
  return head !== undefined && head.includes(SHIM_MARK)
}

/**
 * The marker generation that wrote a file.
 *
 * @param file - the file to inspect.
 * @returns the generation number, or `undefined` when the file is not a shim of
 *   a generation this feature can read.
 */
export function readShimVersion(file) {
  const head = headOf(file)
  if (head === undefined) return undefined
  const at = head.indexOf(SHIM_MARK)
  if (at < 0) return undefined
  const match = /^\s*v(\d+)/.exec(head.slice(at + SHIM_MARK.length))
  return match === null ? undefined : Number(match[1])
}

/**
 * Whether the launcher files for one name are the ones this version writes.
 *
 * Both files, both current: a launcher installed by an older version of this
 * plugin is ours and may be replaced, but it is not yet able to report the name
 * it was installed under, so it has to be rewritten rather than left alone.
 *
 * @param dir - the directory the launcher lives in.
 * @param name - the command name.
 * @returns `true` when nothing needs writing.
 */
export function launcherIsCurrent(dir, name) {
  const wanted = shimFiles(name)
  const current = listOwnedShims(dir)
  return wanted.every((file) => current.some((owned) => owned.file === file && owned.version === SHIM_VERSION))
}

/**
 * Check a terminal command name without touching the disk.
 * @param value - the raw configured value.
 * @returns `{ ok: true, name }` or `{ ok: false, message }`.
 */
export function validateTerminalName(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, message: '终端命令名不能为空。' }
  }
  if (!TERMINAL_NAME_PATTERN.test(value)) {
    return {
      ok: false,
      message: `终端命令名“${value}”不合法：必须以小写英文字母开头，只能包含小写字母、数字、下划线（_）或连字符（-），不能有大写字母、空格、中文或其他符号。`
    }
  }
  if (RESERVED_NAMES.includes(value)) {
    return { ok: false, message: `终端命令名“${value}”是 Windows 保留的设备名，系统不允许用它命名命令，请换一个。` }
  }
  return { ok: true, name: value }
}

/**
 * Every file on the PATH that would answer to one command name and is not ours.
 *
 * @param name - the candidate command name.
 * @param options.dirs - directories to scan; defaults to every PATH entry plus the install candidates.
 * @returns an array of `{ dir, file }` conflicts, in PATH order.
 */
export function scanConflicts(name, options = {}) {
  const dirs = options.dirs ?? candidateCommandDirs()
  const wanted = shimFiles(name)
  const conflicts = []
  for (const dir of dirs) {
    for (const file of wanted) {
      const target = path.join(dir, file)
      if (!isFile(target)) continue
      if (isOwnShim(target)) continue
      conflicts.push({ dir, file })
    }
    for (const extension of SHELL_EXTENSIONS) {
      const target = path.join(dir, `${name}${extension}`)
      if (!isFile(target)) continue
      if (wanted.includes(`${name}${extension}`)) continue
      if (isOwnShim(target)) continue
      conflicts.push({ dir, file: `${name}${extension}` })
    }
  }
  return conflicts
}

/**
 * Every shim this feature owns in one directory.
 * @param dir - the directory to scan.
 * @returns an array of `{ dir, file, name, version }` for each owned shim.
 */
export function listOwnedShims(dir) {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const owned = []
  for (const file of names) {
    const target = path.join(dir, file)
    if (!isFile(target)) continue
    const version = readShimVersion(target)
    if (version === undefined) continue
    const base = file.toLowerCase().endsWith('.cmd') ? file.slice(0, -4) : file
    owned.push({ dir, file, name: base, version })
  }
  return owned
}

/**
 * Render the Windows shim for one command name.
 *
 * The shim holds no logic: it records where the real launcher lives and hands
 * the whole command line to it. That keeps the discovery of a usable Node.js —
 * the part most likely to need adjusting on an unusual machine — in one file,
 * `bin/dsh-quit.cmd`, instead of frozen into every installation.
 *
 * `chcp` is emitted only when the launcher path needs it. A `.cmd` file is read
 * in the console's OEM code page, so a path with characters outside ASCII would
 * be mangled; on the common all-ASCII path the switch is skipped, because it
 * changes the console's code page for the rest of the session.
 *
 * The name the shim was installed under is recorded next to the Node.js path and
 * handed to the command in the environment ({@link COMMAND_NAME_ENV}), so every
 * message it prints names the user's own command rather than the built-in
 * default. A file rendered without a name simply carries no such line.
 *
 * @param options.pluginDir - absolute path of the installed plugin.
 * @param options.name - the command name this shim was installed under.
 * @param options.nodePath - a Node.js that ran on this machine, or the desktop executable.
 * @param options.electron - whether `nodePath` needs `ELECTRON_RUN_AS_NODE=1`.
 * @returns the file's text.
 */
export function renderCmdShim(options) {
  const { pluginDir, nodePath, electron } = options
  const launcher = path.join(pluginDir, 'bin', 'dsh-quit.cmd')
  const needsCodePage = /[^\x20-\x7e]/.test(launcher)
  return [
    '@echo off',
    `rem ${SHIM_MARK} v${SHIM_VERSION}`,
    'rem Written by the dsh-command-quit plugin for the terminal quit command.',
    'setlocal',
    needsCodePage ? 'chcp 65001 >nul 2>nul' : undefined,
    isUsableName(options.name) ? `set "${COMMAND_NAME_ENV}=${options.name}"` : undefined,
    `set "DSH_QUIT_NODE=${nodePath ?? ''}"`,
    `set "DSH_QUIT_ELECTRON=${electron === true ? '1' : '0'}"`,
    `call "${launcher}" %*`,
    'exit /b %errorlevel%',
    ''
  ]
    .filter((line) => line !== undefined)
    .join('\r\n')
}

/**
 * Render the POSIX shim for one command name.
 *
 * @param options.pluginDir - absolute path of the installed plugin.
 * @param options.name - the command name this shim was installed under.
 * @returns the file's text.
 */
export function renderShShim(options) {
  const launcher = path.join(options.pluginDir, 'bin', 'dsh-quit').split(path.sep).join('/')
  const named = isUsableName(options.name)
  return [
    '#!/bin/sh',
    `# ${SHIM_MARK} v${SHIM_VERSION}`,
    named ? `${COMMAND_NAME_ENV}='${options.name}'` : undefined,
    named ? `export ${COMMAND_NAME_ENV}` : undefined,
    'exec "' + launcher + '" "$@"',
    ''
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}

/**
 * Write one file, creating its directory when needed.
 * @param file - the destination path.
 * @param text - the content.
 */
function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

/**
 * Install the launcher files for one command name.
 *
 * @param options.dir - the directory to install into.
 * @param options.name - the command name.
 * @param options.pluginDir - absolute path of the installed plugin.
 * @param options.nodePath - a Node.js that runs on this machine.
 * @param options.electron - whether `nodePath` is the desktop executable.
 * @returns `{ dir, files }` describing what was written.
 */
export function installShim(options) {
  const { dir, name } = options
  const cmdFile = path.join(dir, `${name}.cmd`)
  const shFile = path.join(dir, name)
  writeFile(cmdFile, renderCmdShim(options))
  writeFile(shFile, renderShShim(options))
  return { dir, name, files: [path.basename(cmdFile), path.basename(shFile)] }
}

/**
 * Delete the launcher files for one command name, and only if they are ours.
 * @param options.dir - the directory the shim lives in.
 * @param options.name - the command name whose files should go.
 * @returns the file names that were removed.
 */
export function removeShim(options) {
  const removed = []
  for (const file of shimFiles(options.name)) {
    const target = path.join(options.dir, file)
    if (!isFile(target)) continue
    if (!isOwnShim(target)) continue
    try {
      fs.rmSync(target, { force: true })
      removed.push(file)
    } catch {
      // A file that cannot be removed is reported by the status line, not here.
    }
  }
  return removed
}

/**
 * Remove every shim this feature owns in one directory except the wanted names.
 *
 * This is how a rename is carried out: the old name's files are ours, so they
 * can be deleted; anything else in the directory is left alone whatever it is.
 *
 * @param options.dir - the directory to sweep.
 * @param options.keep - file names that must survive.
 * @returns the file names that were removed.
 */
export function removeOtherShims(options) {
  const keep = new Set(options.keep ?? [])
  const removed = []
  for (const entry of listOwnedShims(options.dir)) {
    if (keep.has(entry.file)) continue
    try {
      fs.rmSync(path.join(entry.dir, entry.file), { force: true })
      removed.push(entry.file)
    } catch {
      // Left behind for the next sync to try again.
    }
  }
  return removed
}
