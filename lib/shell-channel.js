// The shell's quit channel: what it is, whether this client has it, and how the
// patch in `tools/patch-asar.mjs` creates it.
//
// The desktop client is an Electron shell (this file calls it "the shell") that
// spawns a Host process over Node IPC. Messages travel in both directions, but
// the shell only accepts a closed set of event names from the Host, and a
// message outside that set is treated as a protocol violation: the shell reports
// "dsh desktop host sent an invalid IPC event", kills the Host and shows the
// crash window. A plugin cannot add itself to that set.
//
// `quit-request` is the one event this plugin adds, by patching two spots in the
// shell's own `lib/main.js` inside `resources/app.asar`:
//
//   isDesktopHostEvent()  — accepts `quit-request` from the Host
//   the message handler   — runs `app.quit()`, the shell's own quit entry
//
// Both edits are byte-length preserving, so the archive header, every file
// offset and the archive's embedded integrity hash are untouched: the client
// loads the archive exactly as before, and the patch can be undone by exact
// reverse replacement.
//
// A client update ships a new `app.asar` and takes the patch with it. Sending
// `quit-request` to an unpatched client is what crashes it, so the plugin asks
// {@link quitChannelState} first and refuses to send when the answer is not
// {@link PATCHED}.
//
// @module dsh-command-quit/shell-channel
import fs from 'node:fs'
import { createRequire } from 'node:module'

/**
 * The `fs` to read the archive with.
 *
 * Inside the desktop client this module runs in an Electron Node-mode child,
 * where `node:fs` is **replaced** by a wrapper that routes any path containing
 * `.asar` into the archive. That wrapper reads the archive path itself as "the
 * file with an empty name inside the archive", so opening
 * `...\resources\app.asar` fails with `ENOENT, not found in ...app.asar` while a
 * plain Node process opens the very same file without trouble. Electron exposes
 * the unpatched module as `original-fs` for exactly this case.
 *
 * The failure is not cosmetic: a read that throws makes the channel state
 * unknown, and an unknown state is a refusal, which is what a user would see as
 * "cannot confirm this client supports a quit request".
 *
 * @returns the unpatched `fs` when it exists, otherwise `node:fs`.
 */
function archiveFs() {
  if (archiveFsModule !== undefined) return archiveFsModule
  try {
    archiveFsModule = createRequire(import.meta.url)('original-fs')
  } catch {
    archiveFsModule = fs
  }
  return archiveFsModule
}

/** Memoized result of {@link archiveFs}; `undefined` until first use. */
let archiveFsModule

/** The Host → shell event this plugin needs. */
export const QUIT_EVENT = 'quit-request'

/** This client accepts {@link QUIT_EVENT}. */
export const PATCHED = 'patched'

/** This client is the shipped build: sending {@link QUIT_EVENT} would be a violation. */
export const UNPATCHED = 'unpatched'

/** The archive is missing, unreadable, or a build this tool does not recognise. */
export const UNKNOWN = 'unknown'

/** Escape hatch for diagnostics and tests: `patched`, `unpatched` or `unknown`. */
export const CHANNEL_ENV = 'DSH_COMMAND_QUIT_CHANNEL'

/** Bytes before the JSON header: two pickle sizes and two string lengths. */
const HEADER_PROLOGUE = 16

/** Smallest comment body the padding step accepts; an empty comment is legal. */
const MIN_PADDING = 0

/** The statement the patch installs, used as a marker for "already patched". */
const HANDLER_MARKER = `else if (message.type === "${QUIT_EVENT}") app.quit();`

function align4(value) {
  return Math.ceil(value / 4) * 4
}

/**
 * The `app.asar` of the client that owns this Host.
 *
 * The Host is started as an Electron Node-mode child with its entry path inside
 * the archive, so `process.argv` carries the archive path even though no
 * environment variable does. `DSH_APP_ASAR` is honoured first because a
 * diagnostic run may want to point at a different installation.
 *
 * @param argv - argument vector to inspect; defaults to `process.argv`.
 * @param env - environment to inspect; defaults to `process.env`.
 * @returns the archive path, or `undefined` when nothing looked like one.
 */
export function locateAppAsar({ argv = process.argv, env = process.env } = {}) {
  const configured = env.DSH_APP_ASAR
  if (configured !== undefined && configured !== '') return configured
  for (const value of argv) {
    if (typeof value !== 'string') continue
    const match = /^(.*?\.asar)(?:[\\/]|$)/.exec(value)
    if (match !== null) return match[1]
  }
  const resources = env.DSH_DESKTOP_RESOURCES
  if (resources !== undefined && resources !== '') return `${resources}${process.platform === 'win32' ? '\\' : '/'}app.asar`
  return undefined
}

/**
 * Read the archive's JSON header and the byte range of one file in it.
 *
 * The archive is a pickle-prefixed JSON header followed by the concatenated file
 * contents; an entry's `offset` is relative to the start of that content, not to
 * the start of the archive. Nothing is cached: the caller may have patched the
 * archive since the last look.
 *
 * @param asarPath - absolute path of `app.asar`.
 * @param entryPath - slash-separated path inside the archive.
 * @returns `{ file, size, absoluteOffset, content }`.
 */
