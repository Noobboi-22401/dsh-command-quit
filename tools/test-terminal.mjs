// End-to-end test of the terminal quit command.
//
// The command is a separate process from the client, so this test drives both
// ends in one process: a real relay server, real instance records on disk in a
// scratch state directory, and the command's own `main()` fed a scripted answer
// instead of a keyboard. Nothing here touches the user's real state directory or
// a real client.
//
// The named-pipe transport is not exercised: a confined environment cannot open
// one at all, which is exactly why the server falls back to a loopback port. The
// run forces that fallback so the rest of the behaviour is testable everywhere.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-terminal-'))
process.env.DSH_COMMAND_QUIT_STATE = stateRoot
process.env.DSH_COMMAND_QUIT_TRANSPORT = 'tcp'

const state = await import('../lib/terminal-state.js')
const channel = await import('../lib/quit-channel.js')
const install = await import('../lib/terminal-install.js')
const cli = await import('../lib/quit-cli.js')
const host = await import('../lib/terminal-quit.js')

let failures = 0
function check(label, condition, detail) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label + (detail === undefined ? '' : '  -> ' + detail))
  if (!condition) failures++
}

/** An `io` binding that answers from a script instead of a terminal. */
function scriptedIo(answer, options = {}) {
  const out = []
  const err = []
  return {
    write: (text) => out.push(text),
    writeError: (text) => err.push(text),
    interactive: options.interactive !== false,
    read: async (prompt) => {
      out.push(prompt)
      return answer
    },
    text: () => out.join(''),
    errorText: () => err.join('')
  }
}

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------
check('--yes is recognised', cli.parseArgs(['--yes']).yes === true, '--yes')
check('-y is recognised', cli.parseArgs(['-y']).yes === true, '-y')
check('--list is recognised', cli.parseArgs(['--list']).list === true, '--list')
check('--help is recognised', cli.parseArgs(['--help']).help === true, '--help')
check('an unknown argument is reported', cli.parseArgs(['--wat']).unknown[0] === '--wat', '--wat')
check('no argument means no flags', JSON.stringify(cli.parseArgs([])) === JSON.stringify({ yes: false, list: false, help: false, unknown: [] }), JSON.stringify(cli.parseArgs([])))

for (const yes of ['y', 'Y', 'yes', 'YES', ' yes ', '是', '确定', '确认']) {
  check('reads ' + JSON.stringify(yes) + ' as consent', cli.parseConfirmation(yes) === true, yes)
}
for (const no of ['', ' ', 'n', 'N', 'no', 'nope', 'yep', '退出', '1']) {
  check('reads ' + JSON.stringify(no) + ' as refusal', cli.parseConfirmation(no) === false, no)
}
check('reads a non-string as refusal', cli.parseConfirmation(undefined) === false, 'undefined')

// The strictest running client wins, and the published file is only a fallback.
check('a client asking for confirmation wins over one that does not',
  cli.resolveConfirmation([{ confirm: true }, { confirm: false }], { terminalConfirm: false }) === true, 'true')
check('a client that does not ask wins over a stale published setting',
  cli.resolveConfirmation([{ confirm: false }], { terminalConfirm: true }) === false, 'false')
check('a disabled client does not decide the question',
  cli.resolveConfirmation([{ confirm: false, enabled: false }], { terminalConfirm: true }) === true, 'true')
check('the published setting answers when no client does',
  cli.resolveConfirmation([], { terminalConfirm: false }) === false, 'false')
check('confirmation is required when nothing is known',
  cli.resolveConfirmation([], {}) === true, 'true')

const decide = (patch) => cli.decideQuit({ enabledInstances: 1, totalInstances: 1, settingsEnabled: true, confirm: true, assumeYes: false, interactive: true, ...patch })
check('an enabled client with confirmation asks', decide({}) === 'ask', decide({}))
check('--yes skips the question', decide({ assumeYes: true }) === 'proceed', decide({ assumeYes: true }))
check('confirmation off skips the question', decide({ confirm: false }) === 'proceed', decide({ confirm: false }))
check('a non-interactive run refuses rather than hangs', decide({ interactive: false }) === 'refuse', decide({ interactive: false }))
check('a non-interactive run with --yes proceeds', decide({ interactive: false, assumeYes: true }) === 'proceed', decide({ interactive: false, assumeYes: true }))
check('a running client with the feature off reads as disabled',
  cli.decideQuit({ enabledInstances: 0, totalInstances: 1, settingsEnabled: true, confirm: true, assumeYes: false, interactive: true }) === 'disabled', 'disabled')
