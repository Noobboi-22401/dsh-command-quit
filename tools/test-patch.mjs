// Unit test of the shell patch (`lib/shell-channel.js`), on a synthetic archive.
//
// The patch rewrites two statements inside a 500 KB bundle that ships with the
// desktop client, so the properties that make it safe are worth pinning down
// without touching the real installation:
//
//   * the archive's byte length never changes — that is what keeps the header,
//     every file offset and the embedded integrity hash valid, and it is why
//     `--revert` can restore the shipped bytes with no backup;
//   * a patched archive reads back as patched, and an unpatched one as unpatched;
//   * a build whose text this tool does not recognise is refused, not mangled;
//   * both directions are idempotent.
//
// The fixture is a real asar layout built from scratch, so the reader is tested
// as well: pickle prologue, JSON header, 4-byte alignment, offsets relative to
// the content area, not to the file.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PATCHED,
  UNKNOWN,
  UNPATCHED,
  applyPatch,
  archiveState,
  makeReplacements,
  quitChannelState,
  readArchiveEntry,
  revertPatch
} from '../lib/shell-channel.js'

let failures = 0
function check(label, condition, detail) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label + (detail === undefined ? '' : '  -> ' + detail))
  if (!condition) failures++
}

/** The text this tool is written against, reduced to the two anchors. */
const SHIPPED = [
  'function isDesktopHostEvent(message) {',
  '\tswitch (candidate.type) {',
  '\t\tcase "shutdown-complete": return true;',
  '\t\tcase "ready": return typeof candidate.url === "string";',
  '\t\tdefault: return false;',
  '\t}',
  '}',
  'child.on("message", (message) => {',
  '\t\t\tif (message.type === "ready") this.readyResolve({});',
  '\t\t\telse if (message.type === "shutdown-complete") if (this.stopping) this.shutdownCompleted = true;',
  '\t\t\telse this.fail(/* @__PURE__ */ new Error("dsh desktop host acknowledged an unrequested shutdown"));',
  '\t\t\telse if (message.type === "fatal") this.fail(new DesktopHostFatalError(message.message));',
  '});',
  ''
].join('\n')

/**
 * Write a one-file asar archive.
 *
 * The prologue carries only what a reader needs: the size pickle marker and the
 * JSON byte length. The header's `offset` is relative to the content area, and
 * the content area starts after the header padded to a 4-byte boundary.
 *
 * @param filePath - where to write the archive.
 * @param content - bytes of `lib/main.js`.
 * @returns the byte length written.
 */
