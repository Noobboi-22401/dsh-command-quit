// Friendly one-click fixer for the /quit-dsh desktop-shell patch.
//
// Prints Chinese guidance for a non-technical user and delegates the actual
// work to patch-asar.mjs (idempotent). Invoked by fix-quit.cmd, which stays
// ASCII-only so cmd.exe's codepage cannot mangle it.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const patchTool = fileURLToPath(new URL('./patch-asar.mjs', import.meta.url))

console.log('')
console.log('  ==========================================================')
console.log('    修复 /quit-dsh 指令')
console.log('    （客户端升级之后跑一次，平时不用管）')
console.log('  ==========================================================')
console.log('')

const result = spawnSync(process.execPath, [patchTool, '--apply'], { encoding: 'utf8' })
const output = (result.stdout ?? '') + (result.stderr ?? '')

if (result.status !== 0) {
  console.log('  ✗ 修复失败。请把下面这段内容发给 AI：')
  console.log('')
  console.log('  ' + output.trim().split('\n').join('\n  '))
  process.exit(1)
}

if (output.includes('already patched')) {
  console.log('  ✓ 检查完毕：/quit-dsh 指令本来就是好的，什么都不用做。')
} else if (output.includes('patched app.asar in place')) {
  console.log('  ✓ 已修好。')
  console.log('')
  console.log('    最后一步：从右下角托盘图标右键 →「退出」，把客户端完全关掉，')
  console.log('    再重新打开一次。之后输入 /quit-dsh 回车就能关掉客户端了。')
} else {
  console.log('  ? 结果不确定，原始输出如下：')
  console.log('')
  console.log('  ' + output.trim().split('\n').join('\n  '))
  process.exit(1)
}
