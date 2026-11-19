import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Bridge } from './bridge'
import type { Packet } from './protocol'

// The TUI and adapter share one private connection. The server runs with the user's normal configuration.
async function run(args: string[]) {
  const stdio = args[0] === '--stdio'
  const base = join(tmpdir(), 'shift')
  await mkdir(base, { recursive: true })
  const dir = await mkdtemp(join(base, 'codex-'))
  const socket = join(dir, 'session.sock')
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'inherit'] })
  let ui: ReturnType<typeof spawn> | undefined
  let peer: Bun.ServerWebSocket<undefined> | undefined
  let listener: ReturnType<typeof Bun.serve<undefined>> | undefined
  const bridge = new Bridge(
    packet => child.stdin.write(`${JSON.stringify(packet)}\n`),
    packet => {
      const line = JSON.stringify(packet)
      if (stdio) process.stdout.write(`${line}\n`)
      else peer?.send(line)
    },
    process.cwd(),
    text => console.error(text),
  )
  const stop = () => {
    child.kill()
    ui?.kill()
    listener?.stop(true)
  }
  process.once('SIGTERM', stop)
  try {
    const ended = new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code ?? 1))
    })
    const packet = (line: string): Packet => JSON.parse(line)
    createInterface({ input: child.stdout }).on('line', line => {
      void bridge.server(packet(line))
    })
    if (stdio) {
      const input = createInterface({ input: process.stdin })
      input.on('line', line => {
        void bridge.client(packet(line))
      })
      input.once('close', () => child.stdin.end())
      return await ended
    }
    listener = Bun.serve<undefined>({
      unix: socket,
      fetch(request, server) {
        if (!peer && server.upgrade(request)) return
        return new Response(null, { status: 409 })
      },
      websocket: {
        idleTimeout: 0,
        open(ws) {
          peer = ws
        },
        message(_ws, message) {
          void bridge.client(packet(message.toString()))
        },
        close() {
          child.stdin.end()
        },
      },
    })
    ui = spawn('codex', ['--remote', `unix://${socket}`, ...args], { stdio: 'inherit' })
    const uiExit = new Promise<number>((resolve, reject) => {
      ui?.once('error', reject)
      ui?.once('exit', code => resolve(code ?? 1))
    })
    return await Promise.race([ended, uiExit])
  } finally {
    bridge.close()
    stop()
    process.off('SIGTERM', stop)
    await rm(dir, { recursive: true, force: true })
  }
}

if (import.meta.main) process.exitCode = await run(process.argv.slice(2))
