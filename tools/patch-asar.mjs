// Apply the /quit-dsh desktop-shell patch to app.asar in place.
//
// Adds the Host -> Electron shell `quit-request` control message by rewriting
// one JSDoc comment to absorb the delta, so every byte offset in the archive
// (and the header itself) stays exactly as it was. Idempotent: a second run on
// an already patched archive does nothing, and a half-applied patch is refused
// rather than mistaken for a finished one.
//
//   node tools/patch-asar.mjs          # dry run
//   node tools/patch-asar.mjs --apply  # write
//
// The archive is located through tools/dsh-paths.mjs (DSH_APP_ASAR, or a
// conventional desktop install).
import fs from 'node:fs'
import { resolveAppAsar } from './dsh-paths.mjs'

/** How to recover when an archive is left in a bad state. */
const RESTORE_HINT = 'Restore a clean archive first: node tools/unpatch-asar.mjs --apply'

/**
 * Read exactly `buffer.length` bytes.
 *
 * A short read means the file system returned less than we asked for (truncated
 * file, or an offset past the end), which would otherwise leave zero bytes in
 * the buffer and be silently treated as real content.
 *
 * @param fd - Open file descriptor.
 * @param buffer - Destination buffer; the read fills it completely.
 * @param position - Absolute file offset to read from.
 * @param label - Human-readable name used in the error message.
 */
function readExact(fd, buffer, position, label) {
  const got = fs.readSync(fd, buffer, 0, buffer.length, position)
  if (got !== buffer.length) {
    throw new Error(
      `short read of ${label}: wanted ${buffer.length} bytes at offset ${position}, got ${got}. The archive is truncated or not an app.asar.`,
    )
  }
}

/**
 * Open the archive and read `lib/main.js` out of it.
 *
 * Every failure mode a real user can hit - a 0-byte file, a non-asar file, a
 * client that holds the file open, a missing permission, or a DSH build whose
 * archive layout changed - becomes one actionable message instead of a raw
 * JSON/SyntaxError/EPERM stack trace.
 *
 * @param archive - Absolute path of the `app.asar` to read.
 * @param writable - Open the underlying descriptor for writing.
 * @returns The descriptor, the raw bytes of `lib/main.js` and its location.
 */
function readArchive(archive, writable) {
  // Windows happily opens a directory, and only the first read reveals it.
  if (fs.existsSync(archive) && fs.statSync(archive).isDirectory()) {
    throw new Error(`${archive} is a directory, not an app.asar file. Set DSH_APP_ASAR to the file itself.`)
  }

  let fd
  try {
    fd = fs.openSync(archive, writable ? 'r+' : 'r')
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY') {
      throw new Error(
        `cannot open ${archive} for writing: the file is locked or read-only.\nClose the DeepSeek Harness client (tray icon -> quit) and try again.\nOriginal error: ${error.message}`,
      )
    }
    if (error.code === 'EISDIR') throw new Error(`${archive} is a directory, not an app.asar file. Set DSH_APP_ASAR to the file itself.`)
    if (error.code === 'ENOENT') throw new Error(`no file at ${archive}. Set DSH_APP_ASAR to the app.asar of your installation.`)
    throw error
  }

  try {
    const head = Buffer.alloc(16)
    readExact(fd, head, 0, 'asar header prefix')
    const hsize = head.readUInt32LE(12)
    if (hsize <= 0 || hsize > fs.statSync(archive).size) {
      throw new Error(`${archive} is not a valid app.asar: its header length field is ${hsize}.`)
    }
    const hb = Buffer.alloc(hsize)
    readExact(fd, hb, 16, 'asar header')
    let header
    try {
      header = JSON.parse(hb.toString('utf8'))
    } catch {
      throw new Error(`${archive} is not a valid app.asar: its header is not readable JSON.`)
    }
    const entry = header?.files?.lib?.files?.['main.js']
    if (entry === undefined) {
      throw new Error(`cannot find lib/main.js inside ${archive}. This DSH build has a different archive layout than the one this tool was written for.`)
    }
    const base = 16 + hsize
    const offset = base + Number(entry.offset)
    const original = Buffer.alloc(entry.size)
    readExact(fd, original, offset, 'lib/main.js')
    return { fd, original, offset, text: original.toString('latin1') }
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}