check('no client at all reads as no-client',
  cli.decideQuit({ enabledInstances: 0, totalInstances: 0, settingsEnabled: true, confirm: true, assumeYes: false, interactive: true }) === 'no-client', 'no-client')
check('a published setting of off reads as disabled even with no client',
  cli.decideQuit({ enabledInstances: 0, totalInstances: 0, settingsEnabled: false, confirm: true, assumeYes: false, interactive: true }) === 'disabled', 'disabled')

for (const good of ['dsh-quit', 'dshq', 'quit-dsh', 'dsq', 'a', 'q1_-2']) {
  check('accepts terminal name ' + good, install.validateTerminalName(good).ok === true, JSON.stringify(install.validateTerminalName(good)))
}
for (const bad of ['', 'Quit', 'dsh quit', '退出', '2fast', '-x', 'con', 'NUL', 'com1']) {
  check('refuses terminal name ' + JSON.stringify(bad), install.validateTerminalName(bad).ok === false, JSON.stringify(install.validateTerminalName(bad)))
}
check('the reserved-name refusal explains itself',
  String(install.validateTerminalName('con').message ?? '').includes('保留'), String(install.validateTerminalName('con').message))

check('help mentions --yes', cli.helpText().includes('--yes'), 'help')
check('help names the default command by default', cli.helpText().includes('quit-dsh --yes'), cli.helpText().split('\n')[3])
check('help names whichever command was run',
  cli.helpText('dshq').includes('dshq --yes') && !cli.helpText('dshq').includes('quit-dsh'), cli.helpText('dshq').split('\n')[3])
check('confirmation text warns about the client own dialog', cli.confirmText().includes('确认框'), 'confirm')

// Which name the command calls itself: the launcher that ran it, then what the
// client published, then the built-in default. Each source is checked against
// the name rule, because both of the first two are text this command did not
// choose and it ends up in a terminal.
const envName = (value) => ({ [state.COMMAND_NAME_ENV]: value })
check('the launcher name wins', cli.resolveCommandName({ terminalName: 'dshq' }, envName('qd')) === 'qd', 'env')
check('the launcher name is used when nothing was published', cli.resolveCommandName({}, envName('qd')) === 'qd', 'env')
check('the published name answers without a launcher', cli.resolveCommandName({ terminalName: 'dshq' }, {}) === 'dshq', 'settings')
check('the default answers when nothing is known', cli.resolveCommandName({}, {}) === 'quit-dsh', 'default')
check('a launcher name that breaks the rule is ignored', cli.resolveCommandName({ terminalName: 'dshq' }, envName('Bad Name')) === 'dshq', 'ignored')
check('a published name that breaks the rule is ignored', cli.resolveCommandName({ terminalName: '2bad' }, {}) === 'quit-dsh', 'ignored')
check('an empty launcher name is ignored', cli.resolveCommandName({}, envName('')) === 'quit-dsh', 'ignored')

// ---------------------------------------------------------------------------
// The relay itself
// ---------------------------------------------------------------------------
let quitCalls = 0
const token = channel.createToken()
const server = await channel.createQuitServer({
  token,
  onQuit: async () => {
    quitCalls += 1
    return undefined
  }
})
check('the fallback transport is a loopback port', server.endpoint.kind === 'tcp' && server.endpoint.host === '127.0.0.1', JSON.stringify(server.endpoint))
check('the token is 64 hex characters', /^[0-9a-f]{64}$/.test(token), token.length + ' chars')

const pinged = await channel.requestQuit({ endpoint: server.endpoint, token, command: 'ping' })
check('a ping is answered', pinged.ok === true, JSON.stringify(pinged))
check('a ping does not quit anything', quitCalls === 0, String(quitCalls))

const wrong = await channel.requestQuit({ endpoint: server.endpoint, token: 'f'.repeat(64) })
check('a wrong password is refused', wrong.ok === false && wrong.error === 'bad-token', JSON.stringify(wrong))
check('a refused request does not quit anything', quitCalls === 0, String(quitCalls))

const quit = await channel.requestQuit({ endpoint: server.endpoint, token })
check('a correct request is accepted', quit.ok === true, JSON.stringify(quit))
check('a correct request quits once', quitCalls === 1, String(quitCalls))

