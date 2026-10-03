/**
 * Install (or remove) the terminal quit command's launcher on PATH.
 *
 * `install-dsh-quit.cmd` finds a Node.js and runs this file, so everything the
 * user reads and every decision made about their disk lives here, in one place
 * that can be run and checked directly.
 *
 * Where it installs is not a choice this script invents: DSH's own installer
 * already put `dsh.cmd` in a directory that is on the user's PATH, and that is
 * the only directory where a new command becomes reachable without the user
 * editing PATH by hand. If that directory cannot be found the script stops and
 * says so rather than guessing at one.
 *
 * The configured name is honoured, not overridden: the plugin publishes what the
 * configuration page holds, so a user who renamed the terminal command and then
 * ran the installer gets the name they chose. `--name` overrides it for a one-off
 * install.
 *
 * @module dsh-command-quit/install-terminal-command
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installShim, isOnPath, findCommandDir, removeShim, resolveNodeCommand, scanConflicts, validateTerminalName } from '../lib/terminal-install.js'
import { DEFAULT_TERMINAL_NAME, readSettings, writeSettings } from '../lib/terminal-state.js'

const PLUGIN_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Read `--flag value` and `--flag` pairs. */
function parseArgs(argv) {
  const result = { uninstall: false, name: undefined, help: false, unknown: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--uninstall') result.uninstall = true
    else if (arg === '--help' || arg === '-h') result.help = true
    else if (arg === '--name') {
      index += 1
      result.name = argv[index]
    } else result.unknown.push(arg)
  }
  return result
}

const HELP = [
  '安装 / 卸载终端退出命令的启动文件',
  '',
  '用法：',
  '  install-dsh-quit.cmd               安装（使用插件设置里的命令名）',
  '  install-dsh-quit.cmd --name dshq   安装成一个指定的名字',
  '  uninstall-dsh-quit.cmd             卸载',
  ''
].join('\n')

/** How the launcher should run Node.js when the terminal command is used. */
function nodeCommand() {
  return resolveNodeCommand()
}

/**
 * The name to install under, and where it came from.
 *
 * The published configuration wins over the built-in default because the user
 * may have renamed the command in the plugin's settings page, and an installer
 * that silently went back to the default would leave two names on PATH, one of
 * them stale.
 *
 * @param override - the `--name` value, if any.
 * @returns `{ name, source }`.
 */
function resolveName(override) {
  if (typeof override === 'string' && override.length > 0) return { name: override, source: '命令行参数' }
  const settings = readSettings()
  if (typeof settings.terminalName === 'string' && settings.terminalName.length > 0) {
    return { name: settings.terminalName, source: '插件设置' }
  }
  return { name: DEFAULT_TERMINAL_NAME, source: '默认值' }
}

/** Print the install summary. */
function report(result) {
  const lines = [
    '',
    `  插件目录：${PLUGIN_DIR}`,
    `  安装目录：${result.dir}`,
    `  命令名字：${result.name}（来自${result.source}）`,
    ''
  ]
  for (const file of result.files) lines.push(`  已写入：  ${file}`)
  lines.push('')
  if (result.onPath) {
    lines.push('安装完成。请关掉这个窗口，重新打开一个终端，然后输入下面这一行试试：')
  } else {
    lines.push('安装完成。但那个目录现在不在 PATH 里，请重新登录一次 Windows（或重启），再打开终端输入下面这一行：')
  }
  lines.push('')
  lines.push(`  ${result.name}`)
  lines.push('')
  lines.push('它会先问你一句，回答 y 再回车，客户端就会关闭。')
  if (result.settingsEnabled === false) {
    lines.push('')
    lines.push('注意：插件设置里的“启用终端退出功能”现在是关着的，所以命令只会提示这一点。')
    lines.push('打开客户端 → 设置 → 插件 → 退出命令，把它打开即可。')
  }
  lines.push('')
  console.log(lines.join('\n'))
}

/** Install the launcher, or explain why it cannot be. */
function install(args) {
  const resolved = resolveName(args.name)
  const verdict = validateTerminalName(resolved.name)
  if (!verdict.ok) {
    console.error('')
    console.error(`  ${verdict.message}`)
    console.error('')
    return 1
  }
  const found = findCommandDir()
  if (found === undefined) {
    console.error('')
    console.error('  找不到 DeepSeek Harness 的命令目录（也就是放着 dsh.cmd 的那个目录）。')
    console.error('')
    console.error('  请确认客户端已经安装过；如果装在非常规位置，可以先自己指定目录：')
    console.error('    set DSH_COMMAND_DIR=D:\\你的\\DeepSeek Harness\\resources\\runtime\\cli\\bin')
    console.error('  然后再双击一次 install-dsh-quit.cmd。')
    console.error('')
    return 1
  }
  const conflicts = scanConflicts(verdict.name)
  if (conflicts.length > 0) {
    console.error('')
    console.error(`  名字“${verdict.name}”已经被这些文件占用，不能安装：`)
    for (const conflict of conflicts) console.error(`    ${path.join(conflict.dir, conflict.file)}`)
    console.error('')
    console.error('  请先在客户端的“设置 → 插件 → 退出命令”里换一个名字，再双击一次本文件。')
    console.error('')
    return 1
  }
  const node = nodeCommand()
  try {
    fs.mkdirSync(found.dir, { recursive: true })
    const written = installShim({ dir: found.dir, name: verdict.name, pluginDir: PLUGIN_DIR, nodePath: node.nodePath, electron: node.electron })
    writeSettings({
      installed: {
        dir: found.dir,
        name: verdict.name,
        nodePath: node.nodePath,
        electron: node.electron,
        installedAt: new Date().toISOString()
      }
    })
    report({
      dir: found.dir,
      name: verdict.name,
      source: resolved.source,
      files: written.files,
      onPath: isOnPath(found.dir),
      settingsEnabled: readSettings().terminalEnabled
    })
    return 0
  } catch (error) {
    console.error('')
    console.error(`  写入失败：${error instanceof Error ? error.message : String(error)}`)
    console.error('')
    console.error('  如果提示“拒绝访问”，请右键本文件，选择“以管理员身份运行”。')
    console.error('')
    return 1
  }
}

/** Remove the launcher, leaving anything this feature did not write alone. */
function uninstall() {
  const settings = readSettings()
  const installed = settings.installed
  const dir = typeof installed?.dir === 'string' ? installed.dir : findCommandDir()?.dir
  const name = typeof installed?.name === 'string' ? installed.name : resolveName(undefined).name
  if (dir === undefined) {
    console.log('')
    console.log('  没有找到安装记录，也没有找到 DeepSeek Harness 的命令目录，无需卸载。')
    console.log('')
    return 0
  }
  const removed = removeShim({ dir, name })
  const next = { ...settings }
  delete next.installed
  writeSettings(next)
  console.log('')
  if (removed.length === 0) {
    console.log(`  在 ${dir} 里没有找到本插件安装的启动文件，无需卸载。`)
  } else {
    console.log(`  已从 ${dir} 删除：`)
    for (const file of removed) console.log(`    ${file}`)
  }
  console.log('')
  console.log('  客户端的退出命令不受影响；终端里的这个命令已经没有了。')
  console.log('')
  return 0
}

const args = parseArgs(process.argv.slice(2))
let code
if (args.help) {
  console.log(HELP)
  code = 0
} else if (args.unknown.length > 0) {
  console.error(`不认识这个参数：${args.unknown.join(' ')}`)
  console.error(HELP)
  code = 2
} else if (args.uninstall) {
  code = uninstall()
} else {
  code = install(args)
}
process.exit(code)