export function readArchiveEntry(asarPath, entryPath) {
  const preferred = archiveFs()
  if (preferred === fs) return readEntryWith(fs, asarPath, entryPath)
  try {
    return readEntryWith(preferred, asarPath, entryPath)
  } catch (error) {
    // `original-fs` is what the client needs. A plain Node process has no such
    // module and some future build could drop it, so the ordinary one stays a
    // fallback — but the original failure is what gets reported when both fail.
    try {
      return readEntryWith(fs, asarPath, entryPath)
    } catch {
      throw error
    }
  }
}

/**
 * Read one entry through a caller-chosen `fs` module.
 * @param fsModule - `original-fs` or `node:fs`.
 * @param asarPath - absolute path of the archive.
 * @param entryPath - slash-separated path inside it.
 * @returns `{ file, size, absoluteOffset, content }`.
 */
function readEntryWith(fsModule, asarPath, entryPath) {
  const fd = fsModule.openSync(asarPath, 'r')
  try {
    const prologue = Buffer.alloc(HEADER_PROLOGUE)
    fsModule.readSync(fd, prologue, 0, HEADER_PROLOGUE, 0)
    if (prologue.readUInt32LE(0) !== 4) {
      throw new Error(`${asarPath} is not an asar archive (unexpected header prologue).`)
    }
    const jsonLength = prologue.readUInt32LE(12)
    if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) {
      throw new Error(`${asarPath} has an implausible header length (${String(jsonLength)}).`)
    }
    const json = Buffer.alloc(jsonLength)
    fsModule.readSync(fd, json, 0, jsonLength, HEADER_PROLOGUE)
    let header
    try {
      header = JSON.parse(json.toString('utf8'))
    } catch {
      throw new Error(`${asarPath} has a header that is not valid JSON.`)
    }
    const dataStart = HEADER_PROLOGUE + align4(jsonLength)
    let cursor = header
    for (const segment of entryPath.split('/')) {
      cursor = cursor?.files?.[segment]
      if (cursor === undefined) throw new Error(`${asarPath} has no entry ${entryPath}.`)
    }
    const size = cursor.size
    const offset = Number(cursor.offset)
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || size <= 0) {
      throw new Error(`${asarPath}: ${entryPath} has no usable size/offset.`)
    }
    const content = Buffer.alloc(size)
    fsModule.readSync(fd, content, 0, size, dataStart + offset)
    return { file: entryPath, size, absoluteOffset: dataStart + offset, content }
  } finally {
    fsModule.closeSync(fd)
  }
}

/**
 * The two edits, built so that together they keep the archive's length.
 *
 * The whitelist edit is longer than the text it replaces, so the handler edit —
 * already shorter than its target — absorbs that growth, and a comment of exact
 * size fills the remainder. A total that is not zero is a bug in this file, never
 * something to fix at write time.
 *
 * @returns `[{ id, find, replace }, …]`.
 */
export function makeReplacements() {
  const whitelist = {
    id: 'whitelist the quit request',
    find: 'case "shutdown-complete": return true;',
    replace: `case "shutdown-complete": case "${QUIT_EVENT}": return true;`
  }
  const handler = {
    id: 'route the quit request to the shell quit flow',
    find:
      'else if (message.type === "shutdown-complete") if (this.stopping) this.shutdownCompleted = true;\n' +
      '\t\t\telse this.fail(/* @__PURE__ */ new Error("dsh desktop host acknowledged an unrequested shutdown"));',
    // Braced on purpose: the shipped text relies on how a dangling `else` binds,
    // and making the block explicit keeps the following `else if` chain clear.
    base:
      'else if (message.type === "shutdown-complete") { if (this.stopping) this.shutdownCompleted = true; }\n' +
      `\t\t\t${HANDLER_MARKER}`
  }
  const growth = whitelist.replace.length - whitelist.find.length
  const padding = handler.find.length - handler.base.length - growth - 4
  if (padding < MIN_PADDING) {
    throw new Error(
      `internal: keeping the archive length unchanged needs a ${String(padding)}-character comment. ` +
        'Adjust MIN_PADDING or the anchors.'
    )
  }
  const replacements = [whitelist, { ...handler, replace: `${handler.base}/*${' '.repeat(padding)}*/` }]
  const total = replacements.reduce((sum, edit) => sum + edit.replace.length - edit.find.length, 0)
  if (total !== 0) {
    throw new Error(`internal: the edit pair would change the archive length by ${String(total)} bytes.`)
  }
  return replacements
}

/**
 * Classify a `lib/main.js` extract without writing to it.
 * @param mainJs - the archive's `lib/main.js` as text.
 * @returns {@link PATCHED}, {@link UNPATCHED} or {@link UNKNOWN}.
 */
