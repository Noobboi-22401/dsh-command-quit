/**
 * The terminal command itself: `quit-dsh`.
 *
 * Everything the user sees when they type the command happens here. The three
 * decisions worth spelling out are what it asks, what it does when it cannot
 * ask, and who it talks to.
 *
 * What it asks. The configured confirmation is honoured first: with it on, the
 * command prints what is about to happen and waits for `y`. Enter alone means
 * no — a stray Enter from a shell history recall must not close a running
 * client — and only `y`, `yes` or `是` are read as consent. `--yes` skips the
 * question for that one invocation, for a shortcut or a script.
 *
 * When it cannot ask. A redirect or a pipe means no one is there to answer, so
 * waiting would hang forever and guessing would be worse. The command refuses,
 * says so, and names `--yes` as the way to say yes in advance.
 *
 * Who it talks to. Not one client but every client that is running: the two
 * halves of DSH are launched together often enough that a user with two windows
 * open means to close both. A client whose terminal feature is switched off is
 * passed over, and the command says the feature is off rather than reporting a
 * client it decided not to touch.
 *
 * What it calls itself. The command is one file shared by every name it can be
 * installed under, so it does not know which name the user typed. It asks, in
 * order: the launcher that ran it (which recorded its own name), the settings
 * the client published, and finally the built-in default. Every message that
 * names the command uses that answer, so a user who renamed it to `dshq` reads
 * `dshq --yes` and not a command that does not exist.
 *
 * @module dsh-command-quit/quit-cli
 */
import readline from 'node:readline'
import { requestQuit } from './quit-channel.js'
import { COMMAND_NAME_ENV, DEFAULT_TERMINAL_NAME, TERMINAL_NAME_PATTERN, readInstances, readSettings } from './terminal-state.js'

/** Exit codes, so a script can tell "off" from "not running" from "failed". */
export const EXIT = Object.freeze({
  ok: 0,
  failed: 1,
  usage: 2,
  disabled: 3,
  noClient: 4,
  cannotAsk: 5
})

/** Answers read as consent. Everything else, including Enter, means no. */
const YES = Object.freeze(['y', 'yes', '是', '好', '确定', '确认'])

/**
 * The name this invocation should call itself.
 *
 * Three answers, best first, and the order carries the meaning.
 *
 * The launcher that ran the command recorded its own name, and that is the name
 * the user typed: nothing else can be truer. The published settings are the
 * fallback for a launcher written before this was recorded, or for the module run
 * directly. The default is the last resort, for a state directory that has never
 * been written to.
 *
 * Both sources are checked against the name rule before use. They are only ever
 * printed, but a name read from a file or the environment is text this command
 * did not choose, and it must not be able to smuggle an escape sequence into
 * someone's terminal.
 *
 * @param settings - the published settings; read from disk when omitted.
 * @param env - the environment to read; the process's own when omitted.
 * @returns a legal command name.
 */
export function resolveCommandName(settings = readSettings(), env = process.env) {
  for (const candidate of [env?.[COMMAND_NAME_ENV], settings?.terminalName]) {
    if (typeof candidate === 'string' && TERMINAL_NAME_PATTERN.test(candidate)) return candidate
  }
  return DEFAULT_TERMINAL_NAME
}

/**
 * Parse the command line.
 * @param argv - arguments after the command name.
 * @returns `{ yes, list, help, unknown }`.
 */
export function parseArgs(argv) {
  const result = { yes: false, list: false, help: false, unknown: [] }
  for (const arg of argv) {
    const value = arg.toLowerCase()
    if (value === '--yes' || value === '-y') result.yes = true
    else if (value === '--list' || value === '-l') result.list = true
    else if (value === '--help' || value === '-h' || value === '/?') result.help = true
    else result.unknown.push(arg)
  }
  return result
}

/**
 * Read one answer as consent or refusal.
 * @param text - what the user typed.
 * @returns `true` only for an explicit yes.
 */
export function parseConfirmation(text) {
  if (typeof text !== 'string') return false
  return YES.includes(text.trim().toLowerCase())
}

/**
 * Decide whether this invocation must ask before quitting.
 *
 * The published settings are the fallback, not the authority: a running client
 * publishes its own live answer, and a client that is running knows better than
 * a file written when it started. When several are running the strictest answer
 * wins — asking once too often costs one keystroke, not asking when someone
 * wanted to be asked costs a closed client.
 *
 * @param instances - the live instance records.
 * @param settings - the published settings.
 * @returns `true` when the user should be asked.
 */
export function resolveConfirmation(instances, settings) {
  const answers = instances
    .filter((instance) => instance.enabled !== false)
    .map((instance) => instance.confirm)
    .filter((value) => typeof value === 'boolean')
  if (answers.includes(true)) return true
  if (answers.length > 0) return false
  return settings?.terminalConfirm !== false
}

/**
 * Classify the situation before anything is asked or sent.
 *
 * @param input - the facts: how many clients there are and with which setting,
 *   what the published settings say, and whether asking is possible.
 * @returns one of `disabled`, `no-client`, `refuse`, `ask`, `proceed`.
 */
export function decideQuit(input) {
  const { enabledInstances, totalInstances, settingsEnabled, confirm, assumeYes, interactive } = input
  if (enabledInstances === 0) {
    if (totalInstances > 0 || settingsEnabled === false) return 'disabled'
    return 'no-client'
  }
  if (assumeYes || confirm !== true) return 'proceed'
  return interactive ? 'ask' : 'refuse'
}