const failing = await channel.createQuitServer({ token, onQuit: async () => 'no-shell' })
const refused = await channel.requestQuit({ endpoint: failing.endpoint, token })
check('a handler failure is reported back', refused.ok === false && refused.error === 'no-shell', JSON.stringify(refused))
failing.close()

const dead = await channel.requestQuit({ endpoint: { kind: 'tcp', host: '127.0.0.1', port: 1 }, token, timeout: 800 })
check('an unreachable client is a value, not a throw', dead.ok === false, JSON.stringify(dead))

// The transport production actually prefers. A confined environment cannot
// create a named pipe at all — which is precisely why the loopback fallback
// exists — so where the pipe is unavailable this section reports a skip rather
// than a failure.
let pipeServer
try {
  pipeServer = await channel.createQuitServer({ token, onQuit: async () => undefined, transport: 'pipe' })
} catch {
  pipeServer = undefined
}
if (pipeServer === undefined) {
  console.log('SKIP  the named-pipe transport is unavailable in this environment')
} else {
  check('the named pipe is used when the caller insists', pipeServer.endpoint.kind === 'pipe', JSON.stringify(pipeServer.endpoint))
  const viaPipe = await channel.requestQuit({ endpoint: pipeServer.endpoint, token })
  check('a request over the named pipe is accepted', viaPipe.ok === true, JSON.stringify(viaPipe))
  const badPipe = await channel.requestQuit({ endpoint: pipeServer.endpoint, token: 'a'.repeat(64) })
  check('a wrong password over the named pipe is refused', badPipe.ok === false && badPipe.error === 'bad-token', JSON.stringify(badPipe))
  const missingPipe = await channel.requestQuit({ endpoint: { kind: 'pipe', path: '\\\\.\\pipe\\dsh-quit-nobody' }, token, timeout: 800 })
  check('a missing pipe is a value, not a throw', missingPipe.ok === false, JSON.stringify(missingPipe))
  pipeServer.close()
}

// ---------------------------------------------------------------------------
// The command, against records on disk
// ---------------------------------------------------------------------------
const instanceFile = path.join(state.instanceDir(), `${process.pid}.json`)
const writeInstance = (patch) => {
  fs.mkdirSync(state.instanceDir(), { recursive: true })
  fs.writeFileSync(instanceFile, JSON.stringify({ version: state.INSTANCE_VERSION, pid: process.pid, endpoint: server.endpoint, token, enabled: true, confirm: true, name: 'dsh-quit', ...patch }))
}
const clearInstances = () => fs.rmSync(state.instanceDir(), { recursive: true, force: true })

state.writeSettings({ terminalEnabled: true, terminalConfirm: true, terminalName: 'dsh-quit' })

// No client running.
clearInstances()
const idle = scriptedIo('y')
const idleCode = await cli.main([], idle)
check('with no client the command exits 4', idleCode === cli.EXIT.noClient, String(idleCode))
check('the no-client message names the client', idle.text().includes('没有检测到'), idle.text())
check('the no-client message adopts the published command name', idle.text().includes('再运行 dsh-quit。'), idle.text())
check('the no-client run asks nothing', !idle.text().includes('确认退出吗'), 'no prompt')

// The launcher records the name it was installed under, and that name reaches
// every message — the settings are only the fallback for a launcher written
// before the name was recorded.
process.env[state.COMMAND_NAME_ENV] = 'dshq'
const named = scriptedIo('y')
await cli.main([], named)
check('the launcher name overrides the published one in the message', named.text().includes('再运行 dshq。'), named.text())
const namedHelp = scriptedIo('y')
await cli.main(['--help'], namedHelp)
check('the launcher name reaches the usage text', namedHelp.text().includes('dshq --yes'), namedHelp.text().split('\n')[3])
delete process.env[state.COMMAND_NAME_ENV]

// The feature switched off, with a client running.
writeInstance({ enabled: false, endpoint: null, token: null })
state.writeSettings({ terminalEnabled: false })
const off = scriptedIo('y')
const offCode = await cli.main([], off)
check('a client with the feature off exits 3', offCode === cli.EXIT.disabled, String(offCode))
check('the disabled message points at the settings page', off.text().includes('设置'), off.text())

// Back on.
state.writeSettings({ terminalEnabled: true })
writeInstance({})
const listed = scriptedIo('y')
await cli.main(['--list'], listed)
check('--list names the running client', listed.text().includes(`pid ${process.pid}`), listed.text())
check('--list reports the feature state', listed.text().includes('终端退出功能：已开启'), listed.text())