/** Flush to disk; some file systems reject fsync, which is not fatal. */
function syncQuietly(fd) {
  try {
    fs.fsyncSync(fd)
  } catch {
    // Durability is best-effort here: Windows can report EINVAL for a flush.
  }
}

/** Replace one needle exactly once, refusing an ambiguous archive. */
function replaceOnce(haystack, needle, replacement, label) {
  const first = haystack.indexOf(needle)
  if (first === -1) throw new Error('anchor not found: ' + label + '. This DSH build is not supported by this tool.')
  if (haystack.indexOf(needle, first + 1) !== -1) throw new Error('anchor is not unique: ' + label)
  return haystack.slice(0, first) + replacement + haystack.slice(first + needle.length)
}

const ALLOW = '\t\tcase "shutdown-complete": return true;\n'
const INS_ALLOW = ALLOW + '\t\tcase "quit-request": return true;\n'

const HAN = '\t\t\telse {\n\t\t\t\tconst request = this.controlRequests.get(message.requestId);'
const INS_HAN = '\t\t\telse if (message.type === "quit-request") app.quit();\n' + HAN

const ENV = 'env: desktopNodeEnvironment(this.node, void 0, this.environment),'
const INS_ENV = 'env: { ...desktopNodeEnvironment(this.node, void 0, this.environment), DSH_DESKTOP_QUIT_REQUEST: "1" },'

const PAD = '\t/**\n\t* @param node - Absolute Electron executable in Node mode.\n\t* @param runtimeDir - Immutable packages carried by the current application.\n\t* @param projectDir - Desktop plugin profile and child working directory.\n\t* @param inspectPort - Optional loopback inspector port for workspace development.\n\t* @param environment - Environment inherited by the Host and its plugin subprocesses.\n\t* @param onFailure - Receives the first unexpected child failure, including after readiness.\n\t* @param primaryRuntime - Optional bundled dependency payload; when supplied, missing sibling\n\t*   `office-skills` resources fail Host startup.\n\t* @param packageManager - Bundled pnpm entry and Node launcher directory, scoped to package operations.\n\t* @param onPlatformSession - Private credential updates for embedded Platform views.\n\t*/'
const PAD_HEAD = '\t/**\n\t* One Web backend running under the Electron executable in Node mode.\n\t* '
const PAD_TAIL = '\n\t*/'

// The patch is four edits, so "is it applied?" has to look at all four. A
// single marker cannot tell a complete patch from one that a failed or
// interrupted run left half-written.
const PATCH_STATES = [
  ['allowlist', INS_ALLOW],
  ['message handler', INS_HAN],
  ['child environment', INS_ENV],
  ['padding block', PAD_HEAD],
]

/** How many of the four edits are currently present in the archive. */
function appliedCount(source) {
  return PATCH_STATES.filter(([, present]) => source.includes(present)).length
}

/** Compute the patched text and prove the four edits are the only difference. */
function buildPatch(text) {
  let patched = text
  patched = replaceOnce(patched, ALLOW, INS_ALLOW, 'allowlist')
  patched = replaceOnce(patched, HAN, INS_HAN, 'message handler')
  patched = replaceOnce(patched, ENV, INS_ENV, 'child environment')

  const delta = patched.length - text.length
  const padTarget = PAD.length - delta
  const padLength = padTarget - PAD_HEAD.length - PAD_TAIL.length
  if (padLength < 0) throw new Error('not enough comment padding available; this DSH build is not supported by this tool.')
  const padded = PAD_HEAD + ' '.repeat(padLength) + PAD_TAIL
  patched = replaceOnce(patched, PAD, padded, 'padding block rewrite')

  const out = Buffer.from(patched, 'latin1')
  if (out.length !== text.length) throw new Error(`length mismatch: ${out.length} !== ${text.length}`)

  // Minimality proof: undoing exactly the four edits restores the original.
  let reverted = patched
  reverted = replaceOnce(reverted, INS_ALLOW, ALLOW, 'reverse allowlist')
  reverted = replaceOnce(reverted, INS_HAN, HAN, 'reverse handler')
  reverted = replaceOnce(reverted, INS_ENV, ENV, 'reverse environment')
  reverted = replaceOnce(reverted, padded, PAD, 'reverse padding')
  if (reverted !== text) throw new Error('reversal proof failed: the patch touched unexpected bytes')

  return { out, delta }
}