/**
 * The usage text, also shown by `--help`.
 * @param name - the command name to print; defaults to the built-in one.
 * @returns the text.
 */
export function helpText(name = DEFAULT_TERMINAL_NAME) {
  return [
    `${name} —— 在终端里关闭 DeepSeek Harness 客户端`,
    '',
    '用法：',
    `  ${name}            先问一句，回答 y 才关闭`,
    `  ${name} --yes      不询问，直接关闭（写脚本时用）`,
    `  ${name} --list     只列出正在运行的客户端，不关闭`,
    `  ${name} --help     显示这段说明`,
    '',
    '说明：',
    '  需要客户端正在运行。关闭走的是 DSH 自己的正常退出流程，不是强行结束进程；',
    '  如果客户端里还有任务在跑，它自己还会再弹一次确认框。',
    '  要不要先问你，可以在客户端的“设置 → 插件 → 退出命令”里改。',
    ''
  ].join('\n')
}

/** The explanation printed before the question. */
export function confirmText() {
  return [
    '即将关闭 DeepSeek Harness 客户端。',
    '（如果客户端里还有任务在跑，关的时候它自己还会再弹一次确认框。）',
    ''
  ].join('\n')
}

/**
 * The streams and the question this run uses.
 *
 * Splitting them out is what lets the whole command be exercised in-process:
 * the test supplies an answer instead of a keyboard, and reads what would have
 * been printed.
 *
 * @returns the default binding to the real process.
 */
export function defaultIo() {
  return {
    write: (text) => process.stdout.write(text),
    writeError: (text) => process.stderr.write(text),
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    read: (prompt) =>
      new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        rl.question(prompt, (answer) => {
          rl.close()
          resolve(answer)
        })
      })
  }
}

/** One client's line for `--list`. */
function describeInstance(instance) {
  const enabled = instance.enabled === false ? '已关闭' : '已开启'
  const confirm = instance.confirm === false ? '不询问' : '先询问'
  return `  pid ${instance.pid}    终端退出功能：${enabled}    退出前：${confirm}`
}

/**
 * Run the terminal command.
 *
 * @param argv - arguments after the command name.
 * @param io - the streams to use; defaults to the real process.
 * @returns the process exit code.
 */
export async function main(argv = process.argv.slice(2), io = defaultIo()) {
  const args = parseArgs(argv)
  // Read before anything is printed: `--help` and the usage error name the
  // command, and the answer has to be the user's own name.
  const settings = readSettings()
  const name = resolveCommandName(settings)
  if (args.help) {
    io.write(helpText(name))
    return EXIT.ok
  }
  if (args.unknown.length > 0) {
    io.writeError(`不认识这个参数：${args.unknown.join(' ')}\n\n`)
    io.writeError(helpText(name))
    return EXIT.usage
  }

  const instances = readInstances()

  if (args.list) {
    if (instances.length === 0) {
      io.write('没有检测到正在运行的 DeepSeek Harness 客户端。\n')
      return EXIT.ok
    }
    io.write('正在运行的 DeepSeek Harness 客户端：\n')
    for (const instance of instances) io.write(`${describeInstance(instance)}\n`)
    return EXIT.ok
  }

  const enabled = instances.filter((instance) => instance.enabled !== false)
  const verdict = decideQuit({
    enabledInstances: enabled.length,
    totalInstances: instances.length,
    settingsEnabled: settings.terminalEnabled,
    confirm: resolveConfirmation(instances, settings),
    assumeYes: args.yes,
    interactive: io.interactive === true
  })

  if (verdict === 'disabled') {
    io.write('终端退出功能已在插件设置里关闭。\n')
    io.write('打开 DeepSeek Harness 的“设置 → 插件 → 退出命令”，把“启用终端退出功能”打开即可。\n')
    return EXIT.disabled
  }
  if (verdict === 'no-client') {
    io.write(`没有检测到正在运行的 DeepSeek Harness 客户端。请先打开客户端，再运行 ${name}。\n`)
    return EXIT.noClient
  }
  if (verdict === 'refuse') {
    io.writeError('这里不能回答问题（输入被重定向，或者不是真人对着终端），已按“不退出”处理。\n')
    io.writeError(`确定要退出的话，请加上 --yes 参数：${name} --yes\n`)
    return EXIT.cannotAsk
  }
  if (verdict === 'ask') {
    io.write(confirmText())
    const answer = await io.read('确认退出吗？ [y/N] ')
    if (!parseConfirmation(answer)) {
      io.write('已取消，客户端保持运行。\n')
      return EXIT.ok
    }
  }

  io.write('正在请求关闭 DeepSeek Harness 客户端…\n')
  const failures = []
  let delivered = 0
  for (const instance of enabled) {
    const result = await requestQuit({ endpoint: instance.endpoint, token: instance.token })
    if (result.ok) delivered += 1
    else failures.push(`pid ${instance.pid}：${result.error}`)
  }
  if (delivered === 0) {
    io.writeError('退出请求没有送到客户端。\n')
    for (const line of failures) io.writeError(`  ${line}\n`)
    return EXIT.failed
  }
  io.write('已发送退出请求，客户端正在关闭。\n')
  if (failures.length > 0) {
    io.writeError(`有 ${failures.length} 个客户端没能收到请求：\n`)
    for (const line of failures) io.writeError(`  ${line}\n`)
  }
  return EXIT.ok
}