// Enter alone must not quit.
const before = quitCalls
const blank = scriptedIo('')
check('Enter alone cancels', (await cli.main([], blank)) === cli.EXIT.ok, 'ok')
check('Enter alone quits nothing', quitCalls === before, String(quitCalls - before))
check('the cancellation is stated', blank.text().includes('已取消'), blank.text())
check('the question was asked', blank.text().includes('确认退出吗？ [y/N]'), blank.text())

// An explicit yes quits.
const accepted = scriptedIo('y')
check('answering y exits 0', (await cli.main([], accepted)) === cli.EXIT.ok, 'ok')
check('answering y quits once', quitCalls === before + 1, String(quitCalls - before))
check('the success line is printed', accepted.text().includes('正在请求关闭'), accepted.text())

// Confirmation switched off: no question, straight to work.
writeInstance({ confirm: false })
const silent = scriptedIo('n')
const silentBefore = quitCalls
await cli.main([], silent)
check('confirmation off never asks', !silent.text().includes('确认退出吗'), silent.text())
check('confirmation off still quits', quitCalls === silentBefore + 1, String(quitCalls - silentBefore))

// A redirected run cannot answer, so it must refuse instead of hanging.
writeInstance({ confirm: true })
const redirected = scriptedIo('y', { interactive: false })
check('a redirected run exits 5', (await cli.main([], redirected)) === cli.EXIT.cannotAsk, 'cannotAsk')
check('the refusal names --yes as the way through', redirected.errorText().includes('--yes'), redirected.errorText())
check('the refusal names the command that was run', redirected.errorText().includes('dsh-quit --yes'), redirected.errorText())
const forced = scriptedIo('', { interactive: false })
const forcedBefore = quitCalls
check('a redirected run with --yes quits', (await cli.main(['--yes'], forced)) === cli.EXIT.ok, 'ok')
check('--yes really quit once', quitCalls === forcedBefore + 1, String(quitCalls - forcedBefore))

// A client that is gone is reported, not retried forever.
const stale = scriptedIo('y')
writeInstance({ endpoint: { kind: 'tcp', host: '127.0.0.1', port: 1 } })
check('an unreachable client exits 1', (await cli.main(['--yes'], stale)) === cli.EXIT.failed, 'failed')
check('the failure names the client', stale.errorText().includes(`pid ${process.pid}`), stale.errorText())

// An unknown flag is a usage error, not a quit.
const usage = scriptedIo('y')
check('an unknown flag exits 2', (await cli.main(['--wat'], usage)) === cli.EXIT.usage, 'usage')
check('--help exits 0', (await cli.main(['--help'], scriptedIo('y'))) === cli.EXIT.ok, 'help')

// A dead process's record ages out instead of being reported.
const deadFile = path.join(state.instanceDir(), '999999.json')
fs.writeFileSync(deadFile, JSON.stringify({ version: state.INSTANCE_VERSION, pid: 999999, endpoint: server.endpoint, token, enabled: true, confirm: true }))
state.readInstances()
check('a record whose process is gone is deleted', !fs.existsSync(deadFile), deadFile)

clearInstances()
server.close()

// ---------------------------------------------------------------------------
// The launcher files
// ---------------------------------------------------------------------------
const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-bin-'))
const pluginDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const written = install.installShim({ dir: installDir, name: 'dsh-quit', pluginDir, nodePath: 'C:\\Program Files\\nodejs\\node.exe', electron: false })
check('both launcher files are written', JSON.stringify(written.files) === JSON.stringify(['dsh-quit.cmd', 'dsh-quit']), JSON.stringify(written.files))
check('the cmd shim carries the ownership marker', install.isOwnShim(path.join(installDir, 'dsh-quit.cmd')) === true, 'marker')
check('the posix shim carries the ownership marker', install.isOwnShim(path.join(installDir, 'dsh-quit')) === true, 'marker')
check('the shim generation is readable', install.readShimVersion(path.join(installDir, 'dsh-quit.cmd')) === install.SHIM_VERSION, String(install.readShimVersion(path.join(installDir, 'dsh-quit.cmd'))))
check('a file that is not a shim has no generation', install.readShimVersion(path.join(installDir, 'nope.txt')) === undefined, 'undefined')
check('a freshly installed pair counts as current', install.launcherIsCurrent(installDir, 'dsh-quit') === true, 'current')
check('the cmd shim records the node command', fs.readFileSync(path.join(installDir, 'dsh-quit.cmd'), 'utf8').includes('DSH_QUIT_NODE=C:\\Program Files\\nodejs\\node.exe'), 'node')
check('the cmd shim records the electron flag', fs.readFileSync(path.join(installDir, 'dsh-quit.cmd'), 'utf8').includes('DSH_QUIT_ELECTRON=0'), 'electron')
check('the cmd shim records the name it was installed under',
  fs.readFileSync(path.join(installDir, 'dsh-quit.cmd'), 'utf8').includes(`${state.COMMAND_NAME_ENV}=dsh-quit`), 'name')