/** Run the tool, turning any failure into one readable message. */
function main() {
  const archive = resolveAppAsar()
  const backup = archive + '.quit-patch-backup'
  const apply = process.argv.includes('--apply')

  const { fd, original, offset, text } = readArchive(archive, apply)
  const finished = (code) => {
    fs.closeSync(fd)
    process.exit(code)
  }

  const before = appliedCount(text)
  if (before === PATCH_STATES.length) {
    console.log('already patched: nothing to do')
    return finished(0)
  }
  if (before !== 0) {
    const missing = PATCH_STATES.filter(([, present]) => !text.includes(present)).map(([label]) => label)
    console.error('refusing to write: the archive is only partly patched.')
    console.error('present edits : ' + before + ' of ' + PATCH_STATES.length)
    console.error('missing edits : ' + missing.join(', '))
    console.error(RESTORE_HINT)
    return finished(1)
  }

  const { out, delta } = buildPatch(text)
  console.log('archive:', archive)
  console.log('original bytes:', text.length, '| delta:', delta, '| patched bytes:', out.length)
  console.log('reversal proof: OK (only the four intended edits differ)')

  if (!apply) {
    console.log('dry run: no archive change. re-run with --apply to write.')
    return finished(0)
  }

  // A backup is only useful if it is a complete, verified copy of the archive
  // BEFORE any patch byte is written. Create one atomically and check it.
  if (!fs.existsSync(backup)) {
    const backupTmp = backup + '.tmp'
    fs.rmSync(backupTmp, { force: true })
    fs.copyFileSync(archive, backupTmp)

    const source = fs.readFileSync(archive)
    const copy = fs.readFileSync(backupTmp)
    if (copy.length !== source.length || !copy.equals(source)) {
      fs.rmSync(backupTmp, { force: true })
      throw new Error('backup verification failed: the copy of ' + archive + ' does not match the original; nothing was written')
    }
    const backupFd = fs.openSync(backupTmp, 'r+')
    syncQuietly(backupFd)
    fs.closeSync(backupFd)
    fs.renameSync(backupTmp, backup)
    console.log('backup written and verified:', backup)
  } else {
    const backupSize = fs.statSync(backup).size
    if (backupSize < offset + original.length) {
      console.error('refusing to write: the existing backup is smaller than the archive it should hold.')
      console.error('backup     :', backup, '(' + backupSize + ' bytes)')
      console.error('needed size:', offset + original.length, 'bytes')
      console.error('Delete the backup and run this tool again to make a fresh one.')
      return finished(1)
    }
    console.log('backup already present (looks complete):', backup)
  }

  const written = fs.writeSync(fd, out, 0, out.length, offset)
  if (written !== out.length) {
    throw new Error(`short write: ${written} of ${out.length} bytes; the archive may be inconsistent. ${RESTORE_HINT}`)
  }
  syncQuietly(fd)

  // Read the bytes back so a torn write cannot be reported as a success.
  const check = Buffer.alloc(out.length)
  readExact(fd, check, offset, 'lib/main.js after writing')
  if (!check.equals(out)) {
    throw new Error(`verification failed: the archive does not contain the patch that was written. ${RESTORE_HINT}`)
  }
  if (appliedCount(check.toString('latin1')) !== PATCH_STATES.length) {
    throw new Error(`verification failed: the archive is not fully patched after writing. ${RESTORE_HINT}`)
  }

  console.log('patch verified: all four edits are present in the archive')
  console.log('patched app.asar in place; restart the desktop client to activate')
  return finished(0)
}

try {
  main()
} catch (error) {
  console.error('')
  console.error('patch failed: ' + (error instanceof Error ? error.message : String(error)))
  console.error('Nothing was changed beyond the steps already reported above.')
  process.exit(1)
}
