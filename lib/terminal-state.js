/**
 * On-disk state shared by the two halves of the terminal-quit feature.
 *
 * The terminal command is a separate process: it cannot see the Host's memory,
 * so everything it has to know — which clients are running, how to reach each
 * one, and with which password — lives in a per-user directory:
 *
 *   <home>/.dsh-command-quit/
 *     settings.json          the last configuration the Host published
 *     instances/<pid>.json   one record per running client, while it runs
 *
 * Two rules shape this module.
 *
 * The directory is per-user and private. The password in an instance record is
 * the only thing standing between a local program and a forced quit, so the
 * directory is created with owner-only permissions where the platform has them,
 * and every write is a rename onto the final name so a reader can never see a
 * half-written file.
 *
 * A record may outlive its writer. The Host can be killed rather than asked to
 * stop, in which case nobody removes its record — so a record is a *claim*, not
 * a fact, and {@link readInstances} verifies the claimed process is still alive
 * before reporting it, and clears the one that is not.
 *
 * @module dsh-command-quit/terminal-state
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Shape version of an instance record; a record with another value is ignored. */
export const INSTANCE_VERSION = 1

/** Shape version of the published settings file. */
export const SETTINGS_VERSION = 1

/**
 * Command name the terminal feature uses when the configuration carries none.
 *
 * It matches the composer command's own default on purpose: one word to remember
 * for both ways of quitting, `/quit-dsh` and `quit-dsh`.
 */
export const DEFAULT_TERMINAL_NAME = 'quit-dsh'

/**
 * The environment variable an installed launcher sets to the name it was
 * installed under.
 *
 * Nothing else knows that name. The command is one file shared by every name,
 * and the published settings say what the configuration holds *now*, not which
 * file the user actually ran — so a message that reads the default would name a
 * command the user does not have. The launcher is written per name, so it is the
 * one place that can hand the real one down.
 *
 * The value is only ever a display name; {@link TERMINAL_NAME_PATTERN} is
 * applied to it before use, exactly as to a configured one.
 */
export const COMMAND_NAME_ENV = 'DSH_QUIT_COMMAND_NAME'

/**
 * Ready-made terminal command names offered in the configuration page.
 *
 * The default comes first, so the row of chips starts with the name a fresh
 * installation is already using.
 */
export const PRESET_TERMINAL_NAMES = Object.freeze(['quit-dsh', 'dsh-quit', 'dshq', 'dsq'])

/** The same name rule DSH applies to slash commands: one rule, one explanation. */
export const TERMINAL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

/**
 * Windows device names that are resolved by the OS before any file is opened.
 *
 * A file called `con.cmd` cannot be created, and a command called `con` is
 * claimed by the console: both have to be refused before the installer touches
 * the disk, not reported as a mysterious write failure.
 */
export const RESERVED_NAMES = Object.freeze([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
])

/**
 * The directory this feature keeps its state in.
 *
 * `DSH_COMMAND_QUIT_STATE` overrides it, which is what lets the test suite run
 * against a scratch directory instead of the user's real one.
 *
 * @returns an absolute directory path (not necessarily existing yet).
 */
export function stateDir() {
  const override = process.env.DSH_COMMAND_QUIT_STATE
  if (typeof override === 'string' && override.length > 0) return path.resolve(override)
  return path.join(os.homedir(), '.dsh-command-quit')
}

/**
 * The directory holding one record per running client.
 * @returns an absolute directory path.
 */
export function instanceDir() {
  return path.join(stateDir(), 'instances')
}

/**
 * The file holding the configuration the Host last published.
 * @returns an absolute file path.
 */
export function settingsPath() {
  return path.join(stateDir(), 'settings.json')
}

/**
 * Restrict a directory to its owner where the platform supports it.
 *
 * Windows has no equivalent mode bit; there the user profile's own ACL is the
 * protection, so this is a no-op rather than a failure.
 *
 * @param dir - the directory to restrict.
 */
function restrict(dir) {
  if (process.platform === 'win32') return
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    // A filesystem without POSIX modes is not a reason to refuse to run.
  }
}