check('the posix shim records the name it was installed under',
  fs.readFileSync(path.join(installDir, 'dsh-quit'), 'utf8').includes(`${state.COMMAND_NAME_ENV}='dsh-quit'`), 'name')
check('a shim rendered without a name records none',
  !install.renderCmdShim({ pluginDir: 'D:\\plain\\plugin', nodePath: 'C:\\nodejs\\node.exe', electron: false }).includes(state.COMMAND_NAME_ENV), 'absent')
check('a shim refuses to record an illegal name',
  !install.renderCmdShim({ pluginDir: 'D:\\plain\\plugin', name: 'Bad Name"&del', nodePath: 'C:\\nodejs\\node.exe', electron: false }).includes(state.COMMAND_NAME_ENV), 'refused')
check('the posix shim points at the plugin launcher', fs.readFileSync(path.join(installDir, 'dsh-quit'), 'utf8').includes('/bin/dsh-quit'), 'launcher')
check('the cmd shim points at the plugin launcher', fs.readFileSync(path.join(installDir, 'dsh-quit.cmd'), 'utf8').includes('\\bin\\dsh-quit.cmd'), 'launcher')

const electronShim = install.renderCmdShim({ pluginDir, nodePath: 'D:\\App\\DeepSeek Harness.exe', electron: true })
check('an electron node command is flagged', electronShim.includes('DSH_QUIT_ELECTRON=1'), electronShim.split('\r\n')[6])

// The shipped launchers name their entry point by hand, and cmd.exe reads a
// .cmd file in the console's OEM code page: a renamed module or a stray
// non-ASCII character would only ever surface on a user's machine.
const launcherDir = path.join(pluginDir, 'bin')
check('the cmd launcher names an entry point that exists',
  fs.readFileSync(path.join(launcherDir, 'dsh-quit.cmd'), 'utf8').includes('dsh-quit.mjs') && fs.existsSync(path.join(launcherDir, 'dsh-quit.mjs')), 'dsh-quit.cmd')
check('the posix launcher names an entry point that exists',
  fs.readFileSync(path.join(launcherDir, 'dsh-quit'), 'utf8').includes('dsh-quit.mjs') && fs.existsSync(path.join(launcherDir, 'dsh-quit.mjs')), 'dsh-quit')
check('the cmd launcher is pure ASCII',
  /^[\t\n\r\x20-\x7e]*$/.test(fs.readFileSync(path.join(launcherDir, 'dsh-quit.cmd'), 'utf8')), 'ascii')
check('the cmd launcher uses the name it was called under',
  fs.readFileSync(path.join(launcherDir, 'dsh-quit.cmd'), 'utf8').includes(`%${state.COMMAND_NAME_ENV}%`), 'dsh-quit.cmd')

// The whole chain as a user meets it: a shim on PATH, written under a name of
// its own, runs the launcher, which runs the command — and every line of the
// usage text names that name rather than the default. Only Windows can run the
// .cmd half, so elsewhere this section reports a skip.
if (process.platform !== 'win32') {
  console.log('SKIP  the installed .cmd shim can only be run on Windows')
} else {
  const chainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-chain-'))
  install.installShim({ dir: chainDir, name: 'dshq', pluginDir, nodePath: process.execPath, electron: false })
  const chainOut = path.join(chainDir, 'help.txt')
  const chainFd = fs.openSync(chainOut, 'w')
  const chainCode = await new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/d', '/c', path.join(chainDir, 'dshq.cmd'), '--help'], {
      stdio: ['ignore', chainFd, chainFd],
      env: { ...process.env, [state.COMMAND_NAME_ENV]: undefined }
    })
    child.on('exit', resolve)
  })
  fs.closeSync(chainFd)
  const chainText = fs.readFileSync(chainOut, 'utf8')
  check('a shim on PATH runs the command', chainCode === 0, `${chainCode} ${chainText.trim().slice(0, 120)}`)
  check('the command prints the shim own name', chainText.includes('dshq --yes'), chainText.trim().slice(0, 120))
  check('the command never prints a name the user does not have', !chainText.includes('quit-dsh'), chainText.trim().slice(0, 120))
  fs.rmSync(chainDir, { recursive: true, force: true })
}

