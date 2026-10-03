#!/usr/bin/env node
// Entry point of the terminal quit command.
//
// `bin/dsh-quit.cmd` and `bin/dsh-quit` find a usable Node.js and run this
// file; everything that decides and prints lives in ../lib/quit-cli.js so it can
// be exercised without a terminal. The exit code is passed through unchanged,
// because a caller may want to tell "the feature is switched off" from "no
// client is running".
import { main, resolveCommandName } from '../lib/quit-cli.js'

try {
  process.exitCode = await main()
} catch (error) {
  // A crash before anything else is printed still has to name the command the
  // user actually ran, so the same three-way lookup is used here.
  process.stderr.write(`${resolveCommandName()} 运行时出错：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
