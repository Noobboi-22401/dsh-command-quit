// Restore the desktop shell from the pre-patch backup.
//
// Only the `lib/main.js` bytes are written back (same offset, same size), so the
// archive needs neither a repack nor a full copy and the rest of the
// installation is untouched.
//
//   node tools/unpatch-asar.mjs          # dry run
//   node tools/unpatch-asar.mjs --apply  # write
//
// The archive is located through tools/dsh-paths.mjs (DSH_APP_ASAR, or a
// conventional desktop install).
import fs from 'node:fs'
import crypto from 'node:crypto'
import { resolveAppAsar } from './dsh-paths.mjs'

const restorable = (fd) => {
  fs.closeSync(fd)
  process.exit(1)
}

/**
 * Read exactly `buffer.length` bytes.
 *
 * A short read means the file system returned less than we asked for (a
 * truncated backup, or an offset past the end). Without this check the buffer
 * would keep its zero bytes and look like real content, so a truncated backup
 * could be written over the live archive.
 *
 * @param fd - Open file descriptor.
 * @param buffer - Destination buffer; the read fills it completely.
 * @param position - Absolute file offset to read from.
 * @param label - Human-readable name used in the error message.
 * @param archive - Path shown in the error message.
 */
function readExact(fd, buffer, position, label, archive) {
  const got = fs.readSync(fd, buffer, 0, buffer.length, position)
  if (got !== buffer.length) {
    throw new Error(
      `short read of ${label} in ${archive}: wanted ${buffer.length} bytes at offset ${position}, got ${got}. The file is truncated.`,
    )
  }
}

/**
 * Open an archive and read `lib/main.js` out of it.
 * @param archive - Absolute path of the `app.asar` to read.
 * @param writable - Open the underlying descriptor for writing.
 * @returns The descriptor and the relevant parts of the entry.
 */
function readMain(archive, writable) {
  // Windows happily opens a directory, and only the first read reveals it.
  if (fs.existsSync(archive) && fs.statSync(archive).isDirectory()) {
    throw new Error(`${archive} is a directory, not an app.asar file.`)
  }

  let fd
  try {
    fd = fs.openSync(archive, writable ? 'r+' : 'r')
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY') {
      throw new Error(
        `cannot open ${archive} for writing: the file is locked or read-only.\nClose the DeepSeek Harness client (tray icon -> quit) and try again.\nOriginal error: ${error.message}`,
      )
    }
    if (error.code === 'EISDIR') throw new Error(`${archive} is a directory, not an app.asar file.`)
    if (error.code === 'ENOENT') throw new Error(`no file at ${archive}.`)
    throw error
  }

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
    const base = 16 + hsize
    const buf = Buffer.alloc(entry.size)
    readExact(fd, buf, base + Number(entry.offset), 'lib/main.js', archive)
    return { fd, buf, offset: base + Number(entry.offset), header: entry }
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}

/** Flush to disk; some file systems reject fsync, which is not fatal. */
function syncQuietly(fd) {
  try {
    fs.fsyncSync(fd)
  } catch {
    // Durability is best-effort here: Windows can report EINVAL for a flush.
  }
}

/** Run the tool, turning any failure into one readable message. */
function main() {
  const archive = resolveAppAsar()
  const backup = archive + '.quit-patch-backup'
  const apply = process.argv.includes('--apply')
  const MARKER = '\t\tcase "quit-request": return true;\n'

  if (!fs.existsSync(backup)) {
    console.error('no backup at ' + backup + '; nothing to restore from')
    return process.exit(1)
  }

  const live = readMain(archive, apply)
  const backupFile = readMain(backup, false)
  const liveText = live.buf.toString('latin1')
  const backupText = backupFile.buf.toString('latin1')

  console.log('archive         :', archive)
  console.log('live main.js    :', live.buf.length, 'bytes,', crypto.createHash('sha256').update(live.buf).digest('hex').slice(0, 16))
  console.log('backup main.js  :', backupFile.buf.length, 'bytes,', crypto.createHash('sha256').update(backupFile.buf).digest('hex').slice(0, 16))
  console.log('live is patched :', liveText.includes(MARKER))
  console.log('backup is patched:', backupText.includes(MARKER))

  fs.closeSync(backupFile.fd)

  if (!liveText.includes(MARKER)) {
    console.log('live archive is not patched: nothing to do')
    fs.closeSync(live.fd)
    return process.exit(0)
  }
  if (backupText.includes(MARKER)) {
    console.error('refusing: the backup itself contains the patch')
    return restorable(live.fd)
  }
  if (backupFile.buf.length !== live.buf.length) {
    console.error('refusing: backup and live main.js differ in size; restore app.asar from the backup manually')
    return restorable(live.fd)
  }

  // The backup must really hold the byte range we are about to restore from.
  const backupSize = fs.statSync(backup).size
  if (backupSize < backupFile.offset + backupFile.buf.length) {
    console.error('refusing: the backup file is truncated (it is shorter than the data it should contain)')
    console.error('backup      :', backup, '(' + backupSize + ' bytes)')
    console.error('required end:', backupFile.offset + backupFile.buf.length, 'bytes')
    console.error('Re-run the patch tool to write a fresh backup, then try again.')
    return restorable(live.fd)
  }

  // Offsets must match, or the write would land in the wrong place.
  if (backupFile.header.offset !== live.header.offset || backupFile.header.size !== live.header.size) {
    console.error('refusing: backup entry offset/size differ from the live archive header')
    return restorable(live.fd)
  }

  if (!apply) {
    console.log('dry run: no archive change. re-run with --apply to restore.')
    fs.closeSync(live.fd)
    return process.exit(0)
  }

  const written = fs.writeSync(live.fd, backupFile.buf, 0, backupFile.buf.length, live.offset)
  if (written !== backupFile.buf.length) {
    throw new Error(`short write: ${written} of ${backupFile.buf.length} bytes; the archive may be inconsistent. Restore app.asar from the backup manually.`)
  }
  syncQuietly(live.fd)

  // Read the bytes back so a torn write cannot be reported as a success.
  const check = Buffer.alloc(backupFile.buf.length)
  readExact(live.fd, check, live.offset, 'lib/main.js after restoring', archive)
  fs.closeSync(live.fd)
  if (!check.equals(backupFile.buf)) {
    throw new Error('verification failed: the archive does not match the backup after restoring. Restore app.asar from the backup manually.')
  }
  if (check.toString('latin1').includes(MARKER)) {
    throw new Error('verification failed: the patch is still present after restoring. Restore app.asar from the backup manually.')
  }

  console.log('restored and verified the original lib/main.js bytes in app.asar')
  console.log('restart the desktop client to return to the unpatched shell')
  return process.exit(0)
}

try {
  main()
} catch (error) {
  console.error('')
  console.error('restore failed: ' + (error instanceof Error ? error.message : String(error)))
  console.error('The archive was not verified as restored; re-run this tool to check its state.')
  process.exit(1)
}