// The recorded Node.js decides whether a shell waits for the command's output
// and where it is expected to be found, so it has to be a real file.
const nodeCommand = install.resolveNodeCommand()
check('a Node.js is resolved for the launcher', typeof nodeCommand.nodePath === 'string' && nodeCommand.nodePath.length > 0, JSON.stringify(nodeCommand))
check('the resolved Node.js is a console program, not the desktop executable',
  nodeCommand.electron === false && fs.existsSync(nodeCommand.nodePath), JSON.stringify(nodeCommand))

const fakeNodeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-node-'))
const fakeNode = path.join(fakeNodeDir, process.platform === 'win32' ? 'node.exe' : 'node')
fs.writeFileSync(fakeNode, 'not really node\n')
const savedPath = process.env.PATH
process.env.PATH = fakeNodeDir + path.delimiter + (savedPath ?? '')
check('a Node.js on PATH is found by name', install.findNodeOnPath() === fakeNode, String(install.findNodeOnPath()))
check('a Node.js on PATH wins over the running executable',
  install.resolveNodeCommand().nodePath === fakeNode && install.resolveNodeCommand().electron === false,
  JSON.stringify(install.resolveNodeCommand()))
process.env.PATH = savedPath
fs.rmSync(fakeNodeDir, { recursive: true, force: true })
check('the installer launchers are pure ASCII',
  ['install-dsh-quit.cmd', 'uninstall-dsh-quit.cmd'].every((file) => /^[\t\n\r\x20-\x7e]*$/.test(fs.readFileSync(path.join(pluginDir, file), 'utf8'))), 'ascii')
check('the shipped cmd shim is pure ASCII for an ASCII install path',
  /^[\t\n\r\x20-\x7e]*$/.test(install.renderCmdShim({ pluginDir: 'D:\\plain\\plugin', nodePath: 'C:\\nodejs\\node.exe', electron: false })), 'ascii')

check('a free name has no conflict', install.scanConflicts('dsh-quit', { dirs: [installDir] }).length === 0, 'free')
// A file this feature did not write is a conflict, whatever its extension.
fs.writeFileSync(path.join(installDir, 'dshq.ps1'), 'Write-Host nope')
const conflicts = install.scanConflicts('dshq', { dirs: [installDir] })
check('a foreign file with the name is a conflict', conflicts.length === 1 && conflicts[0].file === 'dshq.ps1', JSON.stringify(conflicts))
fs.rmSync(path.join(installDir, 'dshq.ps1'))

// A rename removes only this feature's own files.
install.installShim({ dir: installDir, name: 'dshq', pluginDir, nodePath: 'node', electron: false })
const removed = install.removeOtherShims({ dir: installDir, keep: ['dshq.cmd', 'dshq'] })
check('a rename removes the old pair', JSON.stringify(removed.sort()) === JSON.stringify(['dsh-quit', 'dsh-quit.cmd']), JSON.stringify(removed))
check('a rename keeps the new pair', install.isOwnShim(path.join(installDir, 'dshq.cmd')) === true, 'kept')
fs.writeFileSync(path.join(installDir, 'keep-me.txt'), 'not ours')
install.removeOtherShims({ dir: installDir, keep: ['dshq.cmd', 'dshq'] })
check('a sweep never touches a file it did not write', fs.existsSync(path.join(installDir, 'keep-me.txt')), 'kept foreign file')

install.removeShim({ dir: installDir, name: 'dshq' })
check('uninstall removes this feature files', !fs.existsSync(path.join(installDir, 'dshq.cmd')) && !fs.existsSync(path.join(installDir, 'dshq')), 'removed')