function writeArchive(filePath, content) {
  const json = Buffer.from(JSON.stringify({ files: { lib: { files: { 'main.js': { size: content.length, offset: '0' } } } } }), 'utf8')
  const dataStart = 16 + Math.ceil(json.length / 4) * 4
  const buffer = Buffer.alloc(dataStart + content.length)
  buffer.writeUInt32LE(4, 0)
  buffer.writeUInt32LE(4 + 4 + json.length, 4)
  buffer.writeUInt32LE(4 + json.length, 8)
  buffer.writeUInt32LE(json.length, 12)
  json.copy(buffer, 16)
  content.copy(buffer, dataStart)
  fs.writeFileSync(filePath, buffer)
  return buffer.length
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-patch-'))
const archive = path.join(dir, 'app.asar')
const shippedBytes = Buffer.from(SHIPPED, 'utf8')
const shippedSize = writeArchive(archive, shippedBytes)

// --- the edit pair itself ---------------------------------------------------
const replacements = makeReplacements()
check('the patch is two edits', replacements.length === 2, String(replacements.length))
const total = replacements.reduce((sum, edit) => sum + edit.replace.length - edit.find.length, 0)
check('the two edits cancel out to zero bytes', total === 0, String(total))
check(
  'the padding between markers is a comment',
  /\/\*[ ]*\*\/$/.test(replacements[1].replace),
  JSON.stringify(replacements[1].replace.slice(-24))
)
check(
  'the handler closes the shutdown branch and opens the quit branch',
  replacements[1].replace.includes('this.shutdownCompleted = true; }') &&
    replacements[1].replace.includes('else if (message.type === "quit-request") app.quit();'),
  JSON.stringify(replacements[1].replace.split('\n')[1].slice(0, 48))
)
check('both edits target a different anchor', replacements[0].find !== replacements[1].find, 'distinct')

// --- reading the fixture ----------------------------------------------------
const entry = readArchiveEntry(archive, 'lib/main.js')
check('the reader finds lib/main.js', entry.content.length === shippedBytes.length, `${String(entry.content.length)}/${String(shippedBytes.length)}`)
check('the reader resolves the data area', entry.content.equals(shippedBytes), 'bytes equal')
check('the reader reports the absolute offset', entry.absoluteOffset === shippedSize - shippedBytes.length, String(entry.absoluteOffset))

// --- classifying ------------------------------------------------------------
check('a shipped client reads as unpatched', archiveState(SHIPPED) === UNPATCHED, archiveState(SHIPPED))
check('a file with no anchors is unknown', archiveState('nothing to see here') === UNKNOWN, archiveState('nothing to see here'))

// --- applying ---------------------------------------------------------------
const applied = applyPatch(archive)
check('applying reports a change', applied.changed === true && applied.state === PATCHED, JSON.stringify(applied))
const afterApply = fs.readFileSync(archive)
check('the archive size is unchanged', afterApply.length === shippedSize, `${String(afterApply.length)}/${String(shippedSize)}`)
const patchedText = readArchiveEntry(archive, 'lib/main.js').content.toString('utf8')
check('the whitelist accepts the event', patchedText.includes('case "shutdown-complete": case "quit-request": return true;'), 'whitelist')
check('the handler runs the shell quit', patchedText.includes('else if (message.type === "quit-request") app.quit();'), 'handler')
check('the crash branch is gone', patchedText.includes('acknowledged an unrequested shutdown') === false, 'removed')
check('the patched archive reads as patched', archiveState(patchedText) === PATCHED, archiveState(patchedText))
const patchedEntry = readArchiveEntry(archive, 'lib/main.js')
check('the file offset is unchanged', patchedEntry.absoluteOffset === entry.absoluteOffset, String(patchedEntry.absoluteOffset))
check('the file size is unchanged', patchedEntry.size === entry.size, String(patchedEntry.size))

const appliedAgain = applyPatch(archive)
check('applying twice is a no-op', appliedAgain.changed === false && appliedAgain.state === PATCHED, JSON.stringify(appliedAgain))

// --- rejecting a build it does not know --------------------------------------
const foreign = path.join(dir, 'foreign.asar')
const foreignBytes = Buffer.from('a client build from another era\n', 'utf8')
writeArchive(foreign, foreignBytes)
let refused = false
try {
  applyPatch(foreign)
} catch {
  refused = true
}
check('an unrecognised build is refused', refused === true, 'threw')
check(
  'the refused archive is untouched',
  readArchiveEntry(foreign, 'lib/main.js').content.equals(foreignBytes),
  'unchanged'
)

// --- reverting --------------------------------------------------------------
const reverted = revertPatch(archive)
check('reverting reports a change', reverted.changed === true && reverted.state === UNPATCHED, JSON.stringify(reverted))
const afterRevert = fs.readFileSync(archive)
check('reverting restores the exact shipped bytes', afterRevert.length === shippedSize, `${String(afterRevert.length)}/${String(shippedSize)}`)
check(
  'reverting restores the exact shipped text',
  readArchiveEntry(archive, 'lib/main.js').content.equals(shippedBytes),
  'bytes equal'
)
const revertedAgain = revertPatch(archive)
check('reverting twice is a no-op', revertedAgain.changed === false && revertedAgain.state === UNPATCHED, JSON.stringify(revertedAgain))

// --- the plugin's own read-only question ------------------------------------
const patchedChannel = quitChannelState({ env: { DSH_COMMAND_QUIT_CHANNEL: 'patched' } })
check('the override reports a patched client', patchedChannel.state === PATCHED, patchedChannel.state)
const unpatchedChannel = quitChannelState({ env: { DSH_COMMAND_QUIT_CHANNEL: 'unpatched' } })
check('the override reports an unpatched client', unpatchedChannel.state === UNPATCHED, unpatchedChannel.state)
const unknownChannel = quitChannelState({ env: {}, asarPath: path.join(dir, 'missing.asar') })
check('a missing archive is unknown, never unpatched', unknownChannel.state === UNKNOWN, unknownChannel.state)
const liveChannel = quitChannelState({ env: { DSH_APP_ASAR: archive }, asarPath: archive })
check('a real archive is read without an override', liveChannel.state === UNPATCHED, liveChannel.state)

fs.rmSync(dir, { recursive: true, force: true })

console.log('')
console.log(failures === 0 ? 'ALL PATCH CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