export function archiveState(mainJs) {
  const replacements = makeReplacements()
  if (replacements.every((edit) => mainJs.includes(edit.replace))) return PATCHED
  if (replacements.every((edit) => mainJs.includes(edit.find)) || mainJs.includes(HANDLER_MARKER)) return UNPATCHED
  return UNKNOWN
}

/** Apply the pair in one direction, asserting that each anchor is unique. */
function transform(source, direction) {
  const replacements = makeReplacements()
  let next = source
  for (const edit of replacements) {
    const from = direction === 'apply' ? edit.find : edit.replace
    const to = direction === 'apply' ? edit.replace : edit.find
    const hits = next.split(from).length - 1
    if (hits !== 1) {
      throw new Error(
        `expected ${edit.id} to appear exactly once in the client's lib/main.js, found ${String(hits)}. ` +
          'This client version is not one this patch knows; nothing was changed.'
      )
    }
    next = next.replace(from, () => to)
  }
  const nextBytes = Buffer.byteLength(next, 'utf8')
  const sourceBytes = Buffer.byteLength(source, 'utf8')
  if (nextBytes !== sourceBytes) {
    throw new Error(`internal: the edit changed the archive length by ${String(nextBytes - sourceBytes)} bytes.`)
  }
  return next
}

/** Rewrite one entry's bytes in place; the content is length-preserving. */
function writeEntry(asarPath, entry, next) {
  const bytes = Buffer.from(next, 'utf8')
  if (bytes.length !== entry.size) {
    throw new Error(
      `refusing to write ${String(bytes.length)} bytes over ${String(entry.size)}: the archive length must not change.`
    )
  }
  const writer = archiveFs()
  const fd = writer.openSync(asarPath, 'r+')
  try {
    writer.writeSync(fd, bytes, 0, bytes.length, entry.absoluteOffset)
    writer.fsyncSync(fd)
  } finally {
    writer.closeSync(fd)
  }
}

/**
 * Report whether this client's shell accepts {@link QUIT_EVENT}.
 *
 * Read-only. Never throws: a missing or unreadable archive is {@link UNKNOWN},
 * which the caller must treat as "do not send" — an unpatched shell does not
 * refuse a stray event politely, it kills the Host and shows a crash window.
 *
 * @param options - optional `{ asarPath, env }` overrides.
 * @returns `{ state, asarPath, detail }`.
 */
export function quitChannelState({ asarPath, env = process.env } = {}) {
  const override = env[CHANNEL_ENV]
  if (override === PATCHED || override === UNPATCHED || override === UNKNOWN) {
    return { state: override, asarPath: undefined, detail: `${CHANNEL_ENV}=${override}` }
  }
  const archive = asarPath ?? locateAppAsar({ env })
  if (archive === undefined) {
    return { state: UNKNOWN, asarPath: undefined, detail: 'no client archive was found for this Host' }
  }
  try {
    const entry = readArchiveEntry(archive, 'lib/main.js')
    const state = archiveState(entry.content.toString('utf8'))
    return { state, asarPath: archive, detail: state === PATCHED ? 'the shell accepts a quit request' : 'state read from lib/main.js' }
  } catch (error) {
    return { state: UNKNOWN, asarPath: archive, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Apply the patch.
 * @param asarPath - archive to modify, in place.
 * @returns `{ changed, state }`; `changed` is false when it was already patched.
 */
export function applyPatch(asarPath) {
  const entry = readArchiveEntry(asarPath, 'lib/main.js')
  const source = entry.content.toString('utf8')
  if (archiveState(source) === PATCHED) return { changed: false, state: PATCHED }
  const next = transform(source, 'apply')
  if (archiveState(next) !== PATCHED) throw new Error('internal: the patched text does not read back as patched.')
  writeEntry(asarPath, entry, next)
  const reread = readArchiveEntry(asarPath, 'lib/main.js').content.toString('utf8')
  if (archiveState(reread) !== PATCHED) {
    throw new Error('the archive on disk did not read back as patched; run the revert mode to restore it.')
  }
  return { changed: true, state: PATCHED }
}

/**
 * Restore the shipped bytes.
 * @param asarPath - archive to modify, in place.
 * @returns `{ changed, state }`; `changed` is false when it was not patched.
 */
export function revertPatch(asarPath) {
  const entry = readArchiveEntry(asarPath, 'lib/main.js')
  const source = entry.content.toString('utf8')
  if (archiveState(source) === UNPATCHED) return { changed: false, state: UNPATCHED }
  const next = transform(source, 'revert')
  if (archiveState(next) !== UNPATCHED) throw new Error('internal: the reverted text does not read back as shipped.')
  writeEntry(asarPath, entry, next)
  const reread = readArchiveEntry(asarPath, 'lib/main.js').content.toString('utf8')
  if (archiveState(reread) !== UNPATCHED) throw new Error('the archive on disk did not read back as shipped.')
  return { changed: true, state: UNPATCHED }
}