// ---------------------------------------------------------------------------
// The install directory is found through DSH's own command
// ---------------------------------------------------------------------------
const fakeDsh = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-quit-dsh-'))
fs.writeFileSync(path.join(fakeDsh, 'dsh.cmd'), '@echo off\r\n')
process.env.DSH_COMMAND_DIR = fakeDsh
const found = install.findCommandDir()
check('the install directory is the one holding dsh.cmd', found?.dir === path.resolve(fakeDsh), JSON.stringify(found))
delete process.env.DSH_COMMAND_DIR
check('without an override discovery still runs', install.findCommandDir() === undefined || typeof install.findCommandDir().dir === 'string', 'discovery')

// ---------------------------------------------------------------------------
// The Host half, end to end
// ---------------------------------------------------------------------------
clearInstances()
state.writeSettings({ terminalEnabled: true, terminalConfirm: true, terminalName: 'dsh-quit' })
let hostQuits = 0
const statuses = []
const controller = host.createTerminalQuit({
  readConfig: () => ({ enabled: true, confirm: true, name: 'dsh-quit' }),
  requestQuit: async () => {
    hostQuits += 1
    return undefined
  },
  pluginDir,
  publish: (payload) => statuses.push(payload),
  logger: { warn() {}, error() {} },
  version: '1.2.0'
})
await controller.sync()

const record = state.readInstances().find((item) => item.pid === process.pid)
check('the Host publishes its instance record', record !== undefined, JSON.stringify(state.readInstances()))
check('the record carries a live endpoint', record?.endpoint?.kind === 'tcp', JSON.stringify(record?.endpoint))
check('the record carries the confirmation setting', record?.confirm === true, String(record?.confirm))
check('the Host publishes the settings the command falls back to', state.readSettings().terminalName === 'dsh-quit', JSON.stringify(state.readSettings()))
check('the Host reports the launcher as not installed yet', statuses.at(-1)?.state === 'missing', JSON.stringify(statuses.at(-1)))

const throughHost = await channel.requestQuit({ endpoint: record.endpoint, token: record.token })
check('a request through the Host endpoint is answered', throughHost.ok === true, JSON.stringify(throughHost))
check('a request through the Host endpoint reaches the quit path', hostQuits === 1, String(hostQuits))

// The launcher is only touched once the installer has recorded an installation.
fs.mkdirSync(path.join(stateRoot, 'bin'), { recursive: true })
state.writeSettings({ installed: { dir: path.join(stateRoot, 'bin'), name: 'dsh-quit', nodePath: process.execPath, electron: false } })
await controller.sync()
check('the Host installs the launcher the installer recorded', fs.existsSync(path.join(stateRoot, 'bin', 'dsh-quit.cmd')), 'installed')
check('the Host reports the launcher as installed', statuses.at(-1)?.state === 'installed', JSON.stringify(statuses.at(-1)))
check('the installed launcher records a working runtime', fs.readFileSync(path.join(stateRoot, 'bin', 'dsh-quit.cmd'), 'utf8').includes(install.resolveNodeCommand().nodePath), 'node path')

// A launcher an older version of this feature wrote is still ours, but it is
// stale: it cannot report the name it was installed under, so it is replaced
// rather than left alone. Without this, a fix to what a shim records would only
// ever reach a machine that renamed its command or reinstalled by hand.
fs.writeFileSync(path.join(stateRoot, 'bin', 'dsh-quit.cmd'), `@echo off\r\nrem ${install.SHIM_MARK} v1\r\ncall "old-launcher" %*\r\n`)
check('an older generation is not current', install.launcherIsCurrent(path.join(stateRoot, 'bin'), 'dsh-quit') === false, 'stale')
await controller.sync()
check('an older generation is rewritten', fs.readFileSync(path.join(stateRoot, 'bin', 'dsh-quit.cmd'), 'utf8').includes(`${state.COMMAND_NAME_ENV}=dsh-quit`), 'rewritten')
check('the rewritten launcher is current', install.launcherIsCurrent(path.join(stateRoot, 'bin'), 'dsh-quit') === true, 'current')

// A rename moves the file and leaves nothing behind under the old name.
const renamed = host.createTerminalQuit({
  readConfig: () => ({ enabled: true, confirm: false, name: 'dshq' }),
  requestQuit: async () => undefined,
  pluginDir,
  publish: () => {},
  logger: { warn() {}, error() {} },
  version: '1.2.0'
})
await renamed.sync()
check('a rename installs the new name', fs.existsSync(path.join(stateRoot, 'bin', 'dshq.cmd')), 'new')
check('a rename removes the old name', !fs.existsSync(path.join(stateRoot, 'bin', 'dsh-quit.cmd')), 'old')
renamed.dispose()

