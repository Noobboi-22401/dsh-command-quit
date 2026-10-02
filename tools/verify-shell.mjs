// Semantic test of the patched desktop shell.
//
// Extracts `isDesktopHostEvent` from the live app.asar and from the pre-patch
// backup, then compares their answers to a fixed sample of messages: the patch
// accepts `quit-request`, the original rejected it, and every other sampled
// message behaves identically. Also shows that the handler branch and the child
// environment marker are present.
//
// This is a behavioural sample, not a proof about every possible message. The
// byte-level minimality evidence lives in tools/patch-asar.mjs, whose reversal
// proof re-derives the original text from the patched text.
//
// The archive is located through tools/dsh-paths.mjs (DSH_APP_ASAR, or a
// conventional desktop install).
import fs from 'node:fs'
import { resolveAppAsar } from './dsh-paths.mjs'

/** Read exactly `buffer.length` bytes, or fail loudly. */
function readExact(fd, buffer, position, label, archive) {
  const got = fs.readSync(fd, buffer, 0, buffer.length, position)
  if (got !== buffer.length) {
    throw new Error(
      `short read of ${label} in ${archive}: wanted ${buffer.length} bytes at offset ${position}, got ${got}. The file is truncated or not an app.asar.`,
    )
  }
}

/** Validate the archive and return the source text of `lib/main.js`. */
function readMain(archive) {
  const fd = fs.openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    readExact(fd, head, 0, 'asar header prefix', archive)
    const hsize = head.readUInt32LE(12)
    if (hsize <= 0 || hsize > fs.statSync(archive).size) {
      throw new Error(`${archive} is not a valid app.asar: its header length field is ${hsize}.`)
    }
    const hb = Buffer.alloc(hsize)
    readExact(fd, hb, 16, 'asar header', archive)
    let header
    try {
      header = JSON.parse(hb.toString('utf8'))
    } catch {
      throw new Error(`${archive} is not a valid app.asar: its header is not readable JSON.`)
    }
    const entry = header?.files?.lib?.files?.['main.js']
    if (entry === undefined) {
      throw new Error(`cannot find lib/main.js inside ${archive}; the archive layout is not the expected one.`)
    }
    const buf = Buffer.alloc(entry.size)
    readExact(fd, buf, 16 + hsize + Number(entry.offset), 'lib/main.js', archive)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function extractFunction(source, header) {
  const start = source.indexOf(header)
  if (start === -1) throw new Error('function not found: ' + header + '. This DSH build is not supported by this tool.')
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced braces while extracting ' + header)
}

try {
  const ASAR = resolveAppAsar()
  const BACKUP = ASAR + '.quit-patch-backup'

  if (!fs.existsSync(BACKUP)) {
    console.error('no backup at ' + BACKUP + '; nothing to compare against')
    process.exit(1)
  }

  const patchedSrc = readMain(ASAR)
  const originalSrc = readMain(BACKUP)
  const load = (src) => new Function(src + '\nreturn isDesktopHostEvent;')()

  let failures = 0
  const check = (label, actual, expected) => {
    const ok = actual === expected
    console.log((ok ? 'PASS  ' : 'FAIL  ') + label + '  -> ' + JSON.stringify(actual))
    if (!ok) failures++
  }

  const patched = load(extractFunction(patchedSrc, 'function isDesktopHostEvent(message)'))
  const original = load(extractFunction(originalSrc, 'function isDesktopHostEvent(message)'))

  check('original rejects quit-request', original({ type: 'quit-request' }), false)
  check('patched accepts quit-request', patched({ type: 'quit-request' }), true)

  for (const [label, message, expected] of [
    ['ready valid', { type: 'ready', url: 'http://127.0.0.1:1/' }, true],
    ['ready invalid', { type: 'ready' }, false],
    ['shutdown-complete', { type: 'shutdown-complete' }, true],
    ['fatal valid', { type: 'fatal', message: 'x' }, true],
    ['fatal invalid', { type: 'fatal' }, false],
    ['unknown type rejected', { type: 'nope' }, false],
    ['non-object rejected', null, false],
    ['missing type rejected', {}, false],
    ['update-tasks valid', { type: 'update-tasks', requestId: 1, active: true }, true],
    ['quit-inspection valid', { type: 'quit-inspection', requestId: 1, activeTasks: false, scheduledTasks: false }, true],
  ]) {
    check('patched ' + label, patched(message), expected)
    check('original ' + label, original(message), expected)
  }

  const branchAt = patchedSrc.indexOf('else if (message.type === "quit-request") app.quit();')
  const controlAt = patchedSrc.indexOf('this.controlRequests.get(message.requestId)')
  check('quit-request branch present', branchAt !== -1, true)
  check('branch precedes the control fallback', branchAt !== -1 && branchAt < controlAt, true)
  check('child environment advertises the channel', patchedSrc.includes('DSH_DESKTOP_QUIT_REQUEST: "1"'), true)
  check('backup does not advertise it', originalSrc.includes('DSH_DESKTOP_QUIT_REQUEST'), false)

  console.log('')
  console.log(failures === 0 ? 'ALL SHELL CHECKS PASSED' : failures + ' CHECK(S) FAILED')
  process.exit(failures === 0 ? 0 : 1)
} catch (error) {
  console.error('')
  console.error('shell check could not run: ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}
