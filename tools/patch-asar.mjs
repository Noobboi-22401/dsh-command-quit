// Applies, checks or reverts the shell patch that makes `/quit-dsh` possible.
//
// The desktop shell accepts only a closed set of events from its Host and kills
// the Host over anything else, so a plugin whose job is "quit the client" has to
// teach the shell one event first. `lib/shell-channel.js` explains the two edits
// and why they are byte-length preserving; this file is only the command line.
//
// Everything it knows lives in `lib/shell-channel.js`, so the plugin and this
// tool can never disagree about what "patched" means.
//
// Usage
//   node tools/patch-asar.mjs            apply (no-op when already applied)
//   node tools/patch-asar.mjs --check    report state; writes nothing
//   node tools/patch-asar.mjs --revert   restore the shipped bytes
//
// Which client: `DSH_APP_ASAR` or `DSH_DESKTOP_RESOURCES` (see tools/dsh-paths.mjs).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PATCHED,
  UNKNOWN,
  UNPATCHED,
  applyPatch,
  archiveState,
  readArchiveEntry,
  revertPatch
} from '../lib/shell-channel.js'
import { resolveAppAsar } from './dsh-paths.mjs'

const HELP = [
  'Usage: node tools/patch-asar.mjs [--check | --revert]',
  '',
  '  (no flag)  apply the patch; does nothing when it is already applied',
  '  --check    print the state of the client and exit; nothing is written',
  '  --revert   restore the shipped bytes; does nothing when unpatched',
  '',
  "Set DSH_APP_ASAR to the installation's resources\\app.asar to choose which",
  'client is patched. Without it the conventional install locations are tried.',
  '',
  'A client update replaces app.asar and removes the patch; run this again after',
  'a desktop update.'
].join('\n')

const MODE_APPLY = 'apply'
const MODE_REVERT = 'revert'
const MODE_CHECK = 'check'

/**
 * Report one archive without changing it.
 * @param asarPath - archive to inspect.
 * @returns the archive state.
 */
function describe(asarPath) {
  const entry = readArchiveEntry(asarPath, 'lib/main.js')
  const state = archiveState(entry.content.toString('utf8'))
  console.log(`archive     : ${asarPath}`)
  console.log(`lib/main.js : ${String(entry.size)} bytes at ${String(entry.absoluteOffset)}`)
  console.log(`state       : ${state}`)
  return state
}

/** Command-line entry; returns the process exit code. */
export function main(argv = process.argv.slice(2)) {
  const flags = new Set(argv)
  if (flags.has('--help') || flags.has('-h')) {
    console.log(HELP)
    return 0
  }
  const mode = flags.has('--check') ? MODE_CHECK : flags.has('--revert') ? MODE_REVERT : MODE_APPLY

  const asarPath = resolveAppAsar()
  const state = describe(asarPath)

  if (mode === MODE_CHECK) {
    if (state === PATCHED) console.log('\nThe client accepts a quit request from its Host.')
    else if (state === UNPATCHED) console.log('\nThe client does not accept a quit request from its Host yet.')
    else console.log('\nThe client matches neither the shipped nor the patched text; it is a different build.')
    return 0
  }

  if (mode === MODE_APPLY) {
    if (state === UNKNOWN) {
      console.error(
        '\nThis client matches neither the shipped nor the patched text, so nothing was changed.\n' +
          'That is what an updated client looks like: a new app.asar ships with it, and newer builds\n' +
          'need an updated patch. Nothing is broken — the plugin simply reports that it cannot quit yet.'
      )
      return 2
    }
    const result = applyPatch(asarPath)
    if (!result.changed) {
      console.log('\nAlready patched; nothing to do.')
      return 0
    }
    console.log('\nPatched. Restart DeepSeek Harness so the new shell code is loaded.')
    return 0
  }

  if (state === UNKNOWN) {
    console.error('\nThis client is not in the patched state this tool can reverse; nothing was changed.')
    return 2
  }
  const result = revertPatch(asarPath)
  if (!result.changed) {
    console.log('\nNot patched; nothing to revert.')
    return 0
  }
  console.log('\nReverted. Restart DeepSeek Harness so the shipped shell code is loaded.')
  return 0
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
