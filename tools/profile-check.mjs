// Confirm the desktop profile composes the dsh-command-quit bundle.
//
// Runs DSH's own profile loader (from inside app.asar), so it validates the
// profile manifest, bundle resolution, the bundle's cordis.patch.yml and plugin
// compatibility. Re-executes itself under the Electron executable in Node mode,
// because a plain Node process cannot import from app.asar.
//
// Paths come from tools/dsh-paths.mjs (DSH_APP_ASAR / DSH_DESKTOP_EXE /
// DSH_PROFILE_DIR, or conventional locations).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { resolveAppAsar, resolveDesktopExecutable, resolveProfileDir } from './dsh-paths.mjs'

try {
  const asar = resolveAppAsar()
  const ELECTRON = resolveDesktopExecutable(asar)
  const runtimeDir = path.join(asar, 'dsh')
  const profileDir = resolveProfileDir()

  // Paths inside app.asar are only real to Electron's patched file system, so
  // hand the work to the Electron executable first and validate afterwards.
  if (process.versions.electron === undefined) {
    const result = spawnSync(ELECTRON, ['--expose-internals', fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    if (result.error !== undefined && result.error !== null) {
      throw new Error(`cannot start the desktop client at ${ELECTRON}: ${result.error.message}`)
    }
    process.exit(result.status ?? 1)
  }

  // A missing layout is the usual cause of a failure here, so say that
  // instead of throwing a bare ENOENT later.
  if (!fs.existsSync(runtimeDir)) {
    throw new Error(
      `cannot find the DSH runtime directory inside the desktop client (${runtimeDir}). ` +
        'Point DSH_APP_ASAR at your installation resources\\app.asar.',
    )
  }

  const installAnchor = path.join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const bootEntry = path.join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
  if (!fs.existsSync(bootEntry)) {
    throw new Error(
      `cannot find ${bootEntry}. This DSH build does not expose the profile loader this check needs; ` +
        'the plugin may still be installed correctly.',
    )
  }

  const appBoot = await import(new URL('file:///' + bootEntry.replace(/\\/g, '/')).href)
  const profile = appBoot.loadProfileDirectory('dsh', profileDir, installAnchor)

  console.log('profile        :', profile.name, '(' + profile.dir + ')')
  console.log('bundles loaded :', profile.layers.map((l) => l.packageName).join(', '))
  console.log(
    'bundles skipped:',
    profile.skippedBundles.length === 0 ? 'none' : JSON.stringify(profile.skippedBundles, null, 2),
  )

  const layer = profile.layers.find((l) => l.packageName === 'dsh-command-quit')
  const composed = JSON.stringify(profile.layers.map((l) => l.patches))
  console.log('')
  console.log('dsh-command-quit layer :', layer !== undefined)
  if (layer !== undefined) {
    console.log('  packageDir :', layer.packageDir)
    console.log('  patchPaths :', JSON.stringify(layer.patchPaths))
    console.log('  patches    :', JSON.stringify(layer.patches))
  }

  const failures = []
  if (layer === undefined) failures.push('bundle not loaded')
  if (profile.skippedBundles.some((b) => b.packageName === 'dsh-command-quit')) failures.push('bundle skipped')
  if (!composed.includes('command-quit')) failures.push('insert entry missing from composed layers')

  console.log('')
  console.log(failures.length === 0 ? 'PROFILE COMPOSITION OK' : 'FAILED: ' + failures.join('; '))
  process.exit(failures.length === 0 ? 0 : 1)
} catch (error) {
  console.error('')
  console.error('profile check could not run: ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}