/**
 * Create a directory (and its parents) with owner-only permissions.
 * @param dir - the directory to create.
 */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  restrict(dir)
}

/**
 * Read one JSON file, treating every failure as "absent".
 *
 * A truncated or unreadable record is not worth an error message: it is either
 * being written right now or it was left behind by a crash, and in both cases
 * the caller's next step is the same as for a missing file.
 *
 * @param file - the file to read.
 * @returns the parsed value, or `undefined`.
 */
export function readJson(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Write one JSON file atomically.
 *
 * The temporary name is unique per process and per call, so two writers racing
 * — the Host publishing a record while the installer rewrites the settings —
 * cannot interleave inside one file. The rename that publishes it is the only
 * moment the new content becomes visible.
 *
 * @param file - the destination path.
 * @param value - the JSON-shaped value to store.
 * @returns `true` when the file was published.
 */
export function writeJson(file, value) {
  const dir = path.dirname(file)
  try {
    ensureDir(dir)
  } catch {
    return false
  }
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temp, file)
    return true
  } catch {
    try {
      fs.rmSync(temp, { force: true })
    } catch {
      // The leftover temporary file is harmless and gets a new name next time.
    }
    return false
  }
}

/**
 * Read the configuration the Host last published.
 * @returns the stored object, or `{}` when there is none.
 */
export function readSettings() {
  return readJson(settingsPath()) ?? {}
}

/**
 * Merge one patch into the published configuration.
 * @param patch - the fields to replace.
 * @returns the merged object that was written.
 */
export function writeSettings(patch) {
  const merged = { ...readSettings(), ...patch, version: SETTINGS_VERSION }
  writeJson(settingsPath(), merged)
  return merged
}

/**
 * Whether a process id is still in use by something.
 *
 * `EPERM` means a process exists that this one may not signal, which is still a
 * live process; only `ESRCH` — and a malformed id — prove it is gone.
 *
 * @param pid - the process id to test.
 * @returns `true` when a process with that id exists.
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * Every instance record in the state directory, without verifying it.
 * @returns an array of parsed records that carry a numeric `pid`.
 */
function rawInstances() {
  let names
  try {
    names = fs.readdirSync(instanceDir())
  } catch {
    return []
  }
  const records = []
  for (const file of names) {
    if (!file.endsWith('.json')) continue
    const record = readJson(path.join(instanceDir(), file))
    if (record === undefined) continue
    if (record.version !== INSTANCE_VERSION) continue
    if (!Number.isInteger(record.pid)) continue
    records.push(record)
  }
  return records
}

/**
 * Every instance record whose process is still alive.
 *
 * A record whose process is gone is removed here rather than left for a later
 * cleanup pass: this is the only moment the feature knows for certain that the
 * record is stale, and a stale record makes the terminal command report a
 * client that is not there.
 *
 * @returns an array of live instance records.
 */
export function readInstances() {
  const live = []
  for (const record of rawInstances()) {
    if (isProcessAlive(record.pid)) {
      live.push(record)
      continue
    }
    try {
      fs.rmSync(path.join(instanceDir(), `${record.pid}.json`), { force: true })
    } catch {
      // A record that cannot be removed is simply reported as dead again next time.
    }
  }
  live.sort((a, b) => a.pid - b.pid)
  return live
}

/**
 * Publish this process's instance record.
 * @param record - the record fields, without the version and process id.
 * @returns the record that was written.
 */
export function publishInstance(record) {
  const full = { ...record, version: INSTANCE_VERSION, pid: process.pid }
  writeJson(path.join(instanceDir(), `${process.pid}.json`), full)
  return full
}

/**
 * Remove this process's instance record, or another process's by id.
 * @param pid - the process id whose record should go; defaults to this process.
 */
export function removeInstance(pid = process.pid) {
  try {
    fs.rmSync(path.join(instanceDir(), `${pid}.json`), { force: true })
  } catch {
    // Nothing to do: a record that cannot be removed ages out through liveness.
  }
}
