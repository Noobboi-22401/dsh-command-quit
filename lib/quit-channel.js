/**
 * The local channel a terminal command uses to ask a running client to quit.
 *
 * A terminal process is not a child of the desktop shell, so the shell's own
 * IPC channel is unreachable from it. This module is the relay: the Host side
 * listens on a local-only endpoint and the terminal side connects to it, with
 * one JSON line in each direction.
 *
 * Three properties make that safe and useful.
 *
 * Local only. The preferred transport is a named pipe, which the operating
 * system never exposes to the network. The fallback binds an ephemeral port on
 * `127.0.0.1`, and the server refuses any connection whose peer address is not
 * loopback — a machine with the port reachable from outside still cannot use it.
 *
 * Password protected. The endpoint name is not a secret, so the request carries
 * a per-process random token and the server compares it in constant time. A
 * wrong token is answered, not ignored, so a caller is never left hanging.
 *
 * Deliberately small. The only commands are `quit` and `ping`; the handler
 * returns the same failure description the slash command already reports, so a
 * missing shell channel reads the same way wherever the quit was asked for.
 *
 * @module dsh-command-quit/quit-channel
 */
import crypto from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

/** Longest request line accepted, so a garbage peer cannot grow a buffer. */
const MAX_LINE = 4096

/** Transport names accepted by {@link createQuitServer}. */
export const TRANSPORTS = Object.freeze(['auto', 'pipe', 'tcp'])

/**
 * A fresh per-process password.
 * @returns 64 hexadecimal characters from a cryptographic source.
 */
export function createToken() {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Compare a presented token with the expected one without leaking where they
 * first differ.
 *
 * @param presented - the value that arrived on the wire.
 * @param expected - the value this process published.
 * @returns `true` only for an exact match.
 */
export function sameToken(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * The transport to use when the caller expressed no preference.
 * @returns `'pipe'`, `'tcp'`, or `'auto'`.
 */
export function preferredTransport() {
  const configured = process.env.DSH_COMMAND_QUIT_TRANSPORT
  return TRANSPORTS.includes(configured) ? configured : 'auto'
}

/**
 * The named-pipe path for one server instance.
 * @returns a platform-appropriate pipe name.
 */
function pipePath() {
  const name = `dsh-command-quit-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`)
}

/**
 * A short, loggable description of an endpoint.
 * @param endpoint - an endpoint record, or nothing.
 * @returns display text.
 */
export function describeEndpoint(endpoint) {
  if (endpoint === undefined || endpoint === null) return 'none'
  if (endpoint.kind === 'tcp') return `tcp://127.0.0.1:${endpoint.port}`
  return String(endpoint.path ?? endpoint.name ?? 'pipe')
}

/** Whether a peer address is this machine. */
function isLoopback(address) {
  if (typeof address !== 'string') return false
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  )
}

/**
 * Serve one connection: read one request line, answer it, close.
 *
 * @param socket - the accepted connection.
 * @param token - the password this server expects.
 * @param onQuit - async handler returning `undefined` on success or a failure description.
 */
function serveConnection(socket, token, onQuit) {
  let buffer = ''
  let settled = false
  const answer = (payload) => {
    if (settled) return
    settled = true
    try {
      socket.end(`${JSON.stringify(payload)}\n`)
    } catch {
      socket.destroy()
    }
  }
  socket.setEncoding('utf8')
  socket.setTimeout(5000, () => answer({ ok: false, error: 'timeout' }))
  socket.on('error', () => socket.destroy())
  socket.on('data', (chunk) => {
    if (settled) return
    buffer += chunk
    const newline = buffer.indexOf('\n')
    if (newline < 0) {
      if (buffer.length > MAX_LINE) answer({ ok: false, error: 'request-too-large' })
      return
    }
    const line = buffer.slice(0, newline)
    let request
    try {
      request = JSON.parse(line)
    } catch {
      answer({ ok: false, error: 'bad-request' })
      return
    }
    if (!sameToken(request?.token, token)) {
      answer({ ok: false, error: 'bad-token' })
      return
    }
    if (request.command === 'ping') {
      answer({ ok: true, command: 'ping' })
      return
    }
    if (request.command !== 'quit') {
      answer({ ok: false, error: 'bad-command' })
      return
    }
    Promise.resolve()
      .then(() => onQuit())
      .then((failure) => {
        if (failure === undefined || failure === null) answer({ ok: true })
        else answer({ ok: false, error: String(failure) })
      })
      .catch((error) => answer({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  })
}

/**
 * Bind one transport and return the endpoint it landed on.
 * @param server - the `net.Server` to bind.
 * @param kind - `'pipe'` or `'tcp'`.
 * @returns the endpoint record.
 */
function listen(server, kind) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      if (kind === 'tcp') {
        const address = server.address()
        resolve({ kind: 'tcp', host: '127.0.0.1', port: address.port })
        return
      }
      resolve({ kind: 'pipe', path: pipePathValue })
    }
    let pipePathValue
    server.once('error', onError)
    server.once('listening', onListening)
    try {
      if (kind === 'tcp') server.listen({ host: '127.0.0.1', port: 0 })
      else {
        pipePathValue = pipePath()
        server.listen(pipePathValue)
      }
    } catch (error) {
      server.removeListener('listening', onListening)
      server.removeListener('error', onError)
      reject(error)
    }
  })
}