// Switching the feature off stops the listener and says so.
const disabled = host.createTerminalQuit({
  readConfig: () => ({ enabled: false, confirm: true, name: 'dshq' }),
  requestQuit: async () => undefined,
  pluginDir,
  publish: (payload) => statuses.push(payload),
  logger: { warn() {}, error() {} },
  version: '1.2.0'
})
await disabled.sync()
check('switching the feature off is reported', statuses.at(-1)?.state === 'disabled', JSON.stringify(statuses.at(-1)))
const offRecord = state.readInstances().find((item) => item.pid === process.pid)
check('the off state is published so the command can explain itself', offRecord?.enabled === false, JSON.stringify(offRecord))
check('the published settings follow the switch', state.readSettings().terminalEnabled === false, JSON.stringify(state.readSettings()))
disabled.dispose()

controller.dispose()
check('disposing removes the instance record', state.readInstances().length === 0, JSON.stringify(state.readInstances()))

// ---------------------------------------------------------------------------
// The shipped entry point, run as a real process against a real client half.
// Its output is redirected to a file rather than a pipe, because a piped stdio
// is exactly what a confined environment refuses.
// ---------------------------------------------------------------------------
clearInstances()
state.writeSettings({ terminalEnabled: true, terminalConfirm: true, terminalName: 'dsh-quit' })
let spawnedQuits = 0
const shipped = host.createTerminalQuit({
  readConfig: () => ({ enabled: true, confirm: true, name: 'dsh-quit' }),
  requestQuit: async () => {
    spawnedQuits += 1
    return undefined
  },
  pluginDir,
  publish: () => {},
  logger: { warn() {}, error() {} },
  version: '1.2.0'
})
await shipped.sync()
const outFile = path.join(stateRoot, 'cli-out.txt')
const outFd = fs.openSync(outFile, 'w')
const shippedCode = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(pluginDir, 'bin', 'dsh-quit.mjs'), '--yes'], {
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env }
  })
  child.on('exit', resolve)
})
fs.closeSync(outFd)
const printed = fs.readFileSync(outFile, 'utf8')
check('the shipped entry point runs as a process', shippedCode === 0, String(shippedCode))
check('the shipped entry point reaches the running client', spawnedQuits === 1, String(spawnedQuits))
check('the shipped entry point prints the result', printed.includes('正在请求关闭'), printed.trim())
shipped.dispose()
clearInstances()

// ---------------------------------------------------------------------------
// The same run with no transport preference at all: the Host picks the named
// pipe, and the shipped entry point talks to it. This is the production path.
// ---------------------------------------------------------------------------
delete process.env.DSH_COMMAND_QUIT_TRANSPORT
let pipeQuits = 0
const production = host.createTerminalQuit({
  readConfig: () => ({ enabled: true, confirm: false, name: 'dsh-quit' }),
  requestQuit: async () => {
    pipeQuits += 1
    return undefined
  },
  pluginDir,
  publish: () => {},
  logger: { warn() {}, error() {} },
  version: '1.2.0'
})
await production.sync()
const productionRecord = state.readInstances().find((item) => item.pid === process.pid)
check('with no preference the Host listens on a named pipe', productionRecord?.endpoint?.kind === 'pipe', JSON.stringify(productionRecord?.endpoint))
const pipeOut = path.join(stateRoot, 'cli-pipe.txt')
const pipeFd = fs.openSync(pipeOut, 'w')
const pipeCode = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(pluginDir, 'bin', 'dsh-quit.mjs'), '--yes'], {
    stdio: ['ignore', pipeFd, pipeFd],
    env: { ...process.env }
  })
  child.on('exit', resolve)
})
fs.closeSync(pipeFd)
check('the shipped entry point reaches a Host listening on a named pipe', pipeCode === 0 && pipeQuits === 1, `${pipeCode}/${pipeQuits}`)
check('the production run prints the result', fs.readFileSync(pipeOut, 'utf8').includes('已发送退出请求'), fs.readFileSync(pipeOut, 'utf8').trim())
production.dispose()
clearInstances()
process.env.DSH_COMMAND_QUIT_TRANSPORT = 'tcp'

fs.rmSync(stateRoot, { recursive: true, force: true })
fs.rmSync(installDir, { recursive: true, force: true })
fs.rmSync(fakeDsh, { recursive: true, force: true })

console.log('')
console.log(failures === 0 ? 'ALL TERMINAL CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
