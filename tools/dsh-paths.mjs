/**
 * Machine-independent path resolution for the desktop-shell tools.
 *
 * Every path is taken from an environment variable or from a conventional
 * install location, so the published package never carries one developer's
 * absolute paths. Each resolver throws an actionable message instead of
 * guessing.
 *
 * An override that is SET but does not exist is a hard error, never a silent
 * fallback: patching a different installation than the one the user named is
 * the worst outcome this module could produce.
 *
 * Environment overrides
 *   DSH_APP_ASAR           absolute path to the desktop `resources/app.asar`
 *   DSH_DESKTOP_EXE        absolute path to the desktop executable
 *   DSH_DESKTOP_RESOURCES  absolute path to the install's `resources` directory
 *   DSH_PROFILE_DIR        absolute path to the DSH profile directory
 *   DSH_HOME               DSH home directory (default: ~/.dsh)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Install directory names used by current desktop builds. */
const APP_DIR_NAMES = ['DeepSeek Harness', 'deepseek-harness', 'DeepSeekHarness']

const HOW_TO_SET = 'Set DSH_APP_ASAR to your installation path, or DSH_DESKTOP_RESOURCES to its `resources` directory.'

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== '' && fs.existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve a path the caller may have set explicitly.
 *
 * An explicitly configured path is a decision, not a suggestion: if the user
 * points DSH_APP_ASAR at an installation, silently falling back to a different
 * installation and patching THAT one would be the worst possible outcome. So a
 * set-but-missing override is a hard error, and only an unset override falls
 * back to discovery.
 *
 * @param envName - Name of the override environment variable.
 * @param label - Human-readable description used in the error message.
 * @param discover - Discovery function used when the override is unset.
 * @returns The resolved absolute path.
 */
function resolveOverride(envName, label, discover) {
  const configured = process.env[envName]
  if (configured !== undefined && configured !== '') {
    if (!fs.existsSync(configured)) {
      throw new Error(`${envName} is set to ${configured}, but that path does not exist. Correct or clear ${envName} and try again.`)
    }
    return configured
  }
  const found = discover()
  if (found !== undefined) return found
  throw new Error(`cannot locate ${label}. Set ${envName} to its absolute path.`)
}

/** Conventional `resources` directories for a desktop install. */
function resourceDirCandidates() {
  const dirs = []
  if (process.env.DSH_DESKTOP_RESOURCES) dirs.push(process.env.DSH_DESKTOP_RESOURCES)
  const bases = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean)
  for (const base of bases) {
    for (const name of APP_DIR_NAMES) dirs.push(path.join(base, name, 'resources'))
  }
  return dirs
}

/** The discovered `app.asar`, or `undefined` when nothing matched. */
function findAppAsar() {
  return firstExisting(resourceDirCandidates().map((dir) => path.join(dir, 'app.asar')))
}

/**
 * The `app.asar` the caller named through `DSH_APP_ASAR`, if any.
 *
 * Discovery functions need this too: with only `DSH_APP_ASAR` set, the archive
 * itself is found from the override but the executable next to it would not be.
 *
 * @returns A validated path, or `undefined` when the override is unset.
 */
function configuredAppAsar() {
  const configured = process.env.DSH_APP_ASAR
  return configured !== undefined && configured !== '' && fs.existsSync(configured) ? configured : undefined
}

/** Executables that must never be chosen as "the desktop client". */
const NOT_THE_APP = /(uninstall|unins|setup|installer|update|crashpad|squirrel|elevate)/i

/**
 * Candidate executables in an install directory, best guess first.
 *
 * The install directory also contains helpers such as the uninstaller and
 * `elevate.exe`, and `readdirSync` order is not contractual, so picking the
 * first `.exe` could run the uninstaller. Prefer a name that looks like the
 * application and exclude the known helpers.
 *
 * @param installDir - Directory that holds the desktop executable.
 * @returns Absolute paths of plausible client executables.
 */
function executableCandidates(installDir) {
  const names = fs
    .readdirSync(installDir)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .filter((name) => !NOT_THE_APP.test(name))
  const looksLikeApp = (name) => {
    const base = name.toLowerCase().replace(/[\s-]/g, '')
    return (
      APP_DIR_NAMES.some((dirName) => base.startsWith(dirName.toLowerCase().replace(/[\s-]/g, ''))) ||
      /^(deepseek|harness|dsh)/i.test(name)
    )
  }
  const preferred = names.filter(looksLikeApp)
  return [...preferred, ...names.filter((name) => !preferred.includes(name))].map((name) => path.join(installDir, name))
}

/**
 * Absolute path of the desktop `app.asar`.
 * @returns The archive path.
 */
export function resolveAppAsar() {
  return resolveOverride('DSH_APP_ASAR', 'the desktop app.asar', () => {
    const found = findAppAsar()
    if (found === undefined) throw new Error(`cannot locate the desktop app.asar. ${HOW_TO_SET}`)
    return found
  })
}
/**
 * Absolute path of the desktop executable that owns `app.asar`.
 * @param appAsar - Archive whose install directory should be searched; falls
 *   back to ordinary discovery when omitted.
 * @returns The executable path.
 */
export function resolveDesktopExecutable(appAsar) {
  return resolveOverride('DSH_DESKTOP_EXE', 'the desktop executable', () => {
    const asar = appAsar ?? findAppAsar() ?? configuredAppAsar()
    if (asar === undefined) return undefined
    return firstExisting(executableCandidates(path.dirname(path.dirname(asar))))
  })
}

/**
 * Absolute path of the DSH profile directory.
 * @returns The profile directory path.
 */
export function resolveProfileDir() {
  return resolveOverride('DSH_PROFILE_DIR', 'the DSH profile directory', () => {
    const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
    const conventional = path.join(home, 'profiles', 'desktop')
    return fs.existsSync(conventional) ? conventional : undefined
  })
}