/**
 * Start the relay a terminal command connects to.
 *
 * The named pipe is tried first because the kernel never routes it off the
 * machine. Some environments refuse to create one — a confined sandbox is the
 * case this fallback exists for — so a failure there falls back to a loopback
 * listener, and only a failure of both is reported to the caller. Naming `pipe`
 * explicitly turns the fallback off, which is what a test that must prove the
 * pipe path works wants.
 *
 * @param options.token - the password every request must carry.
 * @param options.onQuit - async handler that asks the shell to quit.
 * @param options.logger - optional `{ warn }` sink for a fallback notice.
 * @param options.transport - `'auto'`, `'pipe'` or `'tcp'`; defaults to the environment.
 * @returns the endpoint, plus the disposer that stops listening.
 */
export async function createQuitServer(options) {
  const { token, onQuit, logger } = options
  const wanted = options.transport ?? preferredTransport()
  const accept = (socket) => {
    if (socket.remoteAddress !== undefined && !isLoopback(socket.remoteAddress)) {
      socket.destroy()
      return
    }
    serveConnection(socket, token, onQuit)
  }
  const start = (kind) => {
    const server = net.createServer(accept)
    // The listener is a convenience, not the reason the Host is alive: the
    // shell's own channel is. Unref'ing it means a Host that is shutting down
    // is never held open by a socket nobody is going to connect to, while a
    // request already in flight still finishes.
    server.unref()
    server.on('error', () => {
      // A late server error must not take the Host down; the connection it
      // belonged to is already gone.
    })
    return listen(server, kind).then((endpoint) => ({ server, endpoint }))
  }
  if (wanted !== 'tcp') {
    try {
      const started = await start('pipe')
      return { endpoint: started.endpoint, close: () => closeServer(started.server) }
    } catch (error) {
      if (wanted === 'pipe') throw error
      logger?.warn?.(
        `command-quit: 无法创建本机管道（${error instanceof Error ? error.message : String(error)}），已改用仅本机可连的 127.0.0.1 端口。`
      )
    }
  }
  const started = await start('tcp')
  return { endpoint: started.endpoint, close: () => closeServer(started.server) }
}

/** Stop a server, ignoring the "not running" case. */
function closeServer(server) {
  try {
    server.close()
  } catch {
    // Already closed.
  }
}

/**
 * Ask one running client to quit over the relay.
 *
 * Every outcome is a value rather than a throw, because the caller's job is to
 * print one line about it: a refused token and an unreachable endpoint are both
 * ordinary answers from where the terminal command stands.
 *
 * @param options.endpoint - the endpoint record from the target's instance file.
 * @param options.token - the password published with that record.
 * @param options.command - `'quit'` (default) or `'ping'`.
 * @param options.timeout - milliseconds to wait; defaults to 4000.
 * @returns `{ ok: true }`, or `{ ok: false, error }` with a short reason code.
 */
export function requestQuit(options) {
  const { endpoint, token, command = 'quit', timeout = 4000 } = options
  return new Promise((resolve) => {
    if (endpoint === undefined || endpoint === null) {
      resolve({ ok: false, error: 'no-endpoint' })
      return
    }
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // The socket is already gone.
      }
      resolve(result)
    }
    let socket
    try {
      socket = endpoint.kind === 'tcp'
        ? net.createConnection({ host: endpoint.host ?? '127.0.0.1', port: endpoint.port })
        : net.createConnection({ path: endpoint.path })
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(timeout, () => finish({ ok: false, error: 'timeout' }))
    socket.on('error', (error) => finish({ ok: false, error: error?.code ?? 'unreachable' }))
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const parsed = JSON.parse(buffer.slice(0, newline))
        finish(parsed?.ok === true ? { ok: true } : { ok: false, error: String(parsed?.error ?? 'refused') })
      } catch {
        finish({ ok: false, error: 'bad-reply' })
      }
    })
    socket.on('connect', () => {
      try {
        socket.write(`${JSON.stringify({ token, command })}\n`)
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })
}
